const { execFile } = require('child_process');
const fs = require('fs').promises;
const { buildDockerProjects, dockerHostPorts } = require('../core/dockerRuntime');
const { buildHostProjects, hostListenerPorts, normalizePath } = require('../core/hostRuntime');
const { scanPorts } = require('./portScanner');

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function inspectDockerContainers() {
  let ids;
  try {
    const output = await execFileAsync('docker', ['container', 'ls', '--all', '--quiet', '--no-trunc'], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024,
    });
    ids = output.split(/\r?\n/).map((id) => id.trim()).filter((id) => /^[a-f0-9]{12,64}$/i.test(id));
  } catch (error) {
    return { available: false, error: error.message, inspect: [] };
  }

  if (ids.length === 0) return { available: true, inspect: [] };

  try {
    const output = await execFileAsync('docker', ['container', 'inspect', ...ids], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 32 * 1024 * 1024,
    });
    return { available: true, inspect: JSON.parse(output) };
  } catch (error) {
    return { available: true, error: error.message, inspect: [] };
  }
}

function listenerPids(portInfos = []) {
  const pids = new Set();
  for (const portInfo of portInfos || []) {
    const bindings = Array.isArray(portInfo.bindings) && portInfo.bindings.length > 0
      ? portInfo.bindings
      : [portInfo];
    for (const binding of bindings) {
      const pid = Number(binding?.pid || portInfo?.pid);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
  }
  return [...pids];
}

async function enrichHostCommandLines(portInfos = []) {
  // Windows scanPorts already gets names and command lines in one batched CIM
  // query. On Unix, a small batched ps lookup gives CWD-based matching useful
  // evidence without changing the generic port scanner's lightweight API.
  if (process.platform === 'win32') return portInfos;
  const pids = listenerPids(portInfos);
  if (pids.length === 0) return portInfos;

  let output;
  try {
    output = await execFileAsync('ps', ['-o', 'pid=,command=', '-p', pids.join(',')], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return portInfos;
  }

  const commandLines = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (match) commandLines.set(Number(match[1]), match[2].trim());
  }
  const workingDirs = await readProcessWorkingDirs(pids);
  if (commandLines.size === 0 && workingDirs.size === 0) return portInfos;

  const enrich = (binding, fallback = {}) => {
    const pid = Number(binding?.pid || fallback.pid);
    const commandLine = commandLines.get(pid);
    const cwd = workingDirs.get(pid);
    return {
      ...binding,
      commandLine: binding?.commandLine || commandLine || null,
      cwd: binding?.cwd || cwd || null,
    };
  };
  return portInfos.map((portInfo) => ({
    ...portInfo,
    commandLine: commandLines.get(Number(portInfo.pid)) || portInfo.commandLine,
    cwd: workingDirs.get(Number(portInfo.pid)) || portInfo.cwd,
    bindings: Array.isArray(portInfo.bindings)
      ? portInfo.bindings.map((binding) => enrich(binding, portInfo))
      : portInfo.bindings,
  }));
}

function parseLsofWorkingDirs(output) {
  const result = new Map();
  let pid = null;
  let isCwd = false;
  for (const line of String(output || '').split(/\r?\n/)) {
    if (line.startsWith('p')) {
      const parsed = Number(line.slice(1));
      pid = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      isCwd = false;
    } else if (line === 'fcwd') {
      isCwd = true;
    } else if (line.startsWith('n') && pid && isCwd) {
      result.set(pid, line.slice(1));
      isCwd = false;
    }
  }
  return result;
}

async function readProcessWorkingDirs(pids = []) {
  if (pids.length === 0 || process.platform === 'win32') return new Map();
  if (process.platform === 'linux') {
    const entries = await Promise.all(pids.map(async (pid) => {
      try { return [pid, await fs.readlink(`/proc/${pid}/cwd`)]; } catch { return null; }
    }));
    return new Map(entries.filter(Boolean));
  }
  if (process.platform === 'darwin') {
    try {
      const output = await execFileAsync('lsof', ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fn'], {
        encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024,
      });
      return parseLsofWorkingDirs(output);
    } catch {
      return new Map();
    }
  }
  return new Map();
}

async function inspectHostPorts() {
  const ports = await scanPorts();
  return enrichHostCommandLines(ports);
}

function applyManagedProcessMetadata(portInfos = [], managedApps = []) {
  const byPid = new Map((managedApps || [])
    .filter((app) => Number.isInteger(Number(app?.pid)) && app.running !== false)
    .map((app) => [Number(app.pid), app]));
  const enrich = (listener, fallback = {}) => {
    const managed = byPid.get(Number(listener?.pid || fallback.pid));
    if (!managed) return listener;
    return {
      ...listener,
      appId: managed.id,
      cwd: listener?.cwd || managed.cwd || null,
      commandLine: listener?.commandLine || managed.command || null,
    };
  };
  return (portInfos || []).map((portInfo) => ({
    ...enrich(portInfo),
    bindings: Array.isArray(portInfo.bindings)
      ? portInfo.bindings.map((binding) => enrich(binding, portInfo))
      : portInfo.bindings,
  }));
}

