/**
 * Persistent, user-supplied metadata for entries in the runtime catalogue.
 *
 * The operating system and Docker remain the source of truth for a runtime's
 * state. An annotation only supplies human context (for example, a useful
 * name and description from Codex) and a stable way to find the same runtime
 * on later scans.
 */

const { createHash } = require('crypto');

const MATCH_PRECEDENCE = Object.freeze({
  'runtime-identity': 600,
  compose: 500,
  pid: 400,
  'cwd-port': 300,
  port: 200,
  'project-working-dir': 100,
});

const TEXT_LIMITS = Object.freeze({
  id: 160,
  name: 240,
  description: 4000,
  cwd: 4096,
  composeProject: 240,
  composeService: 240,
  launchedBy: 240,
  task: 500,
  runtimeId: 800,
  runtimeFingerprint: 128,
});

function text(value) {
  return typeof value === 'string' ? value.trim() || null : null;
}

function normalizeRuntimePath(value) {
  const path = text(value);
  if (!path) return null;

  const normalized = path.replace(/\\/g, '/');
  // Do not turn POSIX or Windows drive roots into an empty string.
  if (normalized === '/' || /^[a-zA-Z]:\/$/.test(normalized)) return normalized;
  return normalized.replace(/\/+$/, '') || null;
}

function pathKey(value) {
  return normalizeRuntimePath(value)?.toLowerCase() || null;
}

function textKey(value) {
  return text(value)?.toLowerCase() || null;
}

function validPort(value) {
  const port = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function validPid(value) {
  const pid = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function timestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function nowIso(now) {
  const value = typeof now === 'function' ? now() : (now || new Date());
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('A valid annotation clock is required');
  return parsed.toISOString();
}

function makeAnnotationId(now = new Date(), random = Math.random) {
  const instant = nowIso(now).replace(/[-:.TZ]/g, '');
  const suffix = Math.floor(random() * 0x100000000).toString(36).padStart(7, '0');
  return `runtime_${instant}_${suffix}`;
}

function fingerprint(value) {
  // This is a stale-write guard, not a secret or authentication mechanism.
  // SHA-256 makes accidental collisions vanishingly unlikely while retaining
  // a compact token that MCP clients can round-trip unchanged.
  return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
}

function readText(input, key, errors) {
  const value = input[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    errors.push(`${key} must be a string`);
    return null;
  }
  const normalized = key === 'cwd' ? normalizeRuntimePath(value) : text(value);
  if (normalized && normalized.length > TEXT_LIMITS[key]) {
    errors.push(`${key} must be at most ${TEXT_LIMITS[key]} characters`);
  }
  return normalized;
}

function readInteger(input, key, validator, errors) {
  const value = input[key];
  if (value === undefined || value === null || value === '') return null;
  const normalized = validator(value);
  if (!normalized) errors.push(`${key} is invalid`);
  return normalized;
}

/**
 * Validate and normalize an annotation without mutating the caller's object.
 *
 * An annotation must identify a concrete runtime (Compose service, PID,
 * CWD+port, port, or project CWD) and carry at least some human context.
 */
function validateRuntimeAnnotation(input, options = {}) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['annotation must be an object'], annotation: null };
  }

  const id = readText(input, 'id', errors);
  if (id && !/^[A-Za-z0-9._:-]+$/.test(id)) errors.push('id contains unsupported characters');
  const name = readText(input, 'name', errors);
  const description = readText(input, 'description', errors);
  const cwd = readText(input, 'cwd', errors);
  const composeProject = readText(input, 'composeProject', errors);
  const composeService = readText(input, 'composeService', errors);
  const launchedBy = readText(input, 'launchedBy', errors);
  const task = readText(input, 'task', errors);
  const runtimeId = readText(input, 'runtimeId', errors);
  const runtimeFingerprint = readText(input, 'runtimeFingerprint', errors);
  const port = readInteger(input, 'port', validPort, errors);
  const pid = readInteger(input, 'pid', validPid, errors);

  if (Boolean(composeProject) !== Boolean(composeService)) {
    errors.push('composeProject and composeService must be provided together');
  }
  if (Boolean(runtimeId) !== Boolean(runtimeFingerprint)) {
    errors.push('runtimeId and runtimeFingerprint must be provided together');
  }
  if (!runtimeId && !composeProject && !pid && !(cwd && port) && !port && !cwd) {
    errors.push('annotation needs a runtime selector');
  }
  if (!name && !description && !launchedBy && !task) {
    errors.push('annotation needs a name, description, launchedBy, or task');
  }

  const inputCreatedAt = timestamp(input.createdAt);
  const inputUpdatedAt = timestamp(input.updatedAt);
  if (input.createdAt !== undefined && input.createdAt !== null && !inputCreatedAt) {
    errors.push('createdAt must be an ISO timestamp');
  }
  if (input.updatedAt !== undefined && input.updatedAt !== null && !inputUpdatedAt) {
    errors.push('updatedAt must be an ISO timestamp');
  }

  if (errors.length > 0) return { valid: false, errors, annotation: null };

  const generatedAt = nowIso(options.now);
  return {
    valid: true,
    errors: [],
    annotation: {
      id: id || makeAnnotationId(generatedAt, options.random),
      name,
      description,
      cwd,
      port,
      pid,
      composeProject,
      composeService,
      launchedBy,
      task,
      runtimeId,
      runtimeFingerprint,
      createdAt: inputCreatedAt || generatedAt,
      updatedAt: inputUpdatedAt || generatedAt,
    },
  };
}

