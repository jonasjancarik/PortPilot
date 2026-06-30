/**
 * Unit/integration test for detectWorktrees (Wave 3, Slice 9).
 * Builds a real git repo + linked worktree on disk and checks detection,
 * registered-marking, and Peacock-colour reading.
 *
 * Run: node tests/worktree-detect.test.cjs
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { detectWorktrees, detectStaleWorktrees } = require('../src/main/ipcHandlers');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('OK ', name); pass++; }
  catch (e) { console.log('XX ', name, '-', e.message); fail++; }
}

const g = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });

const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pp-detect-')));
const repo = path.join(base, 'repo');
const wt = path.join(base, 'repo-feat');
try {
  fs.mkdirSync(repo);
  g('git init -b main', repo);
  g('git config user.email t@t.t', repo);
  g('git config user.name test', repo);
  fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
  g('git add -A', repo);
  g('git commit -m init', repo);
  g(`git worktree add "${wt}" -b feat/detect`, repo);
  fs.mkdirSync(path.join(wt, '.vscode'));
  fs.writeFileSync(path.join(wt, '.vscode', 'settings.json'), '{\n  // window colour\n  "peacock.color": "#42B883"\n}\n');

  const store = (apps) => ({
    getApp: (id) => apps.find((a) => a.id === id),
    getApps: () => apps,
  });

  t('detects the linked worktree, unregistered, with Peacock colour (JSONC-safe)', () => {
    const res = detectWorktrees(store([{ id: 'p', name: 'Repo', command: 'npm run dev', cwd: repo }]), 'p');
    assert.equal(res.success, true);
    assert.equal(res.candidates.length, 1);
    const c = res.candidates[0];
    assert.equal(c.branch, 'feat/detect');
    assert.equal(c.registered, false);
    assert.equal(c.color, '#42B883');
    assert.equal(c.colorSource, 'peacock');
  });

  t('marks the worktree registered when an app already has its cwd', () => {
    const res = detectWorktrees(store([
      { id: 'p', name: 'Repo', command: 'npm run dev', cwd: repo },
      { id: 'c', name: 'Repo', cwd: wt },
    ]), 'p');
    assert.equal(res.candidates.length, 1);
    assert.equal(res.candidates[0].registered, true);
  });

  t('never offers the parent worktree itself', () => {
    const res = detectWorktrees(store([{ id: 'p', name: 'Repo', cwd: repo }]), 'p');
    assert.ok(res.candidates.every((c) => c.path !== repo));
  });

  t('errors cleanly for a non-git directory', () => {
    const res = detectWorktrees(store([{ id: 'p', name: 'X', cwd: base }]), 'p');
    assert.equal(res.success, false);
  });

  t('detectStaleWorktrees flags a branch whose folder is gone, not live ones or plain apps', () => {
    const gone = path.join(base, 'removed-worktree');
    const res = detectStaleWorktrees(store([
      { id: 'live', name: 'Repo', branch: 'feat/detect', parentId: 'p', cwd: wt, worktreePath: wt }, // exists
      { id: 'gone', name: 'Repo', branch: 'feat/old', parentId: 'p', cwd: gone, worktreePath: gone }, // missing
      { id: 'plain', name: 'PlainApp', cwd: path.join(base, 'also-missing') }, // not a worktree -> ignored
    ]));
    assert.equal(res.success, true);
    assert.deepEqual(res.ids, ['gone']);
  });
} finally {
  try { g(`git worktree remove "${wt}" --force`, repo); } catch { /* best effort */ }
  fs.rmSync(base, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