/**
 * Merge source-specific projects into one project when both sources name the
 * same working directory. Source collections remain on the catalogue too, so
 * callers that need Docker-only or host-only views do not lose information.
 */
function buildUnifiedProjects(dockerProjects = [], hostProjects = []) {
  const projects = new Map();

  for (const [sourceKind, sourceProjects] of [['docker', dockerProjects], ['host', hostProjects]]) {
    for (const project of sourceProjects || []) {
      const workingDir = normalizePath(project.workingDir);
      // An uncatalogued host process has no project identity. It must stay out
      // of otherwise unrelated Docker projects that also happen to lack a CWD.
      const key = workingDir ? `cwd:${workingDir}` : project.id;
      if (!projects.has(key)) {
        projects.set(key, {
          id: key,
          kind: project.kind,
          name: project.name,
          workingDir: project.workingDir || null,
          configFiles: [...(project.configFiles || [])],
          registeredAppIds: [...(project.registeredAppIds || [])],
          sourceKinds: [sourceKind],
          services: (project.services || []).map((service) => ({ ...service, sourceKind })),
        });
        continue;
      }

      const merged = projects.get(key);
      if (!merged.sourceKinds.includes(sourceKind)) merged.sourceKinds.push(sourceKind);
      // Registered app names are generally more descriptive than a Compose
      // project name, so prefer them when joining host and Docker records.
      if (project.kind === 'app') merged.name = project.name;
      if (!merged.workingDir && project.workingDir) merged.workingDir = project.workingDir;
      merged.configFiles = [...new Set([...merged.configFiles, ...(project.configFiles || [])])];
      merged.registeredAppIds = [...new Set([...merged.registeredAppIds, ...(project.registeredAppIds || [])])];
      merged.services.push(...(project.services || []).map((service) => ({ ...service, sourceKind })));
    }
  }

  return [...projects.values()].map((project) => {
    project.kind = project.sourceKinds.length > 1 ? 'mixed' : project.kind;
    project.runningServices = project.services.filter((service) => service.running).length;
    project.totalServices = project.services.length;
    return project;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function runningDockerHostPorts(projects = []) {
  return dockerHostPorts((projects || []).map((project) => ({
    ...project,
    services: (project.services || []).filter((service) => service.running),
  })));
}

async function scanRuntimeCatalog(apps = [], options = {}) {
  const [docker, scannedHostPorts] = await Promise.all([
    inspectDockerContainers(),
    options.hostPorts === undefined ? inspectHostPorts() : Promise.resolve(options.hostPorts),
  ]);
  const projects = buildDockerProjects(docker.inspect, apps);
  // A stopped container's configured mapping is not occupying the host port.
  // Suppress host proxy listeners only for currently running containers.
  const dockerPorts = runningDockerHostPorts(projects);
  // Docker Desktop and Docker Engine often expose published container ports as
  // host proxy listeners. Docker already has fuller context for those, so keep
  // them out of the host process catalogue rather than presenting duplicates.
  const enrichedHostPorts = applyManagedProcessMetadata(scannedHostPorts, options.managedApps || []);
  const hostPorts = enrichedHostPorts.filter((portInfo) => !dockerPorts.includes(portInfo.port));
  const hostProjects = buildHostProjects(hostPorts, apps);
  const unifiedProjects = buildUnifiedProjects(projects, hostProjects);
  const serviceCount = unifiedProjects.reduce((count, project) => count + project.services.length, 0);
  const runningServiceCount = unifiedProjects.reduce((count, project) => count + project.runningServices, 0);
  return {
    scannedAt: new Date().toISOString(),
    projects: unifiedProjects,
    projectCount: unifiedProjects.length,
    serviceCount,
    runningServiceCount,
    docker: {
      available: docker.available,
      error: docker.error || null,
      projects,
      projectCount: projects.length,
      containerCount: projects.reduce((count, project) => count + project.services.length, 0),
      runningContainerCount: projects.reduce((count, project) => count + project.runningServices, 0),
      hostPorts: dockerPorts,
    },
    host: {
      available: true,
      error: null,
      projects: hostProjects,
      projectCount: hostProjects.length,
      processCount: hostProjects.reduce((count, project) => count + project.services.length, 0),
      runningProcessCount: hostProjects.reduce((count, project) => count + project.runningServices, 0),
      hostPorts: hostListenerPorts(hostProjects),
    },
  };
}

module.exports = {
  inspectDockerContainers,
  inspectHostPorts,
  enrichHostCommandLines,
  parseLsofWorkingDirs,
  readProcessWorkingDirs,
  applyManagedProcessMetadata,
  buildUnifiedProjects,
  runningDockerHostPorts,
  scanRuntimeCatalog,
};