function normalizeRuntimeAnnotation(input, options = {}) {
  const result = validateRuntimeAnnotation(input, options);
  return result.valid ? result.annotation : null;
}

/**
 * The strongest identity supplied by an annotation. This is useful for an
 * MCP "set description" action that did not retain the generated annotation
 * id: repeated writes to the same runtime update rather than duplicate it.
 */
function annotationKey(annotation) {
  const value = normalizeRuntimeAnnotation(annotation, { now: annotation?.updatedAt || annotation?.createdAt });
  if (!value) return null;
  if (value.runtimeId) return `runtime:${value.runtimeId}`;
  if (value.composeProject && value.composeService) {
    return `compose:${textKey(value.composeProject)}:${textKey(value.composeService)}`;
  }
  if (value.pid) return `pid:${value.pid}`;
  if (value.cwd && value.port) return `cwd-port:${pathKey(value.cwd)}:${value.port}`;
  if (value.port) return `port:${value.port}`;
  if (value.cwd) return `cwd:${pathKey(value.cwd)}`;
  return null;
}

function existingAnnotationAt(annotations, id, key) {
  return (annotations || []).findIndex((item) => {
    const normalized = normalizeRuntimeAnnotation(item, { now: item?.updatedAt || item?.createdAt });
    if (!normalized) return false;
    return (id && normalized.id === id) || (!id && key && annotationKey(normalized) === key);
  });
}

/**
 * Return a new annotation array plus an upsert result. Callers can assign the
 * returned array directly to `config.runtimeAnnotations` and save normally.
 * Partial updates require an id; otherwise the strongest selector is used.
 */
function upsertRuntimeAnnotation(annotations = [], input, options = {}) {
  const currentRuntime = options.currentRuntime || options.runtime || null;
  if (options.requireRuntimeIdentity && !currentRuntime) {
    return {
      annotations: Array.isArray(annotations) ? [...annotations] : [], annotation: null, created: false,
      errors: ['a current runtime is required when writing an annotation'],
    };
  }
  if (currentRuntime) {
    const currentIdentity = runtimeIdentity(currentRuntime.service || currentRuntime, currentRuntime.project || {});
    if (!input || input.runtimeId !== currentIdentity.runtimeId || input.runtimeFingerprint !== currentIdentity.runtimeFingerprint) {
      return {
        annotations: Array.isArray(annotations) ? [...annotations] : [], annotation: null, created: false,
        errors: ['runtime no longer matches the selected runtimeId and runtimeFingerprint; refresh before writing'],
      };
    }
  }
  const original = Array.isArray(annotations) ? annotations : [];
  const requestedId = text(input?.id);
  const requestedKey = requestedId ? null : annotationKey(input);
  const existingIndex = existingAnnotationAt(original, requestedId, requestedKey);
  const existing = existingIndex >= 0 ? original[existingIndex] : null;
  const merged = existing
    ? Object.fromEntries(Object.entries({ ...existing, ...input }).filter(([, value]) => value !== undefined))
    : input;
  const validation = validateRuntimeAnnotation(merged, options);

  if (!validation.valid) {
    return { annotations: [...original], annotation: null, created: false, errors: validation.errors };
  }

  const stamp = nowIso(options.now);
  const annotation = {
    ...validation.annotation,
    id: existing?.id || validation.annotation.id,
    createdAt: existing?.createdAt || validation.annotation.createdAt || stamp,
    updatedAt: stamp,
  };
  const next = [...original];
  if (existingIndex >= 0) next[existingIndex] = annotation;
  else next.push(annotation);
  return { annotations: next, annotation, created: existingIndex < 0, errors: [] };
}

