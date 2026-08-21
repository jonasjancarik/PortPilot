/**
 * Shared config-path resolver.
 *
 * The desktop app, the MCP server, and the web agent must all read/write the
 * SAME file. Electron derives its userData dir from the lowercase package "name"
 * ("portpilot"); this module reproduces that path so a standalone Node process
 * (the agent) lands on exactly the same location, cross-platform.
 *
 * No hard dependency on Electron - when running inside Electron we defer to
 * app.getPath('userData') (authoritative); otherwise we compute it from the OS.
 */
const os = require('os');
const path = require('path');

const APP_DIR = 'portpilot';

function computeDir(appDir = APP_DIR) {
  if (process.env.PORTPILOT_CONFIG_DIR) {
    return path.resolve(process.env.PORTPILOT_CONFIG_DIR);
  }
  const platform = os.platform();
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appDir);
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appDir);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), appDir);
}

function getConfigDir() {
  // Inside Electron, require('electron') returns the API (app available after
  // ready). In a plain Node process it returns a path string, so app is
  // undefined and we fall back to the computed location (same result).
  try {
    const electron = require('electron');
    if (electron && electron.app && typeof electron.app.getPath === 'function') {
      return electron.app.getPath('userData');
    }
  } catch { /* not running under Electron */ }
  return computeDir();
}

function getConfigPath() {
  return path.join(getConfigDir(), 'portpilot-config.json');
}

module.exports = { getConfigDir, getConfigPath, computeDir };
