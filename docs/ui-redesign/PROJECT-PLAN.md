# PortPilot UI Redesign - Project Plan

Direction chosen: **Grouped Collapsible Dense List + slide-over drawer** (Direction 2 from [REDESIGN-DIRECTIONS.md](./REDESIGN-DIRECTIONS.md)).

Goal: kill the "very flat" feeling. Separate the user's real dev servers from OS/system noise, give every row a status, and put verbose detail in an on-demand drawer instead of on every card.

This plan is the coordination lock. Update the status table in the same commit that starts, merges, or supersedes any phase.

## Why this direction

All 13 research agents named the same #1 fix: collapsible grouped rows with counted headers that split dev servers from system noise, each row led by a status dot. Direction 2 delivers that first and cheapest, on the existing vanilla HTML/CSS/JS renderer, with no framework. The drawer and (optional) left rail are the same primitives the heavier three-pane shell would need, so this is the three-pane shell built incrementally, lowest-risk-first - not a dead end.

## Grounding in the current code

| Concern | Where it lives today | Reuse |
|---|---|---|
| Port list render | `src/renderer/renderer.js` `renderPorts()` ~L508 | Replace card `.map()` with grouped table |
| Port data shape | `{port, processName, commandLine, pid, memory?, uptime?, connections?}` | Drives status + drawer |
| App<->port matching | `matchedPorts` set, matched ports filtered OUT of active list (~L512-516) | Surface matched ports as "My Dev Servers" |
| Per-item detail fetch | `state.expandedPorts` Map -> `ports.getDetails(pid, port)` | Feeds the drawer |
| Collapse pattern | `state.portsCollapsed` + `.collapsed` CSS toggle (~L354) | Extend to per-group collapse |
| Theming | CSS variables per theme (6 themes) | Status colours become per-theme vars |
| Actions | `openPortInBrowser` / `copyPort` / `killPort` by `data-act` (~L249-252) | Move to hover + drawer, gate kill |

## Status model (the shared spine)

Five states, shape-differentiated so they survive greyscale and all 6 themes:

| State | Glyph | Colour var | Meaning |
|---|---|---|---|
| running | filled disc | `--status-running` (green) | dev server / process is up |
| stopped | hollow ring | `--status-stopped` (grey) | registered app, not running |
| starting | pulsing disc | `--status-starting` (amber) | transient, animated |
| conflict | triangle | `--status-conflict` (amber) | port wanted by >1 process / preferred-port taken |
| error | circle-x | `--status-error` (red) | failed to start / dead |

Classification: `classify(port)` -> `dev | other | system`.
- **dev**: matches a registered app, OR a known dev runtime (node/vite/next/python/deno/bun/php/ruby) in the 3000-9999 range.
- **system**: svchost / System / PID 4 / well-known OS ports (135, 139, 445, 5353, etc).
- **other**: everything else (postgres, redis, docker-proxy, unknown).

Both `classify()` and `statusOf()` live in ONE shared module so desktop, VS Code, and web read identical results. Group-collapse state, pins, and last filter/sort persist in the shared JSON config.

### Phase 0 landed (2026-06-08)

- Module: `src/core/status.js` - UMD (CommonJS `require` for main/agent/tests; `window.PortPilotStatus` global for the renderer, which runs `nodeIntegration:false` and cannot `require`). Exports `classify`, `statusOf`, `STATES`, `GROUPS`, `GROUP_ORDER`.
- CSS: `--status-running/stopped/starting/conflict/error` added once on `body` in `src/renderer/styles.css`, mapped to each theme's existing accents (resolves per-theme automatically). Inert until Phase 1 draws the dots.
- Tests: `tests/run-unit.js` (26 cases, no display) via `npm run test:unit`.
- **Phase 1 wiring note:** the renderer cannot `require`, so add `<script src="../core/status.js"></script>` before `renderer.js` in `index.html`, then call `window.PortPilotStatus.classify(p)` / `.statusOf(...)` inside `renderPorts()`. For the agent/web portal (Phase 7), add `core/status.js` to `vscode-extension/scripts/copy-runtime.js` so it ships in the bundle.

### Phase 1 landed (2026-06-08)

- `renderPorts()` now classifies the unmatched ports via `window.PortPilotStatus.classify` and renders three collapsible groups (`renderPortGroup` / `renderPortRow`): My Dev Servers / Other User Ports / System & OS, System collapsed by default. Per-group collapse persists in settings (`portGroupExpanded`).
- Each row is a 6-column grid (status dot / :port link / process / command / pid / actions), aligned across rows. `:PORT` opens localhost. A network-exposed glyph shows when a port binds beyond loopback.
- Header label changed "Unmatched Ports" -> "Active Ports"; added a `#ports-summary` breakdown ("N dev · N other · N system").
- Status-dot shape classes + `--status-*` are used live (all active ports = running/green for now; conflict/error/starting states arrive with app-merge in Phase 2).
- Verified against a real 43-port scan via `node tests/visual-ports.js` (Electron + Playwright): 4 dev / 27 other / 12 system, System collapsed, zero console errors, module loads under CSP.
- **Known leftover:** the old `.port-card*` / `.cmd-tooltip*` CSS rules in `styles.css` are now dead (their only consumer was the replaced markup). Left in place to keep the Phase 1 diff additive; clear them in the Phase 5 settings/polish pass.
- **Not yet (Phase 2+):** registered apps still render in their own Apps section, not merged into My Dev Servers. Actions are still always-present (lightly dimmed until hover); full hover-reveal, kill-gating on system rows, and the detail drawer come in Phase 3.

