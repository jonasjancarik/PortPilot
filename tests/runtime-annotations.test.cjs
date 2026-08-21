const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ConfigStore } = require('../src/main/configStore');
const {
  annotationKey,
  enrichRuntimeProjects,
  enrichRuntimeService,
  matchRuntimeAnnotation,
  normalizeRuntimeAnnotation,
  normalizeRuntimePath,
  removeRuntimeAnnotation,
  runtimeIdentity,
  servicePorts,
  upsertRuntimeAnnotation,
  validateRuntimeAnnotation,
} = require('../src/core/runtimeAnnotations');

let passed = 0;
let failed = 0;
const NOW = '2026-08-21T12:00:00.000Z';

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`❌ ${name}\n   ${error.message}`);
    failed += 1;
  }
}

function annotation(input) {
  const result = validateRuntimeAnnotation(input, { now: NOW, random: () => 0 });
  assert.ok(result.valid, result.errors.join(', '));
  return result.annotation;
}

const hostProject = { id: 'app:catalogue', workingDir: '/Work/Catalogue/' };
const hostService = {
  id: 'host:pid:41',
  kind: 'host-process',
  pid: 41,
  processName: 'node',
  commandLine: 'node server.js',
  ports: [3000, 9229],
  running: true,
};

test('normalizes portable paths and fills persistent timestamps', () => {
  const value = annotation({
    name: 'PortPilot development server',
    description: 'The local PortPilot renderer.',
    cwd: ' C:\\Work\\Catalogue\\ ',
    port: '3000',
    launchedBy: 'Codex',
    task: 'task_abc',
  });

  assert.strictEqual(value.cwd, 'C:/Work/Catalogue');
  assert.strictEqual(value.port, 3000);
  assert.strictEqual(value.createdAt, NOW);
  assert.strictEqual(value.updatedAt, NOW);
  assert.match(value.id, /^runtime_/);
  assert.strictEqual(normalizeRuntimePath('/'), '/');
  assert.strictEqual(normalizeRuntimePath('C:\\'), 'C:/');
});

test('rejects ambiguous or context-free annotations', () => {
  const composeOnly = validateRuntimeAnnotation({ composeProject: 'catalogue', description: 'API' }, { now: NOW });
  const noSelector = validateRuntimeAnnotation({ description: 'API' }, { now: NOW });
  const noMetadata = validateRuntimeAnnotation({ port: 3000 }, { now: NOW });
  const badPort = validateRuntimeAnnotation({ port: 65536, description: 'API' }, { now: NOW });

  assert.strictEqual(composeOnly.valid, false);
  assert.match(composeOnly.errors.join(' '), /provided together/);
  assert.strictEqual(noSelector.valid, false);
  assert.strictEqual(noMetadata.valid, false);
  assert.strictEqual(badPort.valid, false);
});

test('matches exact Compose project and service ahead of every other identity', () => {
  const project = { workingDir: '/work/catalogue' };
  const service = {
    id: 'container:api', pid: 41, ports: [{ containerPort: 3000, published: [{ hostPort: 13000 }] }],
    compose: { project: 'catalogue', service: 'api' }, name: 'catalogue-api-1', image: 'node:24',
  };
  const result = matchRuntimeAnnotation(service, project, [
    annotation({ pid: 41, description: 'PID match' }),
    annotation({ cwd: '/work/catalogue', port: 3000, description: 'CWD port match' }),
    annotation({ composeProject: 'Catalogue', composeService: 'API', description: 'Compose match' }),
  ]);

  assert.strictEqual(result.type, 'compose');
  assert.strictEqual(result.annotation.description, 'Compose match');
});

test('uses PID before CWD+port, port, and project working directory', () => {
  const result = matchRuntimeAnnotation(hostService, hostProject, [
    annotation({ cwd: '/work/catalogue', description: 'Project description' }),
    annotation({ port: 3000, description: 'Port description' }),
    annotation({ cwd: '/work/catalogue', port: 3000, description: 'Precise description' }),
    annotation({ pid: 41, description: 'PID description' }),
  ]);

  assert.strictEqual(result.type, 'pid');
  assert.strictEqual(result.annotation.description, 'PID description');
});

