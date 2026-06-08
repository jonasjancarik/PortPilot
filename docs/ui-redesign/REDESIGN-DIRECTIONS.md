# PortPilot Redesign Brief: Killing the Flat Wall

The user's complaint is "very flat." This brief turns that into a concrete plan. The spine of the redesign is one move: separate the user's real dev servers from OS/system port noise. Every direction here attacks flatness with grouping, status, hierarchy, and progressive disclosure.

The research signal is unusually strong. All 13 researchers scored their tool at maximum applicability. They independently converged on the same fixes. That convergence is the most important finding in this document.

---

## 1. Diagnosis: where PortPilot is flat

- **Signal drowned in noise.** Active Ports renders all ~33 ports in one uniform two-column card grid. OS ports (:135 svchost, :139 System, :445 System PID 4) get the same visual weight as the user's :3000 / :3001 node servers. No grouping, no sort, no classification. The 2-3 ports that matter are buried among ~30 the user must never touch. This is the headline failure.
- **No status model at all.** A port is either in the grid or not. There is no running / stopped / starting / conflict / error vocabulary, no color, no glyph. Every card looks equally alive, so the eye cannot find the one server that matters or the one port in conflict.
- **Apps split from their live ports.** MY APPS and ACTIVE PORTS are two disconnected tabs. "Is my registered app running, and on which port" forces a mental join across two views. Intent and runtime reality never share a row.
- **Cards are overloaded yet truncated.** Each card crams :PORT, PROCESS, PID, a truncated COMMAND, a copy icon, and a red kill X. Nothing reads as primary, and the one field you open a card to read (the full command) is the one that is cut off. There is no detail surface, so verbose data has nowhere to go but onto every card.
- **66 always-on buttons.** Copy + kill on all ~33 cards is roughly 66 permanent controls competing with the data. Worse, an identical red kill X sits on OS ports (:445 System PID 4) that should never be killed. A footgun with no friction.
- **Top-tabs waste vertical space and will not scale.** The gold-underline tab strip eats a horizontal band and tops out near 5 tabs. No room for Logs, Groups, or future destinations.
- **Flat settings stack.** SETTINGS is a vertical run of full-width bordered boxes with no sub-nav. The 6 themes are 6 identical text buttons that do not preview themselves.
- **Card grid defeats comparison.** Because PORT/PROCESS/PID/COMMAND sit in different positions within each card, you cannot scan a single column. You must re-read all 33 boxes to answer "which is node."
- **Flatness is replicated across three surfaces.** Desktop, VS Code, and web share one JSON config but no status model. Whatever status/grouping concept is built must live in the shared model, or the redesign just moves the flatness between surfaces.

---

## 2. Cross-tool patterns (the strong signals)

These recurred across many researchers. The more tools, the stronger the signal.

| Pattern | Seen in | Why it matters for PortPilot |
|---|---|---|
| **Collapsible grouped rows with counted headers (signal/noise split)** | Docker Desktop, OrbStack, Herd, VS Code, Mullvad, Activity Monitor/Task Manager, Git GUIs, TablePlus, k9s/Linear | The most-named fix and the direct cure. Classify into Dev / Other / System, collapse System by default. The real servers sit alone at the top; ~28 OS ports fold to one line. |
| **Leading colored status dot in a fixed gutter** | Docker, OrbStack, Tailscale, DBngin, Vercel/Railway/Render, GitHub Actions, VS Code, process monitors, Git GUIs, TablePlus | PortPilot has zero status today. Green=running / grey=stopped / amber=conflict / red=error, paired with a word and a shape. Cheapest high-impact win. Survives all 6 themes via a CSS variable. |
| **Master-detail (list + inspector)** | Docker, OrbStack, Raycast, Tailscale, Activity Monitor, Git GUIs, TablePlus/Postman, 1Password, Vercel/Render | Fixes the overloaded-yet-truncated card. The full command gets real width in a drawer; rows shrink; copy/kill move off every card. |
| **Left-rail nav instead of top-tabs** | Docker, OrbStack, Herd/DBngin, Raycast, Vercel/Railway/Render, Git GUIs, process monitors, settings UIs | Kills the vertical-space waste and the 5-tab ceiling. Mirrors the VS Code activity bar the user already knows. |
| **Reconcile registered apps with live ports in one row** | OrbStack, Docker, DBngin, Render/Railway, Git GUIs, Activity Monitor, VS Code Ports | Ends the My Apps vs Active Ports split. "Is my app running and where" becomes one glance. |
| **Hover-reveal actions, Start XOR Stop, gate kill on system ports** | Docker, OrbStack, VS Code (contextValue), DBngin, Vercel/Render, Raycast, TablePlus | Removes ~66 always-on buttons and the kill-a-Windows-process footgun. |
| **Search + filter chips over a structured list, remembered default** | Raycast, Docker, process monitors, Tailscale/Mullvad, Postman/Linear, Git GUIs, VS Code Settings | Upgrades the lone filter box into one-tap lenses (Mine / Dev / System / Conflicts) + sort, persisted so the user lands on signal every launch. |
| **Settings as sub-nav + detail pane, theme as live-preview swatches, typed controls** | Raycast, VS Code, macOS System Settings, 1Password, Herd, Arc, Linear/Postman | Fixes the flat settings stack. Each theme tile painted in its own palette; scan-interval as a segmented control. |

