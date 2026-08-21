/**
 * Pure normalization for host TCP listeners.
 *
 * A listener scan reports one row per port, while the runtime catalogue needs
 * one row per process.  This module keeps that relationship intact and places
 * processes in a registered app when there is concrete CWD evidence.  The
 * scanner remains the source of truth; PortPilot only adds stable grouping.
 */

function normalizePath(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase();
}

function normalizedText(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function validPid(value) {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function asText(value) {
  const text = String(value || '').trim();
  return text || null;
}

/**
 * Flatten platform-specific port-scan rows.  Windows can report several
 * bindings for a port, so each binding becomes a listener before processes
 * are grouped below.
 */
function normalizeHostListeners(portInfos = []) {
  const listeners = [];

  for (const portInfo of portInfos || []) {
    const port = validPort(portInfo?.port);
    if (!port) continue;

    const bindings = Array.isArray(portInfo.bindings) && portInfo.bindings.length > 0
      ? portInfo.bindings
      : [portInfo];

    for (const binding of bindings) {
      const source = { ...portInfo, ...binding };
      listeners.push({
        port,
        pid: validPid(source.pid),
        processName: asText(source.processName) || 'Unknown process',
        commandLine: asText(source.commandLine),
        address: asText(source.address),
        cwd: asText(source.cwd || source.workingDir || source.workingDirectory),
        appId: asText(source.appId || source.registeredAppId),
        conflict: source.conflict === true,
        running: source.running !== false,
      });
    }
  }

  return listeners;
}

function processKey(listener) {
  if (listener.pid) return `pid:${listener.pid}`;
  // A missing PID means the scanner could not identify the process. Keep the
  // row isolated rather than merging two unrelated unknown listeners.
  return `unknown:${listener.port}:${listener.address || ''}`;
}

function chooseProcessText(listeners, field, fallback = null) {
  return listeners.map((listener) => listener[field]).find(Boolean) || fallback;
}

function groupHostProcesses(portInfos = []) {
  const grouped = new Map();

  for (const listener of normalizeHostListeners(portInfos)) {
    const key = processKey(listener);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(listener);
  }

  return [...grouped.entries()].map(([key, listeners]) => {
    const portBindings = [...new Map(listeners.map((listener) => [
      `${listener.port}:${listener.address || ''}`,
      { port: listener.port, address: listener.address },
    ])).values()].sort((a, b) => a.port - b.port || String(a.address).localeCompare(String(b.address)));
    const addresses = [...new Set(portBindings.map((binding) => binding.address).filter(Boolean))];

    return {
      id: `host:${key}`,
      kind: 'host-process',
      pid: listeners[0].pid,
      processName: chooseProcessText(listeners, 'processName', 'Unknown process'),
      commandLine: chooseProcessText(listeners, 'commandLine'),
      address: addresses[0] || null,
      addresses,
      ports: [...new Set(portBindings.map((binding) => binding.port))].sort((a, b) => a - b),
      portBindings,
      running: listeners.some((listener) => listener.running),
      conflict: listeners.some((listener) => listener.conflict),
      _listeners: listeners,
    };
  }).sort((a, b) =>
    a.processName.localeCompare(b.processName) ||
    (a.pid || Number.MAX_SAFE_INTEGER) - (b.pid || Number.MAX_SAFE_INTEGER) ||
    a.ports[0] - b.ports[0]);
}

function commandMentionsPath(commandLine, cwd) {
  const command = normalizedText(commandLine);
  const target = normalizePath(cwd);
  if (!command || !target) return false;

  let start = command.indexOf(target);
  while (start !== -1) {
    const before = command[start - 1];
    const after = command[start + target.length];
    const beforeIsBoundary = !before || /[\s'"=:(]/.test(before);
    const afterIsBoundary = !after || /[\s'"/:),;&]/.test(after);
    if (beforeIsBoundary && afterIsBoundary) return true;
    start = command.indexOf(target, start + 1);
  }
  return false;
}

function matchHostProcessToApp(process, apps = []) {
  const listeners = process._listeners || [];
  const appById = new Map((apps || []).filter((app) => app?.id).map((app) => [String(app.id), app]));

  for (const listener of listeners) {
    if (listener.appId && appById.has(listener.appId)) {
      return { app: appById.get(listener.appId), matchType: 'app-id' };
    }
  }

  const candidates = [];
  for (const app of apps || []) {
    const cwd = normalizePath(app?.cwd);
    if (!app?.id || !cwd) continue;

    for (const listener of listeners) {
      if (normalizePath(listener.cwd) === cwd) {
        candidates.push({ app, matchType: 'cwd', score: cwd.length + 100000 });
        break;
      }
      if (commandMentionsPath(listener.commandLine, cwd)) {
        candidates.push({ app, matchType: 'command-cwd', score: cwd.length });
        break;
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || String(a.app.id).localeCompare(String(b.app.id)));
  return candidates.length > 0 ? candidates[0] : null;
}

function publicService(process, appMatch) {
  const { _listeners, ...service } = process;
  return appMatch ? { ...service, appId: appMatch.app.id, matchType: appMatch.matchType } : service;
}

/**
 * Build UI-friendly projects from a listener scan. Registered app projects
 * are emitted only when one of their host processes is live; every other
 * listener belongs to a single uncatalogued host project.
 */
function buildHostProjects(portInfos = [], apps = []) {
  const projects = new Map();
  const uncatalogued = {
    id: 'host:uncatalogued',
    kind: 'host',
    name: 'Uncatalogued host processes',
    workingDir: null,
    registeredAppIds: [],
    services: [],
  };

  for (const process of groupHostProcesses(portInfos)) {
    const appMatch = matchHostProcessToApp(process, apps);
    if (!appMatch) {
      uncatalogued.services.push(publicService(process));
      continue;
    }

    const app = appMatch.app;
    const id = `app:${app.id}`;
    if (!projects.has(id)) {
      projects.set(id, {
        id,
        kind: 'app',
        name: app.name || app.id,
        workingDir: app.cwd || null,
        registeredAppIds: [app.id],
        services: [],
      });
    }
    projects.get(id).services.push(publicService(process, appMatch));
  }

  if (uncatalogued.services.length > 0) projects.set(uncatalogued.id, uncatalogued);

  return [...projects.values()].map((project) => {
    project.services.sort((a, b) => a.processName.localeCompare(b.processName) ||
      (a.pid || Number.MAX_SAFE_INTEGER) - (b.pid || Number.MAX_SAFE_INTEGER));
    project.runningServices = project.services.filter((service) => service.running).length;
    project.totalServices = project.services.length;
    return project;
  }).sort((a, b) => {
    if (a.id === 'host:uncatalogued') return 1;
    if (b.id === 'host:uncatalogued') return -1;
    return a.name.localeCompare(b.name);
  });
}

function hostListenerPorts(projects = []) {
  const ports = new Set();
  for (const project of projects || []) {
    for (const service of project.services || []) {
      for (const port of service.ports || []) ports.add(port);
    }
  }
  return [...ports].sort((a, b) => a - b);
}

module.exports = {
  normalizePath,
  normalizeHostListeners,
  groupHostProcesses,
  commandMentionsPath,
  matchHostProcessToApp,
  buildHostProjects,
  hostListenerPorts,
};