## Phase / PR breakdown

Each phase is one shippable PR. Wave gates: finish a wave before scoping the next.

### Wave 1 - foundation + the P0 win

| # | Phase | Surface | Scope | Effort | Status |
|---|---|---|---|---|---|
| 0 | Shared model | all (core) | `classify(port)` + `statusOf(item)` + status CSS variables for all themes. Pure functions, unit-tested. No UI change yet. | S | **done** (2026-06-08) |
| 1 | Grouped dense table | desktop | Replace the two-column card grid with a single dense table grouped into collapsible counted sections: MY DEV SERVERS (expanded) / OTHER USER PORTS / SYSTEM & OS (collapsed by default). Status dot in a fixed left gutter + state word. `:PORT` as a clickable localhost link. Aligned columns (status / :port / process / pid / command). Summary line "N dev running - N conflict - N total". | M | **done** (2026-06-08) |
| 2 | Unify apps + ports (revised) | desktop | Adopt-as-app bridge + reframe. See revision note below: the literal merge was dropped after Wave 1 review. | M | **done** (2026-06-08) |

### Phase 2 landed (2026-06-08) - revised scope

Wave 1 review changed this phase. The pre-wave plan assumed apps and ports were split and needed merging into one "My Dev Servers" list. Reading the code showed `renderAppCard` **already** reconciles each app with its live resolved port, status dot, uptime/PID, and start/stop - plus favorites, custom groups, drag-reorder, and multi-select. A literal merge would have to relocate or dumb-down all of that, regressing the apps surface for no real gain. So the literal merge was dropped in favour of the plan's other clause - the genuinely missing capability:

- **Adopt as app**: every unregistered running port in the Dev and Other groups gets a `+` action. It opens the Add App modal pre-filled with the port and the running command (and a name guess), so the user refines the start command / working directory and saves. Once registered, the port matches the app and moves up into the Apps section on the next scan - the adoption *is* the unification, one click at a time. System ports never get adopt.
- **Reframe**: shared `GROUPS.dev.label` "My Dev Servers" -> "Dev Servers" (the registered ones live in the Apps section above; this group is unregistered dev servers, i.e. the adoption candidates).
- **Collision fix (Phase 1 debt)**: the new status-dot rules were scoped under `.port-row` so they no longer fight the legacy app-card `.status-dot` rule. Without this, the triangle/circle-x shapes would have broken once conflict/error states render.

Verified via `node tests/visual-ports.js` (now isolated with `--user-data-dir`, so it never mutates real settings): 34 adopt buttons (7 dev + 27 other + 0 system), the adopt click opens a pre-filled "Add App" modal (port 3031, command populated), System collapsed by default, dot count == row count, zero console errors.

If a true single-list merge is ever wanted, it belongs in its own phase with the apps-section groups/favorites/selection machinery moved wholesale - not folded into this one.

**Wave 1 is complete** (Phases 0, 1, 2). Retro the Wave 2 scope below against what shipped before minting it.

### Wave 2 - depth + polish (scope AFTER Wave 1 ships)

| # | Phase | Surface | Scope | Effort | Status |
|---|---|---|---|---|---|
| 3 | Detail drawer + safe actions | desktop | Slide-over right drawer on row click: full untruncated command, PID, cwd, uptime, copy/kill/open. Reuse `expandedPorts` detail fetch. Hover-reveal row actions, Start XOR Stop never both. Gate kill off system rows (hidden/disabled + typed confirm). | M | later |
| 4 | Search + filters + sort | desktop | Replace the lone filter box with search + quick-filter chips (Mine / Dev / System / Conflicts) + sort dropdown, persisted in config. | S | later |
| 5 | Settings refresh | desktop | Category sub-nav (Appearance / Scanning / Data / About) + detail pane. Theme picker as live-preview swatch tiles painted in each palette. Scan-interval as a segmented control. Optional: move primary nav to a left icon rail. | M | later |
| 6 | VS Code parity | vscode | Apply the shared model to both tree views: status `ThemeIcon` coloured by `ThemeColor`, label + dimmed description ("node :3000" + "PID 18244 - next dev"), grouping with System collapsed, kill gated behind `contextValue`. Feed running count to the "PP: N running" item. Keep the tree in the narrow sidebar (no third pane). | M | later |
| 7 | Web portal verify | web | Confirm the portal inherits grouping, status dots, unified list, and drawer once the renderer updates. Verify per-theme status CSS vars and collapse/pin/filter state read correctly over the loopback agent. | S | later |

## What this plan does NOT cover

- A framework migration (staying vanilla HTML/CSS/JS by constraint).
- The three-pane master-detail shell (Direction 1) or status-dashboard (Direction 3) - parked unless Wave 1 reveals the dense list is not enough.
- New backend port-scanning logic - the data shape is sufficient.
- Tray/menu-bar mode - noted as a future option, out of scope here.

## Verification per phase

- Phase 0: unit tests for `classify()` and `statusOf()` against fixture ports (svchost, node:3000, postgres:5432, conflict case).
- Phases 1-5: load the Electron app, scan real ports, confirm grouping/status/drawer render correctly across at least 3 themes (TokyoNight, Brutalist Light, Nord). Screenshot before/after.
- Phase 6: load the extension in an Extension Development Host, confirm tree status + kill-gating.
- Phase 7: open the web portal from VS Code, confirm visual parity with desktop.
