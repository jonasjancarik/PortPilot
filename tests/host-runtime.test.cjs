const assert = require('assert');
const {
  buildHostProjects,
  commandMentionsPath,
  hostListenerPorts,
} = require('../src/core/hostRuntime');
const {
  applyManagedProcessMetadata,
  buildUnifiedProjects,
  runningDockerHostPorts,
  parseLsofWorkingDirs,
} = require('../src/main/runtimeCatalog');

let passed = 0;
let failed = 0;

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

const apps = [
  { id: 'catalogue', name: 'Port catalogue', cwd: '/work/port-catalogue' },
  { id: 'catalogue-api', name: 'Port catalogue API', cwd: '/work/port-catalogue/api' },
];

test('groups multiple listener ports into one registered process service', () => {
  const projects = buildHostProjects([
    { port: 3000, pid: 410, processName: 'node', commandLine: 'node /work/port-catalogue/server.js', address: '127.0.0.1:3000' },
    { port: 9229, pid: 410, processName: 'node', commandLine: 'node /work/port-catalogue/server.js', address: '127.0.0.1:9229' },
  ], apps);

  assert.strictEqual(projects.length, 1);
  assert.strictEqual(projects[0].id, 'app:catalogue');
  assert.deepStrictEqual(projects[0].registeredAppIds, ['catalogue']);
  assert.strictEqual(projects[0].services.length, 1);
  assert.deepStrictEqual(projects[0].services[0].ports, [3000, 9229]);
  assert.strictEqual(projects[0].services[0].pid, 410);
  assert.strictEqual(projects[0].services[0].running, true);
  assert.strictEqual(projects[0].services[0].address, '127.0.0.1:3000');
});

test('prefers the most specific registered CWD when command paths overlap', () => {
  const projects = buildHostProjects([
    { port: 8080, pid: 411, processName: 'node', commandLine: 'node /work/port-catalogue/api/main.js' },
  ], apps);

  assert.strictEqual(projects[0].id, 'app:catalogue-api');
  assert.strictEqual(projects[0].services[0].matchType, 'command-cwd');
});

test('uses listener CWD and explicit app ID before command-line matching', () => {
  const projects = buildHostProjects([
    { port: 4000, pid: 412, processName: 'node', cwd: '/work/port-catalogue', commandLine: 'node /tmp/elsewhere.js' },
    { port: 4001, pid: 413, processName: 'node', appId: 'catalogue-api', commandLine: 'node /tmp/elsewhere.js' },
  ], apps);

  assert.deepStrictEqual(projects.map((project) => project.id), ['app:catalogue', 'app:catalogue-api']);
  assert.strictEqual(projects[0].services[0].matchType, 'cwd');
  assert.strictEqual(projects[1].services[0].matchType, 'app-id');
});

test('places unmatched and unknown-PID listeners in a clearly named host project', () => {
  const projects = buildHostProjects([
    { port: 5432, pid: 500, processName: 'postgres', commandLine: 'postgres' },
    { port: 7000, processName: 'mystery', address: '*:7000' },
  ], apps);
  const project = projects[0];

  assert.strictEqual(project.id, 'host:uncatalogued');
  assert.strictEqual(project.name, 'Uncatalogued host processes');
  assert.deepStrictEqual(project.services.map((service) => service.ports), [[7000], [5432]]);
  assert.deepStrictEqual(hostListenerPorts(projects), [5432, 7000]);
});

test('keeps distinct Windows bindings for a shared port and process', () => {
  const projects = buildHostProjects([{
    port: 3001,
    pid: 414,
    processName: 'node.exe',
    commandLine: 'node C:\\work\\port-catalogue\\server.js',
    bindings: [
      { pid: 414, address: '0.0.0.0:3001' },
      { pid: 414, address: '[::]:3001' },
    ],
  }], apps);
  const service = projects[0].services[0];

  assert.strictEqual(projects[0].id, 'app:catalogue');
  assert.deepStrictEqual(service.ports, [3001]);
  assert.deepStrictEqual(service.addresses, ['[::]:3001', '0.0.0.0:3001']);
  assert.strictEqual(service.commandLine, 'node C:\\work\\port-catalogue\\server.js');
});

test('path matching does not confuse one project with a similarly named sibling', () => {
  assert.strictEqual(commandMentionsPath('node /work/port-catalogue-next/server.js', '/work/port-catalogue'), false);
  assert.strictEqual(commandMentionsPath('node /work/port-catalogue/server.js', '/work/port-catalogue'), true);
});

test('merges host and Docker projects only when their working directories match', () => {
  const projects = buildUnifiedProjects(
    [{
      id: 'compose:catalogue', kind: 'compose', name: 'catalogue', workingDir: '/work/port-catalogue/',
      registeredAppIds: [], services: [{ id: 'container', running: true }],
    }],
    [{
      id: 'app:catalogue', kind: 'app', name: 'Port catalogue', workingDir: '/work/port-catalogue',
      registeredAppIds: ['catalogue'], services: [{ id: 'host:pid:1', running: true }],
    }, {
      id: 'host:uncatalogued', kind: 'host', name: 'Uncatalogued host processes', workingDir: null,
      registeredAppIds: [], services: [{ id: 'host:pid:2', running: true }],
    }],
  );
  const merged = projects.find((project) => project.id === 'cwd:/work/port-catalogue');

  assert.ok(merged);
  assert.strictEqual(merged.kind, 'mixed');
  assert.strictEqual(merged.name, 'Port catalogue');
  assert.deepStrictEqual(merged.sourceKinds, ['docker', 'host']);
  assert.strictEqual(merged.totalServices, 2);
  assert.strictEqual(merged.runningServices, 2);
  assert.strictEqual(projects.find((project) => project.id === 'host:uncatalogued').totalServices, 1);
});

test('uses managed process metadata to link a listener to its registered app', () => {
  const enriched = applyManagedProcessMetadata(
    [{ port: 3000, pid: 900, processName: 'node' }],
    [{ id: 'catalogue', pid: 900, cwd: '/work/port-catalogue', command: 'npm run dev', running: true }],
  );
  const projects = buildHostProjects(enriched, apps);

  assert.strictEqual(projects[0].id, 'app:catalogue');
  assert.strictEqual(projects[0].services[0].matchType, 'app-id');
});

test('only running containers suppress their published host ports', () => {
  const ports = runningDockerHostPorts([{
    services: [
      { running: true, ports: [{ published: [{ hostPort: 3000 }] }] },
      { running: false, ports: [{ published: [{ hostPort: 4000 }] }] },
    ],
  }]);

  assert.deepStrictEqual(ports, [3000]);
});

test('parses macOS lsof cwd records for batched process matching', () => {
  const parsed = parseLsofWorkingDirs('p410\nfcwd\nn/work/port-catalogue\np411\nfcwd\nn/work/other\n');
  assert.deepStrictEqual([...parsed.entries()], [[410, '/work/port-catalogue'], [411, '/work/other']]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
