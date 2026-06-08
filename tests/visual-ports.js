/**
 * Visual + smoke check for the redesigned grouped Active Ports view.
 * Launches the real Electron app, runs a scan against the machine's live
 * ports, captures console/page errors, and screenshots the ports section.
 *
 * Run: node tests/visual-ports.js
 * Output: docs/ui-redesign/phase1-*.png
 */
const { _electron: electron } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'ui-redesign');

(async () => {
  const errors = [];
  // --remote-debugging-port puts the app in test mode (bypasses the
  // single-instance lock, so this won't fight a PortPilot the user already has
  // open). ELECTRON_RUN_AS_NODE must be unset or Electron runs headless as Node.
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT, '--remote-debugging-port=9333'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  const win = await app.firstWindow();

  win.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  win.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await win.waitForLoadState('domcontentloaded');

  // Confirm the shared status module loaded under CSP and works in-context.
  const moduleCheck = await win.evaluate(() => {
    const S = window.PortPilotStatus;
    if (!S) return { ok: false, why: 'window.PortPilotStatus undefined' };
    return {
      ok: true,
      classifySvchost: S.classify({ port: 135, processName: 'svchost.exe', pid: 1908 }),
      classifyNode: S.classify({ port: 3000, processName: 'node.exe', commandLine: 'node next dev', pid: 1 }),
      groupOrder: S.GROUP_ORDER,
    };
  });
  console.log('module check:', JSON.stringify(moduleCheck));

  // Trigger a real scan and wait for rows (or time out gracefully).
  try {
    await win.click('#btn-scan', { timeout: 3000 });
  } catch { /* button id may differ; autoScan may already have run */ }
  await win.waitForTimeout(4500);

  const stats = await win.evaluate(() => {
    const groups = [...document.querySelectorAll('.port-group')].map((g) => ({
      key: g.dataset.portgroup,
      count: g.querySelectorAll('.port-row').length,
      collapsed: g.querySelector('.port-group-rows')?.classList.contains('collapsed') || false,
    }));
    return {
      summary: document.getElementById('ports-summary')?.textContent || '',
      count: document.getElementById('port-count')?.textContent || '',
      groups,
      rowCount: document.querySelectorAll('.port-row').length,
      dotCount: document.querySelectorAll('.status-dot').length,
    };
  });
  console.log('render stats:', JSON.stringify(stats, null, 2));

  await win.screenshot({ path: path.join(OUT, 'phase1-window.png') });
  const section = await win.$('#ports-section');
  if (section) await section.screenshot({ path: path.join(OUT, 'phase1-ports-default.png') });

  // Expand the System group to prove the collapse toggle works, then shoot again.
  const sysHeader = await win.$('.port-group[data-portgroup="system"] .port-group-header');
  if (sysHeader) {
    await sysHeader.click();
    await win.waitForTimeout(400);
    const section2 = await win.$('#ports-section');
    if (section2) await section2.screenshot({ path: path.join(OUT, 'phase1-ports-system-expanded.png') });
  }

  console.log('errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
  await app.close();
  process.exit(errors.length && !moduleCheck.ok ? 1 : 0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