---

## 3. Three directions

These are the user's options. They are genuinely different architectures.

### Direction A - Three-Pane Master-Detail Shell (effort: L)

A persistent three-column desktop: left nav rail, grouped collapsible list, right inspector. The Git-GUI / OrbStack / TablePlus shell. Three altitudes always on screen.

```
+------------------------------------------------------------------------------+
| [rocket] PORTPILOT          [search ports/apps...]      [Scan]  [Add App]     |
+------+----------------------------------------+------------------------------+
| []   |  v MY DEV SERVERS (2)        [stop all] |  :3000  node                 |
|PORTS<|    * :3000  node      next dev    [..]  |  ----------------------------|
|      |    * :3001  node      vite        [..]  |  status   * running  up 2h   |
| []   |  v OTHER USER PORTS (3)                 |  pid      18244              |
|APPS  |    o :5432  postgres              [..]  |  command  next dev           |
|      |    o :6379  redis                 [..]  |    C:/Scratch/bloodclarity   |
| []   |  > SYSTEM & OS PORTS (28)               |  cwd      C:/Scratch/blood.. |
|KNOW  |                                        |                              |
|      |                                        |  [ Open :3000 ]  [ Stop ]    |
| []   |                                        |  [ Copy cmd ]    [ Kill ]    |
|SETT  |                                        |                              |
+------+----------------------------------------+------------------------------+
|  3 dev running  -  1 conflict  -  33 ports total                             |
+------------------------------------------------------------------------------+
```

**Pros:** most hierarchy of the three; permanent home for command/PID/cwd/uptime; left rail scales past 5 destinations and matches the VS Code mental model; selecting a row never navigates away; Settings reuses the same shell.
**Cons:** cramped in a small window and the narrow VS Code sidebar; most build effort on a vanilla renderer (split panes, splitters, selection state); inspector spends width even for glance-and-kill users; risk of importing pro-tool heaviness.
**Best if:** PortPilot is a daily-driver power tool and you want the deepest, most durable hierarchy that scales to 100 ports and future features.

### Direction B - Grouped Collapsible Dense List (effort: M) - RECOMMENDED

One main view. The card grid becomes a single dense table grouped into collapsible counted sections, System collapsed by default. Every row leads with a status dot. Clicking a row slides a dismissible drawer in from the right. Lightest route that still attacks flatness head-on.

```
+------------------------------------------------------------------------------+
| [rocket] PORTPILOT   ACTIVE PORTS | MY APPS | KNOWLEDGE | SETTINGS  [Scan][+] |
+------------------------------------------------------------------------------+
| [search...]  [ Mine ] [ Dev ] [ System ] [ Conflicts ]      sort: Port v      |
+------------------------------------------------------------------------------+
|  v  MY DEV SERVERS (2)                                          [ stop all ]  |
|     * :3000   node      next dev          PID 18244         [open] [stop] [..]|
|     * :3001   node      vite              PID 9921          [open] [stop] [..]|
|  v  OTHER USER PORTS (3)                                                       |
|     o :5432   postgres                    PID 7710          [open] [..]       |
|     o :6379   redis                       PID 8120          [open] [..]       |
|     ! :8080   node  (conflict: also wanted by python)       PID 4412  [..]    |
|  >  SYSTEM & OS PORTS (28)                                                     |
+------------------------------------------------------------------------------+
|  3 dev running  -  1 conflict  -  33 ports total                             |
+------------------------------------------------------------------------------+
   (clicking a row slides a detail drawer over the right third)
```

