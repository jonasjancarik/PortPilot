#!/usr/bin/env node
/**
 * PortPilot Web Agent (v3 preview)
 *
 * A hardened loopback HTTP server that exposes PortPilot's backend to a browser
 * UI. Because this backend can start/kill processes, it is treated as a
 * high-value target and layers several independent defences (see SECURITY.md):
 *
 *   1. Binds to 127.0.0.1 ONLY            -> not reachable from the LAN/internet.
 *   2. Per-session 256-bit token          -> every /api call must present it.
 *   3. Host-header allowlist              -> defeats DNS-rebinding attacks.
 *   4. Origin allowlist + locked CORS     -> blocks cross-origin browser calls.
 *   5. Custom header forces CORS preflight-> "simple request" CSRF can't reach /api.
 *   6. Strict CSP on the served UI        -> no remote scripts / exfiltration.
 *
 * Any ONE of these is not enough on its own; they are deliberately combined.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { ConfigStore } = require('../main/configStore');
const { createDispatcher } = require('../core/dispatch');
const { getConfigDir } = require('../core/configPath');

const HOST = '127.0.0.1';
const PORT = parseInt(process.env.PORTPILOT_AGENT_PORT || '7317', 10);
const TOKEN = crypto.randomBytes(32).toString('hex');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const PUBLIC_DIR = path.join(__dirname, 'public');

const configStore = new ConfigStore(null);
const dispatch = createDispatcher(configStore);

// ---- Security helpers --------------------------------------------------------

function allowedHosts() {
  return new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
}
function allowedOrigins() {
  return new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);
}

/** Constant-time token comparison (avoids leaking the token via timing). */
function tokenOk(provided) {
  if (typeof provided !== 'string' || provided.length !== TOKEN.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(TOKEN));
  } catch {
    return false;
  }
}

/** Host-header check is the primary anti-DNS-rebinding control. */
function hostOk(req) {
  return allowedHosts().has((req.headers.host || '').toLowerCase());
}

function originOk(req) {
  const origin = req.headers.origin;
  // Same-origin GETs may omit Origin entirely - that's fine. A foreign Origin is not.
  return !origin || allowedOrigins().has(origin.toLowerCase());
}

function setSecurityHeaders(res, req) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Origin');
  // CORS: reflect ONLY our own origin, never '*', and only when it is allowed.
  const origin = req.headers.origin;
  if (origin && allowedOrigins().has(origin.toLowerCase())) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PortPilot-Token');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' });
}

// ---- Static UI ---------------------------------------------------------------

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };

function serveIndex(res) {
  // Reuse the desktop renderer's HTML verbatim, injecting (a) the per-session
  // token as a meta tag and (b) the web shim that backs window.portpilot.
  let html = fs.readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf8');
  html = html.replace('</head>', `  <meta name="pp-token" content="${TOKEN}">\n</head>`);
  html = html.replace(
    '<script src="renderer.js"></script>',
    '<script src="portpilot-web.js"></script>\n  <script src="renderer.js"></script>'
  );
  send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
}

function serveStatic(res, file, dir) {
  const full = path.join(dir, file);
  // Path-traversal guard: resolved path must stay within the directory.
  if (!path.resolve(full).startsWith(path.resolve(dir))) return send(res, 403, 'Forbidden');
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  });
}

// ---- Request handling --------------------------------------------------------

const server = http.createServer((req, res) => {
  // (3) Host allowlist first - rejects DNS-rebinding before anything else runs.
  if (!hostOk(req)) return send(res, 403, 'Forbidden: bad Host header');

  setSecurityHeaders(res, req);

  // CORS preflight for /api. We only get here with an allowed Host; a foreign
  // Origin will not be reflected above, so the browser blocks the real request.
  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (req.url === '/api' && req.method === 'POST') {
    // (4) Origin + (2) token. Cross-origin pages can neither read the token nor
    // pass the forced preflight, so both must hold.
    if (!originOk(req)) return sendJson(res, 403, { success: false, error: 'Bad origin' });
    if (!tokenOk(req.headers['x-portpilot-token'])) return sendJson(res, 401, { success: false, error: 'Unauthorized' });

    let raw = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) { tooBig = true; req.destroy(); }   // 1MB cap
    });
    req.on('end', async () => {
      if (tooBig) return;
      let payload;
      try { payload = JSON.parse(raw || '{}'); } catch { return sendJson(res, 400, { success: false, error: 'Invalid JSON' }); }
      const { action, args } = payload;
      if (typeof action !== 'string') return sendJson(res, 400, { success: false, error: 'Missing action' });
      const result = await dispatch(action, Array.isArray(args) ? args : []);
      sendJson(res, 200, result);
    });
    return;
  }

  // Static UI (GET only; protected by the Host check above).
  if (req.method === 'GET') {
    if (req.url === '/' || req.url === '/index.html') return serveIndex(res);
    if (req.url === '/portpilot-web.js') return serveStatic(res, 'portpilot-web.js', PUBLIC_DIR);
    if (req.url === '/renderer.js') return serveStatic(res, 'renderer.js', RENDERER_DIR);
    if (req.url === '/styles.css') return serveStatic(res, 'styles.css', RENDERER_DIR);
  }

  send(res, 404, 'Not found');
});

// ---- Startup -----------------------------------------------------------------

function writeAgentFile() {
  try {
    const dir = getConfigDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'agent.json');
    fs.writeFileSync(file, JSON.stringify({ host: HOST, port: PORT, token: TOKEN, pid: process.pid, url: `http://${HOST}:${PORT}/` }, null, 2), { mode: 0o600 });
    // Best-effort tighten perms even if the file already existed.
    try { fs.chmodSync(file, 0o600); } catch { /* non-POSIX */ }
    return file;
  } catch (e) {
    console.error('Could not write agent.json:', e.message);
    return null;
  }
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Set PORTPILOT_AGENT_PORT to choose another.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  const file = writeAgentFile();
  console.log('\n  PortPilot Web Agent running (loopback only)\n');
  console.log(`  →  http://${HOST}:${PORT}/`);
  console.log('\n  This URL is bound to 127.0.0.1 and protected by a per-session token.');
  if (file) console.log(`  Token also written to ${file} (chmod 600).`);
  console.log('  Press Ctrl+C to stop.\n');
});

function shutdown() {
  try { fs.rmSync(path.join(getConfigDir(), 'agent.json'), { force: true }); } catch { /* ignore */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
