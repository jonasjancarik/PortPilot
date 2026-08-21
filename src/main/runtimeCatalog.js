const { execFile } = require('child_process');
const { buildDockerProjects, dockerHostPorts } = require('../core/dockerRuntime');

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

async function scanRuntimeCatalog(apps = []) {
  const docker = await inspectDockerContainers();
  const projects = buildDockerProjects(docker.inspect, apps);
  return {
    scannedAt: new Date().toISOString(),
    docker: {
      available: docker.available,
      error: docker.error || null,
      projects,
      projectCount: projects.length,
      containerCount: projects.reduce((count, project) => count + project.services.length, 0),
      runningContainerCount: projects.reduce((count, project) => count + project.runningServices, 0),
      hostPorts: dockerHostPorts(projects),
    },
  };
}

module.exports = { inspectDockerContainers, scanRuntimeCatalog };
