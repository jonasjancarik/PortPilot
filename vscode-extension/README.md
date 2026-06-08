# PortPilot for VS Code

Manage your localhost dev servers and ports without leaving the editor.

PortPilot puts your registered apps and all active ports in the VS Code sidebar, with a live **"PP: N running"** status-bar counter. It shares one config with the [PortPilot desktop app](https://github.com/m4cd4r4/PortPilot) and an MCP server, so what you see here stays in sync everywhere.

## Features

- **Sidebar tree** of your apps (with collapsible groups) and all active TCP ports, each showing its process and PID.
- **Start / stop apps**, kill ports, open in browser, change ports, toggle favourites - all from the sidebar.
- **Two-phase running detection** - an app started on a dynamic or non-preferred port is still detected, showing its live port instead of reading "stopped".
- **Status bar**: a live "PP: N running" counter; click to refresh.

## New in 3.1: Web Portal, hosted from VS Code

Enable **`portpilot.webPortal.enabled`** (opt-in, off by default) and PortPilot runs its full browser UI straight from VS Code - no desktop app needed. A **"PP Portal"** status-bar item appears; click it to open `http://127.0.0.1:<port>/`.

- Spawns a hardened, **loopback-only, token-gated** local agent using the editor's own Node.
- Graceful shutdown that works on Windows; the agent self-exits if the editor closes, so it does not orphan.
- Optional `portpilot.webPortal.stopAppsOnStop` also stops the dev servers the portal started.

The portal binds `127.0.0.1` only and is gated by a per-session token. Full threat model in [SECURITY.md](https://github.com/m4cd4r4/PortPilot/blob/master/SECURITY.md).

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `portpilot.webPortal.enabled` | `false` | Run the web portal whenever this window is open. |
| `portpilot.webPortal.stopAppsOnStop` | `false` | Also stop the dev servers the portal started when it stops. |

## Commands

`PortPilot: Start / Stop / Open Web Portal`, plus add/edit/delete apps, change ports, kill ports, and scan ports - all from the Command Palette or the sidebar.

## Links

- [GitHub repository](https://github.com/m4cd4r4/PortPilot)
- [Desktop app downloads](https://github.com/m4cd4r4/PortPilot/releases/latest)

MIT licensed.