function removeRuntimeAnnotation(annotations = [], id) {
  const target = text(id);
  const original = Array.isArray(annotations) ? annotations : [];
  const index = original.findIndex((item) => item?.id === target);
  if (index < 0) return { annotations: [...original], removed: null };
  const next = [...original];
  const [removed] = next.splice(index, 1);
  return { annotations: next, removed };
}

function servicePorts(service = {}) {
  const ports = new Set();
  const add = (value) => {
    const port = validPort(value);
    if (port) ports.add(port);
  };
  add(service.port);
  for (const port of service.ports || []) {
    if (typeof port === 'number' || typeof port === 'string') {
      add(port);
      continue;
    }
    add(port?.containerPort);
    for (const published of port?.published || []) add(published?.hostPort);
  }
  for (const binding of service.portBindings || []) add(binding?.port);
  return ports;
}

/**
 * Scan-time identity for optimistic annotation writes. `runtimeId` identifies
 * the current process/container instance; the fingerprint identifies its
 * meaningful source facts. A reused PID therefore has the same runtimeId but
 * a different fingerprint. An annotation written for an exact runtime never
 * falls back to a selector if either token no longer agrees.
 */
function runtimeIdentity(service = {}, project = {}) {
  const context = serviceContext(service, project);
  const source = service.sourceKind === 'docker' || Boolean(service.compose) ||
    (typeof service.id === 'string' && service.id.startsWith('container:'))
    ? 'docker'
    : 'host';
  const runtimeId = source === 'docker'
    ? `docker:${text(service.id) || text(service.shortId) || text(service.name) || 'unknown'}`
    : text(service.id) || (context.pid ? `host:pid:${context.pid}` : `host:unknown:${[...context.ports].sort((a, b) => a - b).join(',') || 'no-port'}`);
  const command = text(service.commandLine || service.command)?.toLowerCase() || null;
  const processName = text(service.processName)?.toLowerCase() || null;
  const identityFacts = source === 'docker'
    ? [
      source,
      context.composeProject,
      context.composeService,
      context.cwd,
      text(service.image)?.toLowerCase() || null,
      text(service.name)?.toLowerCase() || null,
      command,
    ]
    : [source, processName, command, context.cwd, [...context.ports].sort((a, b) => a - b)];
  return { runtimeId, runtimeFingerprint: fingerprint(JSON.stringify(identityFacts)) };
}

function serviceContext(service = {}, project = {}) {
  return {
    composeProject: textKey(service.compose?.project || service.composeProject),
    composeService: textKey(service.compose?.service || service.composeService),
    pid: validPid(service.pid),
    cwd: pathKey(project?.workingDir || service.workingDir || service.cwd || service.compose?.workingDir),
    ports: servicePorts(service),
  };
}

function annotationCandidates(annotation, context) {
  const candidates = [];
  const composeProject = textKey(annotation.composeProject);
  const composeService = textKey(annotation.composeService);
  const cwd = pathKey(annotation.cwd);

  if (composeProject && composeService &&
      composeProject === context.composeProject && composeService === context.composeService) {
    candidates.push({ type: 'compose', precedence: MATCH_PRECEDENCE.compose });
  }
  if (annotation.pid && annotation.pid === context.pid) {
    candidates.push({ type: 'pid', precedence: MATCH_PRECEDENCE.pid });
  }
  if (cwd && annotation.port && cwd === context.cwd && context.ports.has(annotation.port)) {
    candidates.push({ type: 'cwd-port', precedence: MATCH_PRECEDENCE['cwd-port'] });
  } else if (!cwd && annotation.port && context.ports.has(annotation.port)) {
    candidates.push({ type: 'port', precedence: MATCH_PRECEDENCE.port });
  } else if (cwd && !annotation.port && cwd === context.cwd) {
    candidates.push({ type: 'project-working-dir', precedence: MATCH_PRECEDENCE['project-working-dir'] });
  }
  return candidates;
}