test('does not fall back from stale scan-time identity to a matching selector', () => {
  const stale = annotation({
    pid: 9999, cwd: '/work/catalogue', port: 3000, description: 'Dev server',
    runtimeId: 'host:pid:9999', runtimeFingerprint: runtimeIdentity(hostService, hostProject).runtimeFingerprint,
  });
  const result = matchRuntimeAnnotation(hostService, hostProject, [stale]);

  assert.strictEqual(result, null);
});

test('uses an exact runtime id and SHA-256 fingerprint ahead of selector matches', () => {
  const identity = runtimeIdentity(hostService, hostProject);
  const result = matchRuntimeAnnotation(hostService, hostProject, [
    annotation({ pid: 41, description: 'PID description' }),
    annotation({
      pid: 41, description: 'Exact runtime description',
      runtimeId: identity.runtimeId, runtimeFingerprint: identity.runtimeFingerprint,
    }),
  ]);

  assert.strictEqual(result.type, 'runtime-identity');
  assert.strictEqual(result.annotation.description, 'Exact runtime description');
  assert.match(identity.runtimeFingerprint, /^sha256:[a-f0-9]{64}$/);
});

test('rejects an exact runtime annotation when a PID is reused with different facts', () => {
  const original = runtimeIdentity(hostService, hostProject);
  const reusedPid = { ...hostService, commandLine: 'node unrelated-server.js' };
  const result = matchRuntimeAnnotation(reusedPid, hostProject, [annotation({
    pid: 41, description: 'Original server',
    runtimeId: original.runtimeId, runtimeFingerprint: original.runtimeFingerprint,
  })]);

  assert.strictEqual(result, null);
});

test('matches project CWD only when an annotation has no port selector', () => {
  const projectAnnotation = annotation({ cwd: '/work/catalogue', description: 'Catalogue project' });
  const result = matchRuntimeAnnotation({ ...hostService, ports: [4000] }, hostProject, [projectAnnotation]);

  assert.strictEqual(result.type, 'project-working-dir');
});

test('recognizes host, Docker container, and published host ports', () => {
  assert.deepStrictEqual([...servicePorts(hostService)].sort((a, b) => a - b), [3000, 9229]);
  assert.deepStrictEqual([...servicePorts({
    ports: [{ containerPort: 5432, published: [{ hostPort: 55432 }] }],
  })].sort((a, b) => a - b), [5432, 55432]);
});

test('enrichment adds metadata without changing factual process or container fields', () => {
  const before = JSON.parse(JSON.stringify(hostService));
  const item = enrichRuntimeService(hostService, hostProject, [annotation({
    pid: 41,
    name: 'PortPilot dev server',
    description: 'Electron renderer on localhost.',
    launchedBy: 'Codex',
    task: 'runtime-catalogue',
  })]);

  assert.deepStrictEqual(hostService, before);
  assert.strictEqual(item.processName, 'node');
  assert.deepStrictEqual(item.ports, [3000, 9229]);
  assert.strictEqual(item.displayName, 'PortPilot dev server');
  assert.strictEqual(item.description, 'Electron renderer on localhost.');
  assert.strictEqual(item.annotationMatchType, 'pid');
  assert.deepStrictEqual(item.provenance, {
    launchedBy: 'Codex', task: 'runtime-catalogue', createdAt: NOW, updatedAt: NOW,
  });
});

test('enriches every service in a project without mutating its source collection', () => {
  const projects = [{ ...hostProject, services: [hostService, { ...hostService, id: 'host:pid:42', pid: 42, ports: [3001] }] }];
  const enriched = enrichRuntimeProjects(projects, [annotation({ cwd: '/work/catalogue', description: 'The PortPilot project' })]);

  assert.strictEqual(projects[0].services[0].annotation, undefined);
  assert.strictEqual(enriched[0].services[0].description, 'The PortPilot project');
  assert.strictEqual(enriched[0].services[1].description, 'The PortPilot project');
});