**Pros:** cheapest path that still fully attacks flatness; grouping + status dot + counts are pure CSS/JS over existing data; collapsing System to one line is most of the perceived win; table triples on-screen density with scannable columns; drawer is optional so glance-and-kill stays one click; lowest risk on the no-framework renderer; ships in increments.
**Cons:** less hierarchy at rest (detail hidden until drawer opens); if nav stays top-tabs the vertical-space/5-tab issues remain (fix separately); a slide-over drawer is less stable than a permanent inspector.
**Best if:** you want maximum flatness reduction for least build risk on a vanilla renderer, shipping the win in increments.

### Direction C - Status Dashboard + Drill-In (effort: M)

Lead with orientation. A pinned summary header sits above a status board. The user's real servers render as a pinned "My Stack" card band; everything else collapses into quiet groups below. Mullvad/Tailscale/PaaS feel. Optimised for "is my stuff up?" rather than dense list management.

```
+------------------------------------------------------------------------------+
| [rocket] PORTPILOT                                       [Scan]   [Add App]  |
+------------------------------------------------------------------------------+
|  THIS MACHINE        3 dev servers up   -   1 conflict   -   28 system ports  |
+------------------------------------------------------------------------------+
|  * MY STACK (pinned)                                                          |
|  +---------------------+  +---------------------+  +----------------------+    |
|  | * bloodclarity      |  | * swanflow          |  | o tinyprint          |    |
|  |   :3000  node up 2h |  |   :3001 node up 40m |  |   stopped            |    |
|  |   [open] [stop] [..]|  |   [open][stop] [..] |  |   [start]            |    |
|  +---------------------+  +---------------------+  +----------------------+    |
+------------------------------------------------------------------------------+
|  > OTHER USER PORTS (3)                                                        |
|  > SYSTEM & OS PORTS (28)                                                      |
+------------------------------------------------------------------------------+
|  ! 1 conflict: :8080 wanted by 2 processes                       [ resolve ]  |
+------------------------------------------------------------------------------+
   (clicking a stack card or group row drills into a full detail view)
```

**Pros:** best "is my stuff up?" glance; strongest spatial signal/noise split (servers lifted out, OS ports sunk); conflicts get a dedicated callout; supports a tray/menu-bar glance mode and feeds the VS Code counter; calm, modern first impression.
**Cons:** the card band reintroduces cards (less dense, poor if many pinned); two visual languages to keep consistent across 6 themes; drill-in is a full-view swap needing a clean back affordance; least suited to dense bulk work; pinning is a manual concept (can default to matched apps).
**Best if:** the primary job is reassurance and orientation, and a tray/glance mode is on the roadmap.

---

## 4. Recommendation

**Ship Direction B (Grouped Collapsible Dense List), built to evolve toward Direction A (Three-Pane Shell).**

The research is overwhelmingly consistent. The single most-named fix across all 13 studies is collapsible grouping with counted headers that separates dev servers from OS noise, paired with a leading status dot. That is the spine, and Direction B delivers it first and cheapest. Grouping + status + counts are pure CSS/JS over existing data. No split-pane plumbing, no framework, which respects the vanilla-HTML/CSS/JS constraint.

Direction A produces more hierarchy but is L-effort and risky on a no-framework renderer. Direction C optimises glance over management and reintroduces cards. The pragmatic path ships B's grouping, status model, and unified apps+ports list as P0, adds the slide-over drawer as P1, and adds the left rail and settings sub-nav as P1/P2. The drawer and rail are the same primitives the three-pane shell needs, so this is the shell built incrementally, lowest-risk-first, not a dead end.

The status model and classification must live in the shared JSON config and a single `statusOf(item)` / `classify(item)` function so all three surfaces read one source of truth.

### Per-surface changes

**All surfaces (do this first):**
- Define `classify(port)` returning Dev / Other / System. Dev = matches a registered app or a known dev runtime (node/vite/next/python) in 3000-9000. System = svchost/System/PID 4/well-known OS ports (135/139/445). Other = the rest.
- Define `statusOf(item)` returning `{state, color, glyph, label}` for the 5-state model: running = solid green disc, stopped = hollow grey ring, starting = amber pulse, conflict = amber triangle, error = red circle-x.
- Persist group-collapse state, pins, and last-used filter/sort in the shared JSON config.