function runtimeIdentityStatus(annotation, identity) {
  if (!annotation.runtimeId && !annotation.runtimeFingerprint) return { exact: false, fallback: false, compatible: true };
  if (!annotation.runtimeId || !annotation.runtimeFingerprint) return { exact: false, fallback: false, compatible: false };
  return {
    exact: annotation.runtimeId === identity.runtimeId && annotation.runtimeFingerprint === identity.runtimeFingerprint,
    fallback: false,
    compatible: annotation.runtimeId === identity.runtimeId && annotation.runtimeFingerprint === identity.runtimeFingerprint,
  };
}

function freshness(annotation) {
  return Date.parse(annotation.updatedAt || annotation.createdAt || '') || 0;
}

/**
 * Find the best annotation for one factual runtime service. Exact scan-time
 * identity wins. An annotation with an identity never broadens into a
 * selector match when a process PID or Docker container is later reused.
 */
function matchRuntimeAnnotation(service, project, annotations = []) {
  const context = serviceContext(service, project);
  const identity = runtimeIdentity(service, project);
  const matches = [];
  for (const raw of annotations || []) {
    const annotation = normalizeRuntimeAnnotation(raw, { now: raw?.updatedAt || raw?.createdAt });
    if (!annotation) continue;
    const identityStatus = runtimeIdentityStatus(annotation, identity);
    if (!identityStatus.compatible) continue;
    if (identityStatus.exact) {
      matches.push({ annotation, type: 'runtime-identity', precedence: MATCH_PRECEDENCE['runtime-identity'] });
      continue;
    }
    for (const candidate of annotationCandidates(annotation, context)) {
      matches.push({ annotation, ...candidate });
    }
  }
  matches.sort((a, b) => b.precedence - a.precedence || freshness(b.annotation) - freshness(a.annotation) ||
    a.annotation.id.localeCompare(b.annotation.id));
  return matches[0] || null;
}

function defaultDisplayName(service = {}) {
  return service.compose?.service || service.name || service.processName || service.command || 'Unknown runtime';
}

function annotationProvenance(annotation) {
  if (!annotation) return null;
  return {
    launchedBy: annotation.launchedBy,
    task: annotation.task,
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
  };
}

/** Add annotation fields without modifying the scanner/container facts. */
function enrichRuntimeService(service = {}, project = {}, annotations = []) {
  if (Array.isArray(project)) {
    annotations = project;
    project = {};
  }
  const identity = runtimeIdentity(service, project);
  const match = matchRuntimeAnnotation(service, project, annotations);
  const annotation = match?.annotation || null;
  return {
    ...service,
    runtimeId: identity.runtimeId,
    runtimeFingerprint: identity.runtimeFingerprint,
    displayName: annotation?.name || service.displayName || defaultDisplayName(service),
    description: annotation?.description || service.description || null,
    annotation,
    provenance: annotationProvenance(annotation),
    annotationMatchType: match?.type || null,
  };
}

function enrichRuntimeProjects(projects = [], annotations = []) {
  return (projects || []).map((project) => ({
    ...project,
    services: (project.services || []).map((service) => enrichRuntimeService(service, project, annotations)),
  }));
}

module.exports = {
  MATCH_PRECEDENCE,
  TEXT_LIMITS,
  normalizeRuntimePath,
  validateRuntimeAnnotation,
  normalizeRuntimeAnnotation,
  makeAnnotationId,
  annotationKey,
  upsertRuntimeAnnotation,
  removeRuntimeAnnotation,
  servicePorts,
  runtimeIdentity,
  matchRuntimeAnnotation,
  enrichRuntimeService,
  enrichRuntimeProjects,
};
