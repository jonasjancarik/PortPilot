"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanPorts = scanPorts;
exports.killPort = killPort;
const child_process_1 = require("child_process");
const util_1 = require("util");
const os = __importStar(require("os"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * Scan listening TCP ports.
 *
 * Async (never blocks the extension host) and, on Windows, resolves every PID's
 * process name in a SINGLE `tasklist` call instead of spawning one `wmic`
 * process per port - which was the cause of the extension's slow/janky load.
 * `tasklist` is also future-proof: `wmic` is deprecated/removed on recent
 * Windows 11 builds.
 */
async function scanPorts() {
    const platform = os.platform();
    try {
        if (platform === 'win32') {
            return await scanWindows();
        }
        else if (platform === 'darwin') {
            return await scanDarwin();
        }
        else {
            return await scanLinux();
        }
    }
    catch (error) {
        console.error('PortPilot: Port scan error:', error);
        return [];
    }
}
async function scanWindows() {
    const { stdout } = await execAsync('netstat -ano', {
        encoding: 'utf-8',
        timeout: 15000,
        maxBuffer: 8 * 1024 * 1024,
    });
    // Identify listening sockets locale-independently: their foreign address ends
    // in ":0" (no remote peer). Avoids matching localized state strings.
    const portToPid = new Map();
    for (const line of stdout.split('\n')) {
        if (!/^\s*TCP\b/i.test(line))
            continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5)
            continue;
        if (!/:0$/.test(parts[2] || ''))
            continue;
        const portMatch = parts[1].match(/:(\d+)$/);
        if (!portMatch)
            continue;
        const port = parseInt(portMatch[1], 10);
        const pid = parseInt(parts[4], 10);
        if (port >= 1 && port <= 65535 && !portToPid.has(port)) {
            portToPid.set(port, pid);
        }
    }
    const names = await getProcessNamesWindows([...new Set(portToPid.values())]);
    const ports = [];
    for (const [port, pid] of portToPid) {
        ports.push({ port, pid, processName: names.get(pid) || 'Unknown' });
    }
    return ports.sort((a, b) => a.port - b.port);
}
/** One batched PID -> image-name lookup via tasklist CSV (locale-safe). */
async function getProcessNamesWindows(pids) {
    const map = new Map();
    if (pids.length === 0)
        return map;
    try {
        const { stdout } = await execAsync('tasklist /fo csv /nh', {
            encoding: 'utf-8',
            timeout: 10000,
            maxBuffer: 8 * 1024 * 1024,
        });
        const wanted = new Set(pids);
        for (const line of stdout.split('\n')) {
            // CSV row: "Image Name","PID","Session Name","Session#","Mem Usage"
            const cols = line.split('","').map(c => c.replace(/^"|"$/g, '').trim());
            if (cols.length < 2)
                continue;
            const pid = parseInt(cols[1], 10);
            if (wanted.has(pid))
                map.set(pid, cols[0]);
        }
    }
    catch {
        /* names stay 'Unknown' */
    }
    return map;
}
async function scanDarwin() {
    const { stdout } = await execAsync('lsof -iTCP -sTCP:LISTEN -n -P', {
        encoding: 'utf-8',
        timeout: 10000,
        maxBuffer: 8 * 1024 * 1024,
    });
    const ports = [];
    for (const line of stdout.split('\n').slice(1)) {
        const parts = line.split(/\s+/);
        if (parts.length >= 9) {
            const portMatch = parts[8]?.match(/:(\d+)$/);
            if (portMatch) {
                ports.push({ port: parseInt(portMatch[1], 10), pid: parseInt(parts[1], 10), processName: parts[0] });
            }
        }
    }
    return dedupe(ports);
}
async function scanLinux() {
    let stdout;
    try {
        ({ stdout } = await execAsync('ss -tlnp', { encoding: 'utf-8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 }));
    }
    catch {
        ({ stdout } = await execAsync('netstat -tlnp', { encoding: 'utf-8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 }));
    }
    const ports = [];
    for (const line of stdout.split('\n')) {
        const portMatch = line.match(/:(\d+)\s/);
        const pidMatch = line.match(/pid=(\d+)/) || line.match(/\s(\d+)\//);
        const nameMatch = line.match(/(?:pid=\d+,)?(?:comm=)?"?([\w.-]+)"?\)?\s*$/) || line.match(/\d+\/([\w.-]+)/);
        if (portMatch) {
            ports.push({
                port: parseInt(portMatch[1], 10),
                pid: pidMatch ? parseInt(pidMatch[1], 10) : 0,
                processName: nameMatch ? nameMatch[1] : 'Unknown',
            });
        }
    }
    return dedupe(ports);
}
function dedupe(ports) {
    return [...new Map(ports.map(p => [p.port, p])).values()].sort((a, b) => a.port - b.port);
}
/**
 * Kill whatever is listening on a port.
 *
 * On Windows this looks up the PID via the (locale-independent) scan rather than
 * `findstr LISTENING`, which fails on non-English Windows (the same bug fixed in
 * the desktop app in v1.7 but previously left here).
 */
async function killPort(port) {
    const platform = os.platform();
    try {
        if (platform === 'win32') {
            const match = (await scanPorts()).find(p => p.port === port);
            if (!match || !match.pid)
                return false;
            await execAsync(`taskkill /F /PID ${match.pid}`);
            return true;
        }
        else {
            const { stdout } = await execAsync(`lsof -ti:${port}`, { encoding: 'utf-8' });
            const pid = stdout.trim().split('\n')[0];
            if (!pid)
                return false;
            await execAsync(`kill -9 ${pid}`);
            return true;
        }
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=portScanner.js.map