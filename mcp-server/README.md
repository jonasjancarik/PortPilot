# PortPilot MCP Server

MCP (Model Context Protocol) server that allows Claude to manage local development servers via PortPilot.

## Features

Claude can now:
- **List apps** registered in PortPilot
- **Start/stop apps** by name or ID (individually or in bulk)
- **Scan ports** to see what's running
- **Catalogue host processes and Docker/Compose workloads** from live system state
- **Add persistent user-facing names and descriptions** to live runtimes without changing their OS/Docker facts
- **Add new apps** directly to PortPilot
- **Register git worktrees / branches** so they nest under the parent project and run on their own port alongside it
- **Kill processes** by port number
- **Manage favorites, groups** and app configurations

## Installation

```bash
cd mcp-server
npm install
```

## Configuration

### Claude Code CLI (Recommended)

Add the MCP server using the Claude CLI:

```bash
# Add to current project only
claude mcp add portpilot -- node "C:\path\to\PortPilot\mcp-server\index.js"

# Or add globally (available in all projects)
claude mcp add --scope user portpilot -- node "C:\path\to\PortPilot\mcp-server\index.js"
```

Verify it's connected:
```bash
claude mcp list
# Should show: portpilot: node ... - ✓ Connected
```

**After adding, restart Claude Code** to load the new MCP tools.

### Permissions (if needed)

If prompted for permissions, add to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__portpilot__*"]
  }
}
```

### Note on mcp_settings.json

⚠️ **Important:** The `~/.claude/mcp_settings.json` file is NOT used by Claude Code CLI. Always use `claude mcp add` to register MCP servers.

## Available Tools

The server currently exposes 22 tools. Runtime annotations are descriptive metadata only: the operating system and Docker remain authoritative for PID, command, image, ports, health, and running state. `annotate_runtime` requires the exact runtime ID and fingerprint returned by `list_runtimes`; PortPilot rejects the update when either value is stale, preventing a description from being applied to a replacement process or container.

| Tool | Description |
|------|-------------|
| `get_status` | Overview of apps, running ports and groups |
| `list_apps` | List all registered apps |
| `get_app` | Get details of a specific app |
| `list_running` | List currently running apps with ports |
| `list_runtimes` | List host processes and Docker/Compose services unified by project |
| `annotate_runtime` | Save a user-facing name and description for a live runtime using its current ID and fingerprint |
| `remove_runtime_annotation` | Remove a saved runtime annotation |
| `scan_ports` | Scan for active ports on the system |
| `check_port` | Check whether a specific port is in use |
| `start_app` | Start an app by ID or name |
| `stop_app` | Stop an app by ID or name |
| `bulk_start` | Start many apps at once (group, favorites, or all) |
| `bulk_stop` | Stop many apps at once (group, favorites, or all) |
| `add_app` | Register a new app in PortPilot |
| `add_worktree` | Register a git worktree/branch nested under its parent project, on its own port |
| `update_app` | Update an existing app |
| `delete_app` | Remove an app from PortPilot |
| `delete_all_apps` | Delete ALL apps (requires confirm: true) |
| `kill_port` | Kill process on a specific port |
| `toggle_favorite` | Toggle favorite status |
| `list_groups` | List all groups |
| `move_to_group` | Move an app into a group |

### `register-worktree` CLI

The same worktree logic is exposed as a CLI so scripts (e.g. `wt-mint.sh`) can register a branch without an MCP round-trip:

```bash
node mcp-server/index.js register-worktree --path <dir> \
  [--branch <name>] [--port <n>] [--parent <id|name>] \
  [--name <label>] [--command <cmd>] [--color <hex>]
```

Only `--path` is required; the branch and parent repo are auto-detected from git.

## Example Usage (in Claude)

```
"List all my PortPilot apps"
"Start the azure-practice-exam-platform app"
"What's running on port 3001?"
"Give the running PortPilot MCP server the name 'PortPilot MCP' and describe it as the local service that lets Codex inspect and manage development runtimes"
"Add a new app called 'hero-concepts-preview' at C:\Scratch\azure-practice-exam-platform with command 'npm run web' on port 3001"
"Stop mocksnap"
"Kill whatever is running on port 3000"
"Add the current worktree to PortPilot on port 3002"
"Delete all apps from PortPilot"
"Favorite the AzurePrep app"
```

## Config File Location

PortPilot stores its config at:
- **Windows:** `%APPDATA%\PortPilot\portpilot-config.json`
- **macOS:** `~/Library/Application Support/PortPilot/portpilot-config.json`
- **Linux:** `~/.config/PortPilot/portpilot-config.json`

## Notes

- The MCP server reads/writes directly to PortPilot's config file
- Changes made via Claude will appear in PortPilot UI after refresh
- Start/stop operations work independently of PortPilot GUI
- Port scanning uses native system commands (netstat/lsof/ss)
