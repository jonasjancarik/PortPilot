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
exports.WebPortal = void 0;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
// The standalone agent prints "  ->  http://127.0.0.1:<port>/" (with a Unicode
// arrow) on startup. We learn the URL from stdout and never read the token: the
// extension only needs the URL to open the browser; the token stays in the
// agent-served page and in agent.json (which we never read).
const URL_RE = /https?:\/\/127\.0\.0\.1:\d+\/?/;
const START_TIMEOUT_MS = 8000;
/**
 * Spawns and supervises the loopback web agent (runtime/agent/server.js) using
 * the editor's own Node via ELECTRON_RUN_AS_NODE, so the web portal runs while
 * this window is open with no Electron app. The agent is loopback-only and
 * token-gated; this manager owns its lifecycle and stops it on stop/deactivate.
 */
class WebPortal {
    context;
    child;
    url;
    starting = false;
    stdoutBuf = '';
    startTimer;
    statusBar;
    output;
    constructor(context) {
        this.context = context;
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
        this.statusBar.command = 'portpilot.openWebPortal';
        this.output = vscode.window.createOutputChannel('PortPilot Web Portal');
        this.context.subscriptions.push(this.statusBar, this.output, { dispose: () => this.stop() });
    }
    isRunning() {
        return !!this.child && !this.child.killed;
    }
    getUrl() {
        return this.url;
    }
    start(opts = {}) {
        if (this.isRunning() || this.starting) {
            if (opts.notify) {
                vscode.window.showInformationMessage(`PortPilot web portal is already running${this.url ? ' at ' + this.url : ''}.`);
            }
            return;
        }
        const serverJs = path.join(this.context.extensionPath, 'runtime', 'agent', 'server.js');
        const stopApps = vscode.workspace
            .getConfiguration('portpilot')
            .get('webPortal.stopAppsOnStop', false);
        this.starting = true;
        this.stdoutBuf = '';
        this.updateStatusBar();
        // The 4th stdio slot is an IPC channel: we send a 'shutdown' message for a
        // graceful stop (SIGTERM is not a real signal on Windows), and the agent
        // self-exits if this channel disconnects (the extension host died), so it
        // does not orphan.
        const child = cp.spawn(process.execPath, [serverJs, '--no-open'], {
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
                PORTPILOT_NO_OPEN: '1',
                PORTPILOT_STOP_APPS_ON_EXIT: stopApps ? '1' : '0',
            },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            windowsHide: true,
        });
        this.child = child;
        child.stdout?.on('data', (d) => {
            const text = d.toString();
            // INVARIANT: the agent must never print the token to stdout/stderr (it
            // logs only the URL + agent.json's path). This channel mirrors stdio
            // verbatim, so any future change that logged a secret would surface here.
            this.output.append(text);
            if (this.url)
                return;
            // Buffer across chunks so a URL split over two 'data' events still matches.
            this.stdoutBuf += text;
            const m = this.stdoutBuf.match(URL_RE);
            if (m) {
                this.stdoutBuf = '';
                this.url = m[0].endsWith('/') ? m[0] : m[0] + '/';
                this.starting = false;
                this.clearStartTimer();
                this.updateStatusBar();
                if (opts.notify) {
                    vscode.window
                        .showInformationMessage(`PortPilot web portal running at ${this.url}`, 'Open in Browser')
                        .then((c) => {
                        if (c)
                            this.openInBrowser();
                    });
                }
            }
        });
        child.stderr?.on('data', (d) => this.output.append(d.toString()));
        child.on('error', (err) => {
            this.starting = false;
            this.clearStartTimer();
            this.child = undefined;
            this.updateStatusBar();
            vscode.window.showErrorMessage(`PortPilot web portal failed to start: ${err.message}`);
        });
        child.on('exit', (code, signal) => {
            this.child = undefined;
            this.url = undefined;
            this.starting = false;
            this.clearStartTimer();
            this.updateStatusBar();
            // Crash (non-zero exit, not a signal we sent) - surface it. A deliberate
            // stop exits 0 (graceful) or via a signal, so this does not fire then.
            if (typeof code === 'number' && code !== 0 && signal == null) {
                this.output.show(true);
                vscode.window.showErrorMessage(`PortPilot web portal exited (code ${code}). See the "PortPilot Web Portal" output.`);
            }
        });
        // If the agent never reports a URL, don't leave the status bar spinning.
        this.startTimer = setTimeout(() => {
            if (this.starting && !this.url) {
                this.starting = false;
                this.updateStatusBar();
                this.output.show(true);
                vscode.window.showWarningMessage('PortPilot web portal did not report a URL in time. See the output channel.');
            }
        }, START_TIMEOUT_MS);
    }
    stop() {
        this.starting = false;
        this.clearStartTimer();
        const c = this.child;
        if (c && !c.killed) {
            // Graceful shutdown via IPC (works on Windows, unlike SIGTERM) so the
            // agent runs its cleanup (stopAppsOnStop + agent.json removal). Fall back
            // to signals only if it does not exit in time.
            try {
                if (c.connected)
                    c.send({ type: 'shutdown' });
            }
            catch {
                /* channel already gone */
            }
            const term = setTimeout(() => {
                try {
                    if (!c.killed)
                        c.kill('SIGTERM');
                }
                catch {
                    /* gone */
                }
            }, 3500);
            const kill = setTimeout(() => {
                try {
                    if (!c.killed)
                        c.kill('SIGKILL');
                }
                catch {
                    /* gone */
                }
            }, 6000);
            c.once('exit', () => {
                clearTimeout(term);
                clearTimeout(kill);
            });
        }
        this.child = undefined;
        this.url = undefined;
        this.updateStatusBar();
    }
    openInBrowser() {
        if (this.url) {
            vscode.env.openExternal(vscode.Uri.parse(this.url));
        }
        else {
            vscode.window.showWarningMessage('PortPilot web portal is not running.');
        }
    }
    clearStartTimer() {
        if (this.startTimer) {
            clearTimeout(this.startTimer);
            this.startTimer = undefined;
        }
    }
    updateStatusBar() {
        if (this.isRunning() && this.url) {
            this.statusBar.text = '$(broadcast) PP Portal';
            this.statusBar.tooltip = `PortPilot web portal: ${this.url} (click to open)`;
            this.statusBar.show();
        }
        else if (this.starting) {
            this.statusBar.text = '$(loading~spin) PP Portal';
            this.statusBar.tooltip = 'PortPilot web portal starting...';
            this.statusBar.show();
        }
        else {
            this.statusBar.hide();
        }
    }
}
exports.WebPortal = WebPortal;
//# sourceMappingURL=webPortal.js.map