test('upsert updates a matching selector in place and keeps createdAt stable', () => {
  const first = upsertRuntimeAnnotation([], {
    cwd: '/work/catalogue', port: 3000, name: 'Catalogue dev server', description: 'First description',
  }, { now: NOW, random: () => 0 });
  const second = upsertRuntimeAnnotation(first.annotations, {
    cwd: '/WORK/catalogue/', port: 3000, description: 'Updated description',
  }, { now: '2026-08-21T12:05:00.000Z', random: () => 0 });

  assert.strictEqual(first.created, true);
  assert.strictEqual(second.created, false);
  assert.strictEqual(second.annotations.length, 1);
  assert.strictEqual(second.annotation.name, 'Catalogue dev server');
  assert.strictEqual(second.annotation.description, 'Updated description');
  assert.strictEqual(second.annotation.createdAt, NOW);
  assert.strictEqual(second.annotation.updatedAt, '2026-08-21T12:05:00.000Z');
  assert.strictEqual(annotationKey(second.annotation), 'cwd-port:/work/catalogue:3000');
});

test('strict upserts require the exact current runtime identity and reject stale writes', () => {
  const identity = runtimeIdentity(hostService, hostProject);
  const created = upsertRuntimeAnnotation([], {
    pid: 41, name: 'Catalogue dev server', description: 'Current process',
    runtimeId: identity.runtimeId, runtimeFingerprint: identity.runtimeFingerprint,
  }, { now: NOW, currentRuntime: { service: hostService, project: hostProject } });
  const stale = upsertRuntimeAnnotation(created.annotations, {
    id: created.annotation.id, description: 'Should not write',
    runtimeId: identity.runtimeId, runtimeFingerprint: 'sha256:stale',
  }, { now: '2026-08-21T12:05:00.000Z', currentRuntime: { service: hostService, project: hostProject } });

  assert.strictEqual(created.created, true);
  assert.strictEqual(annotationKey(created.annotation), `runtime:${identity.runtimeId}`);
  assert.strictEqual(stale.annotation, null);
  assert.deepStrictEqual(stale.annotations, created.annotations);
  assert.match(stale.errors.join(' '), /refresh before writing/);
});

test('upsert returns validation errors without changing persistent annotations', () => {
  const current = [annotation({ pid: 41, description: 'Existing' })];
  const result = upsertRuntimeAnnotation(current, { pid: 0, description: 'Invalid' }, { now: NOW });

  assert.deepStrictEqual(result.annotations, current);
  assert.strictEqual(result.annotation, null);
  assert.ok(result.errors.length > 0);
});

test('removes annotations by their stable id only', () => {
  const first = annotation({ pid: 41, description: 'First' });
  const second = annotation({ pid: 42, description: 'Second' });
  const missing = removeRuntimeAnnotation([first, second], 'missing');
  const removed = removeRuntimeAnnotation([first, second], first.id);

  assert.deepStrictEqual(missing.annotations, [first, second]);
  assert.strictEqual(removed.removed.id, first.id);
  assert.deepStrictEqual(removed.annotations, [second]);
});

test('ConfigStore persists annotations and reloads metadata used by runtime enrichment', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-annotations-'));
  const configPath = path.join(tempDir, 'portpilot-config.json');
  try {
    const store = new ConfigStore(null, configPath, { watch: false });
    store.saveRuntimeAnnotation({
      pid: hostService.pid,
      name: 'PortPilot dev server',
      description: 'Persistent metadata reloaded from disk.',
      launchedBy: 'Codex',
    });

    const reloaded = new ConfigStore(null, configPath, { watch: false });
    const [project] = enrichRuntimeProjects([{ ...hostProject, services: [hostService] }], reloaded.getRuntimeAnnotations());
    assert.strictEqual(reloaded.getRuntimeAnnotations().length, 1);
    assert.strictEqual(project.services[0].displayName, 'PortPilot dev server');
    assert.strictEqual(project.services[0].description, 'Persistent metadata reloaded from disk.');
    assert.strictEqual(project.services[0].provenance.launchedBy, 'Codex');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
