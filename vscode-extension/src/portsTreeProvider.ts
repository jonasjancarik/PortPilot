import * as vscode from 'vscode';
import { readConfig } from './config';
import { ActivePort, scanPorts } from './portScanner';

// Shared classification model (single source of truth with the desktop app and
// web portal). Shipped into runtime/core/status.js by copy-runtime.js; required
// relative to the compiled out/ directory.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PortPilotStatus: {
  classify: (
    p: { port: number; processName?: string; commandLine?: string; pid?: number; appId?: string },
    opts?: { registered?: boolean }
  ) => 'dev' | 'other' | 'system';
  GROUPS: Record<string, { key: string; label: string; order: number; defaultCollapsed: boolean }>;
  GROUP_ORDER: string[];
} = require('../runtime/core/status.js');

type GroupKey = 'dev' | 'other' | 'system';

export class PortTreeItem extends vscode.TreeItem {
  constructor(public readonly activePort: ActivePort, matchedAppName?: string, group: GroupKey = 'other') {
    super(`:${activePort.port}`, vscode.TreeItemCollapsibleState.None);

    // System ports use a distinct contextValue so the kill / open-in-browser
    // context-menu items (gated on viewItem == active-port) never appear -
    // PortPilot should not invite killing OS-owned ports.
    this.contextValue = group === 'system' ? 'active-port-system' : 'active-port';

    const color = group === 'dev' ? 'charts.green' : group === 'system' ? 'disabledForeground' : 'charts.blue';
    this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(color));

    const desc = matchedAppName ?? activePort.processName;
    this.description = `${desc} (PID ${activePort.pid})`;

    this.tooltip = [
      `Port: ${activePort.port}`,
      `Process: ${activePort.processName}`,
      `PID: ${activePort.pid}`,
      matchedAppName ? `App: ${matchedAppName}` : ''
    ].filter(Boolean).join('\n');
  }
}

export class PortGroupTreeItem extends vscode.TreeItem {
  constructor(public readonly key: GroupKey, label: string, public readonly ports: PortTreeItem[], collapsed: boolean) {
    super(
      label,
      collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded
    );
    this.contextValue = 'port-group';
    this.description = `${ports.length}`;
    const glyph = key === 'dev' ? 'server-process' : key === 'system' ? 'gear' : 'plug';
    this.iconPath = new vscode.ThemeIcon(glyph);
  }
}

type PortNode = PortTreeItem | PortGroupTreeItem;

export class PortsTreeProvider implements vscode.TreeDataProvider<PortNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PortNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private cachedPorts: ActivePort[] = [];

  async refresh(): Promise<void> {
    this.cachedPorts = await scanPorts();
    this._onDidChangeTreeData.fire(undefined);
  }

  getCachedPorts(): ActivePort[] {
    return this.cachedPorts;
  }

  getTreeItem(element: PortNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PortNode): PortNode[] {
    if (element instanceof PortGroupTreeItem) {
      return element.ports;
    }

    // Root: classify the cached ports into Dev / Other / System groups, mirroring
    // the desktop app. Scanning is async and driven by refresh().
    const config = readConfig();
    const appByPort = new Map(
      config.apps.filter(a => a.preferredPort).map(a => [a.preferredPort!, a.name])
    );

    const buckets: Record<GroupKey, PortTreeItem[]> = { dev: [], other: [], system: [] };
    for (const p of this.cachedPorts) {
      const registered = appByPort.has(p.port);
      const group = PortPilotStatus.classify(
        { port: p.port, processName: p.processName, pid: p.pid },
        { registered }
      );
      buckets[group].push(new PortTreeItem(p, appByPort.get(p.port), group));
    }

    const groups: PortNode[] = [];
    for (const key of PortPilotStatus.GROUP_ORDER as GroupKey[]) {
      const ports = buckets[key];
      if (ports.length === 0) continue;
      const meta = PortPilotStatus.GROUPS[key];
      groups.push(new PortGroupTreeItem(key, meta.label, ports, meta.defaultCollapsed));
    }
    return groups;
  }
}