**Desktop:**
- Replace the card grid with a single dense sortable table grouped into MY DEV SERVERS (expanded) / OTHER USER PORTS / SYSTEM & OS PORTS (collapsed). Each header: disclosure chevron + count badge + roll-up status dot. **(P0 win.)**
- Lead every row with a fixed-gutter status dot that differs by shape (filled disc vs hollow ring), not hue alone, so it survives greyscale and all 6 themes. Pair with a state word. Color from a per-theme CSS variable. Make :PORT a clickable localhost link.
- Merge MY APPS in: a registered app shows its live resolved port + uptime when running, or a Start affordance when stopped. Unmatched ports fall into Other/System with an "Adopt as app" action. The standalone My Apps tab disappears as a primary destination.
- Hover-reveal actions, Start XOR Stop never both, gate kill off System rows (hidden or disabled with a warning + typed confirm). Add a slide-over right drawer on row click with the full untruncated command, PID, cwd, uptime, and copy/kill/open. **(Drawer P1.)**
- Upgrade the filter box + count badge into search + chips (Mine / Dev / System / Conflicts) + sort, persisted. Add a summary line ("3 dev running - 1 conflict - 33 total").
- Rebuild Settings as a category sub-nav (Appearance / Scanning / Data / About) + detail pane. Themes as live-preview swatch tiles painted in their own palettes; scan-interval as a segmented control. **(P1/P2.)** Optionally move primary nav to a left icon rail with the gold accent as a left-edge marker. **(P2.)**

**VS Code:**
- Lead each TreeItem with a `ThemeIcon('circle-filled')` colored by a `ThemeColor` status token. Use label + dimmed description ("node :3000" + "PID 18244 - next dev"). Group via `TreeItemCollapsibleState` with System collapsed. Gate kill behind a `contextValue` so it never appears on system ports. Feed the same running count to the existing "PP: N running" status-bar item. Keep the tree in the narrow sidebar; do not force a third pane.

**Web:**
- The portal renders the same renderer, so it inherits grouping, the status model, the unified list, and the drawer automatically once the desktop renderer is updated. Verify the per-theme status CSS variables and the collapse/pin/filter state read correctly from the shared config over the loopback agent.

---

## 5. Steal table

| Idea | Source tool | Surface | Priority |
|---|---|---|---|
| Collapsible grouped rows, counted headers: Dev / Other / System (System collapsed) | Docker Desktop + Activity Monitor/Task Manager | desktop | P0 |
| Leading status dot, shape-differentiated (disc vs ring), state word, per-theme CSS var | OrbStack + Tailscale + GitHub Actions | all | P0 |
| Table over card grid: ~26-32px aligned rows, click-to-sort headers | Activity Monitor / Task Manager / k9s | desktop | P0 |
| Reconcile registered apps with live ports in one row; "Adopt as app" for unmatched | OrbStack + Docker + VS Code Ports | all | P0 |
| 5-state status model as one shared `statusOf()` read by all surfaces | Cross-tool state study (Vercel/GitHub/Docker) | all | P0 |
| Hover-reveal actions, Start XOR Stop, gate/disable kill on system ports + confirm | Docker Desktop + VS Code contextValue | desktop | P1 |
| Slide-over detail drawer: full command, PID, cwd, uptime, copy/kill/open | OrbStack / Activity Monitor / Raycast | desktop | P1 |
| Search + filter chips (Mine/Dev/System/Conflicts) + sort, remembered default | Postman / Linear + Docker state filter | desktop | P1 |
| Conflict as first-class amber-triangle state with a dedicated callout | VS Code + cross-tool study | all | P1 |
| Settings as sub-nav + detail; theme as live-preview swatch tiles; segmented controls | Raycast / VS Code Settings / Arc | desktop | P1 |
| Left icon+label nav rail replacing top-tabs, gold left-edge marker | Docker / OrbStack / Git GUIs | desktop | P2 |
| Pin/favourite to a sticky top band that survives rescans (defaults to matched apps) | TablePlus + Things/Linear + Insomnia | all | P2 |
| Ration motion: pulse only for starting/stopping, one bar for active scan | Vercel / Railway / GitHub Actions | desktop | P2 |
| Label + dimmed description on one line to halve row height | VS Code Tree View API | vscode | P2 |
| Empty-state with a single link-as-button ([Add App] / [Scan Ports]) | VS Code viewsWelcome | desktop | P2 |

---

## Sequencing summary

1. **P0 (the flatness fix):** shared classify/status model + grouped collapsible table + status dot + unified apps/ports. This alone converts the wall of 33 into ~3 dev rows on top and a collapsed System line. It is most of the perceived win and the lowest build risk.
2. **P1 (depth + safety):** slide-over drawer, hover actions with kill-gating, search/chips/sort, conflict callout, settings sub-nav.
3. **P2 (polish + scale):** left rail, pinning, motion discipline, empty states.

Build P0 once in the shared renderer and the web portal inherits it for free. Mirror the model in the VS Code tree so all three surfaces speak one status language.