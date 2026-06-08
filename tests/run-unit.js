/**
 * Fast unit tests for the pure shared modules (no Electron, no display).
 * Run: npm run test:unit
 *
 * The comprehensive suite is Playwright-based and needs a display; this runner
 * covers the framework-free logic in src/core so it can run anywhere in CI.
 */
const assert = require('assert');
const { classify, statusOf, STATES, GROUPS, GROUP_ORDER } = require('../src/core/status');

let passed = 0;
let failed = 0;

function t(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}\n     ${err.message}`);
    failed++;
  }
}

console.log('\n=== src/core/status.js ===\n');

// ---- classify: system -----------------------------------------------------
t('svchost on :135 -> system', () =>
  assert.strictEqual(classify({ port: 135, processName: 'svchost.exe', pid: 1908 }), 'system'));

t('System pid 4 on :445 -> system', () =>
  assert.strictEqual(classify({ port: 445, processName: 'System', pid: 4 }), 'system'));

t('vmms.exe on :2179 (Hyper-V) -> system', () =>
  assert.strictEqual(classify({ port: 2179, processName: 'vmms.exe', pid: 2932 }), 'system'));

t('mDNS :5353 -> system (by well-known port)', () =>
  assert.strictEqual(classify({ port: 5353, processName: 'whatever', pid: 500 }), 'system'));

t('launchd -> system (macOS)', () =>
  assert.strictEqual(classify({ port: 88, processName: 'launchd', pid: 1 }), 'system'));

// ---- classify: dev --------------------------------------------------------
t('node next dev on :3000 -> dev', () =>
  assert.strictEqual(classify({ port: 3000, processName: 'node.exe', commandLine: 'node next dev', pid: 18244 }), 'dev'));

t('vite on :5173 -> dev', () =>
  assert.strictEqual(classify({ port: 5173, processName: 'node.exe', commandLine: 'vite', pid: 9921 }), 'dev'));

t('uvicorn python on :8000 -> dev', () =>
  assert.strictEqual(classify({ port: 8000, processName: 'python.exe', commandLine: 'uvicorn app:main', pid: 4001 }), 'dev'));

t('registered app always dev, even off-range / odd process', () =>
  assert.strictEqual(classify({ port: 1234, processName: 'mystery', pid: 77 }, { registered: true }), 'dev'));

t('port carrying appId is dev', () =>
  assert.strictEqual(classify({ port: 4321, processName: 'mystery', pid: 78, appId: 'solaisoft' }), 'dev'));

// ---- classify: other ------------------------------------------------------
t('postgres on :5432 -> other', () =>
  assert.strictEqual(classify({ port: 5432, processName: 'postgres.exe', pid: 7710 }), 'other'));

t('redis on :6379 -> other', () =>
  assert.strictEqual(classify({ port: 6379, processName: 'redis-server', pid: 8120 }), 'other'));

t('node on a high ephemeral port (out of dev range) -> other', () =>
  assert.strictEqual(classify({ port: 54321, processName: 'node.exe', commandLine: 'node', pid: 5 }), 'other'));

t('unknown process on :7100 -> other', () =>
  assert.strictEqual(classify({ port: 7100, processName: 'mysteryd', pid: 9000 }), 'other'));

// ---- classify: robustness -------------------------------------------------
t('missing fields do not throw -> other', () =>
  assert.strictEqual(classify({ port: 7200 }), 'other'));

t('empty input does not throw', () =>
  assert.doesNotThrow(() => classify({})));

t('"go" does not false-match inside "googleupdate"', () =>
  assert.strictEqual(classify({ port: 4000, processName: 'googleupdate.exe', pid: 33 }), 'other'));

// ---- statusOf -------------------------------------------------------------
t('running boolean -> running', () =>
  assert.strictEqual(statusOf({ running: true }).state, 'running'));

t('no flags -> stopped (default)', () =>
  assert.strictEqual(statusOf({}).state, 'stopped'));

t('conflict beats running', () =>
  assert.strictEqual(statusOf({ running: true, conflict: true }).state, 'conflict'));

t('error beats everything', () =>
  assert.strictEqual(statusOf({ running: true, conflict: true, starting: true, error: true }).state, 'error'));

t('explicit state passes through', () =>
  assert.strictEqual(statusOf({ state: 'starting' }).state, 'starting'));

t('unknown explicit state falls back to derivation', () =>
  assert.strictEqual(statusOf({ state: 'bogus', running: true }).state, 'running'));

t('null/undefined item does not throw', () =>
  assert.doesNotThrow(() => { statusOf(null); statusOf(undefined); }));

// ---- model integrity ------------------------------------------------------
t('every state has token, label, shape, glyph', () =>
  Object.values(STATES).forEach((s) => {
    assert.ok(s.token && s.label && s.shape && s.glyph, `incomplete descriptor: ${JSON.stringify(s)}`);
  }));

t('GROUP_ORDER covers every group and System is collapsed by default', () => {
  assert.deepStrictEqual([...GROUP_ORDER].sort(), Object.keys(GROUPS).sort());
  assert.strictEqual(GROUPS.system.defaultCollapsed, true);
  assert.strictEqual(GROUPS.dev.defaultCollapsed, false);
});

// ---- summary --------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
