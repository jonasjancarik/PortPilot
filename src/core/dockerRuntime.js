/**
 * Pure Docker inspect normalization shared by the desktop app, tests, and MCP.
 * Docker is the source of truth; PortPilot only turns its inspect payload into
 * a stable, UI-friendly runtime catalogue.
 */

const COMPOSE_LABELS = {
  project: 'com.docker.compose.project',
  service: 'com.docker.compose.service',
  workingDir: 'com.docker.compose.project.working_dir',
  configFiles: 'com.docker.compose.project.config_files',
  containerNumber: 'com.docker.compose.container-number',
};

function splitCsv(value) {
  return String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
}

function normalizePortBindings(inspect) {
  const exposed = new Set([
    ...Object.keys(inspect.Config?.ExposedPorts || {}),
    ...Object.keys(inspect.NetworkSettings?.Ports || {}),
  ]);

  return [...exposed].map((key) => {
    const match = key.match(/^(\d+)\/(tcp|udp)$/i);
    if (!match) return null;
    const containerPort = Number(match[1]);
    const protocol = match[2].toLowerCase();
    const bindings = inspect.NetworkSettings?.Ports?.[key] || [];
    return {
      containerPort,
      protocol,
      published: bindings.map((binding) => ({
        hostIp: binding.HostIp || '',
        hostPort: Number(binding.HostPort),
      })).filter((binding) => Number.isInteger(binding.hostPort)),
    };
  }).filter(Boolean).sort((a, b) => a.containerPort - b.containerPort || a.protocol.localeCompare(b.protocol));
}

function normalizeContainer(inspect) {
  const labels = inspect.Config?.Labels || {};
  const composeProject = labels[COMPOSE_LABELS.project] || null;
  const composeService = labels[COMPOSE_LABELS.service] || null;
  const name = String(inspect.Name || '').replace(/^\//, '') || inspect.Id?.slice(0, 12) || 'unknown';
  const state = inspect.State || {};
  const health = state.Health?.Status || null;

  return {
    id: inspect.Id || null,
    shortId: inspect.Id ? inspect.Id.slice(0, 12) : null,
    name,
    image: inspect.Config?.Image || inspect.Image || null,
    command: [...(inspect.Config?.Entrypoint || []), ...(inspect.Config?.Cmd || [])].join(' ') || null,
    createdAt: inspect.Created || null,
    status: state.Status || 'unknown',
    running: state.Running === true,
    health,
    compose: composeProject ? {
      project: composeProject,
      service: composeService || name,
      workingDir: labels[COMPOSE_LABELS.workingDir] || null,
      configFiles: splitCsv(labels[COMPOSE_LABELS.configFiles]),
      containerNumber: Number(labels[COMPOSE_LABELS.containerNumber]) || null,
    } : null,
    ports: normalizePortBindings(inspect),
    networks: Object.keys(inspect.NetworkSettings?.Networks || {}).sort(),
  };
}

function normalizePath(value) {
  return String(value || '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
}

function matchRegisteredApps(workingDir, apps) {
  const target = normalizePath(workingDir);
  if (!target) return [];
  return (apps || []).filter((app) => normalizePath(app.cwd) === target).map((app) => app.id);
}

function buildDockerProjects(inspectPayload, apps = []) {
  const containers = (inspectPayload || []).map(normalizeContainer);
  const projects = new Map();

  for (const container of containers) {
    const composeIdentity = container.compose
      ? `${container.compose.project}:${normalizePath(container.compose.workingDir) || 'no-cwd'}`
      : null;
    const key = container.compose ? `compose:${composeIdentity}` : `container:${container.id}`;
    if (!projects.has(key)) {
      const workingDir = container.compose?.workingDir || null;
      projects.set(key, {
        id: key,
        kind: container.compose ? 'compose' : 'container',
        name: container.compose?.project || container.name,
        workingDir,
        configFiles: container.compose?.configFiles || [],
        registeredAppIds: matchRegisteredApps(workingDir, apps),
        services: [],
      });
    }
    projects.get(key).services.push(container);
  }

  return [...projects.values()].map((project) => {
    project.services.sort((a, b) => {
      const aName = a.compose?.service || a.name;
      const bName = b.compose?.service || b.name;
      return aName.localeCompare(bName);
    });
    project.runningServices = project.services.filter((service) => service.running).length;
    project.totalServices = project.services.length;
    return project;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function dockerHostPorts(projects) {
  const ports = new Set();
  for (const project of projects || []) {
    for (const service of project.services || []) {
      for (const mapping of service.ports || []) {
        for (const published of mapping.published || []) ports.add(published.hostPort);
      }
    }
  }
  return [...ports].sort((a, b) => a - b);
}

module.exports = {
  COMPOSE_LABELS,
  normalizeContainer,
  normalizePortBindings,
  buildDockerProjects,
  dockerHostPorts,
};
