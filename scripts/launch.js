#!/usr/bin/env node
/**
 * Cross-platform launcher that clears ELECTRON_RUN_AS_NODE
 * before starting Electron (fixes VS Code/Claude Code environment issue)
 */
const { spawn } = require('child_process');
const path = require('path');
const { computeDir } = require('../src/core/configPath');

// Clear the problematic env var
delete process.env.ELECTRON_RUN_AS_NODE;

// Get electron path
const electronPath = require('electron');

// Project root is one level up from scripts/
const projectRoot = path.join(__dirname, '..');

// Get args (skip 'node' and 'launch.js')
const args = [projectRoot, ...process.argv.slice(2)];
const isDev = process.argv.slice(2).includes('--dev');

// Let the installed app own the normal config directory and MCP port. A dev
// instance still scans the same OS listeners and Docker Engine, but keeps its
// own registered apps, logs, reservations, Electron profile, and MCP server.
if (isDev) {
  process.env.PORTPILOT_CONFIG_DIR ||= computeDir('portpilot-dev');
  process.env.PORTPILOT_MCP_PORT ||= '8789';
  process.env.PORTPILOT_DEV_MODE = '1';
}

// Spawn electron
const child = spawn(electronPath, args, {
  stdio: 'inherit',
  cwd: projectRoot,
  env: process.env
});

child.on('close', (code) => {
  process.exit(code);
});
