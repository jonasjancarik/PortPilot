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
exports.AppsTreeProvider = exports.AppTreeItem = exports.GroupTreeItem = void 0;
const vscode = __importStar(require("vscode"));
const config_1 = require("./config");
const portScanner_1 = require("./portScanner");
class GroupTreeItem extends vscode.TreeItem {
    group;
    apps;
    constructor(group, apps) {
        super(group.name, vscode.TreeItemCollapsibleState.Expanded);
        this.group = group;
        this.apps = apps;
        this.contextValue = 'group';
        this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.yellow'));
        this.description = `${apps.length} apps`;
    }
}
exports.GroupTreeItem = GroupTreeItem;
// A TreeView can't paint a row an arbitrary hex, but it can colour an icon with
// a registered ThemeColor. Map a branch's colour (the window's Peacock colour)
// to the nearest charts.* palette entry by hue so the branch icon is colour-coded
// roughly in step with the VS Code window.
function chartColorForHex(hex) {
    if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex))
        return undefined;
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let hue = 0;
    if (d !== 0) {
        if (max === r)
            hue = ((g - b) / d) % 6;
        else if (max === g)
            hue = (b - r) / d + 2;
        else
            hue = (r - g) / d + 4;
        hue = hue * 60;
        if (hue < 0)
            hue += 360;
    }
    const id = hue < 25 || hue >= 330 ? 'charts.red' :
        hue < 45 ? 'charts.orange' :
            hue < 70 ? 'charts.yellow' :
                hue < 170 ? 'charts.green' :
                    hue < 260 ? 'charts.blue' :
                        'charts.purple';
    return new vscode.ThemeColor(id);
}
class AppTreeItem extends vscode.TreeItem {
    app;
    activePort;
    children;
    constructor(app, activePort, children = []) {
        super(app.name, children.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None);
        this.app = app;
        this.activePort = activePort;
        this.children = children;
        const isRunning = !!activePort;
        const port = activePort?.port ?? app.preferredPort;
        const isBranch = !!app.parentId;
        this.contextValue = isRunning ? 'app-running' : 'app-stopped';
        // Branch rows get the git-branch icon, colour-coded by the branch colour, so
        // a child reads as a branch at a glance; top-level apps keep the status dot.
        this.iconPath = isBranch
            ? new vscode.ThemeIcon('git-branch', chartColorForHex(app.color) ??
                new vscode.ThemeColor(isRunning ? 'testing.iconPassed' : 'disabledForeground'))
            : new vscode.ThemeIcon(isRunning ? 'circle-filled' : 'circle-outline', isRunning
                ? new vscode.ThemeColor('testing.iconPassed')
                : new vscode.ThemeColor('disabledForeground'));
        const parts = [];
        if (isBranch && app.branch)
            parts.push(`\u2387 ${app.branch}`);
        if (port)
            parts.push(`:${port}`);
        if (isRunning)
            parts.push('running');
        if (children.length)
            parts.push(`\u2387${children.length}`); // branch count on a parent
        if (app.isFavorite)
            parts.push('\u2605');
        this.description = parts.join(' \u00b7 ');
        const tooltipLines = [
            app.name,
            ...(isBranch && app.branch ? [`Branch: ${app.branch}`] : []),
            ...(children.length ? [`Branches: ${children.length}`] : []),
            `Port: ${port ?? 'not set'}`,
            `Status: ${isRunning ? 'Running (PID ' + activePort.pid + ')' : 'Stopped'}`,
            `Command: ${app.command}`,
            `Directory: ${app.cwd}`
        ];
        if (app.description)
            tooltipLines.push(`Description: ${app.description}`);
        this.tooltip = tooltipLines.join('\n');
    }
}
exports.AppTreeItem = AppTreeItem;
class AppsTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    runningByAppId = new Map();
    async refresh() {
        const activePorts = await (0, portScanner_1.scanPorts)();
        this.runningByAppId = await (0, portScanner_1.computeRunning)((0, config_1.readConfig)().apps, activePorts);
        this._onDidChangeTreeData.fire(undefined);
    }
    async setActivePorts(ports) {
        this.runningByAppId = await (0, portScanner_1.computeRunning)((0, config_1.readConfig)().apps, ports);
        this._onDidChangeTreeData.fire(undefined);
    }
    getRunningByAppId() {
        return this.runningByAppId;
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element instanceof GroupTreeItem) {
            return element.apps;
        }
        // A parent app's children are its branch worktrees.
        if (element instanceof AppTreeItem) {
            return element.children;
        }
        const config = (0, config_1.readConfig)();
        if (!config.apps.length)
            return [];
        const groups = config.groups || [];
        const sortFn = (a, b) => {
            if (a.isFavorite !== b.isFavorite)
                return a.isFavorite ? -1 : 1;
            return a.name.localeCompare(b.name);
        };
        // Branch children (parentId pointing at a real app) nest under their parent,
        // not at the top level. Build the map once.
        const appIds = new Set(config.apps.map(a => a.id));
        const isChild = (a) => !!a.parentId && appIds.has(a.parentId);
        const childrenByParent = new Map();
        for (const a of config.apps) {
            if (isChild(a)) {
                const arr = childrenByParent.get(a.parentId) ?? [];
                arr.push(a);
                childrenByParent.set(a.parentId, arr);
            }
        }
        const topLevel = config.apps.filter(a => !isChild(a)).sort(sortFn);
        const makeAppItem = (app) => {
            const matched = this.runningByAppId.get(app.id);
            const kids = (childrenByParent.get(app.id) ?? [])
                .sort(sortFn)
                .map(makeAppItem);
            return new AppTreeItem(app, matched, kids);
        };
        // If no groups, return flat list of top-level apps (each carrying its branches)
        if (groups.length === 0) {
            return topLevel.map(makeAppItem);
        }
        // Build grouped tree
        const result = [];
        const groupedAppIds = new Set();
        for (const group of groups) {
            const groupApps = topLevel
                .filter(a => a.group === group.id)
                .map(a => {
                groupedAppIds.add(a.id);
                return makeAppItem(a);
            });
            if (groupApps.length > 0) {
                result.push(new GroupTreeItem(group, groupApps));
            }
        }
        // Ungrouped apps go at root level
        const ungrouped = topLevel
            .filter(a => !groupedAppIds.has(a.id))
            .map(makeAppItem);
        result.push(...ungrouped);
        return result;
    }
}
exports.AppsTreeProvider = AppsTreeProvider;
//# sourceMappingURL=appsTreeProvider.js.map