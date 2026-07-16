# Windows Quota Capsule Design

Date: 2026-07-16  
Status: Approved for planning  
Reference: [Bono12138/codex-quota-capsule](https://github.com/Bono12138/codex-quota-capsule) (macOS)

## Goal

Build an independent Windows desktop app that answers the same question as the Mac Quota Capsule:

> At the current weekly quota pace, can I keep working until the next reset?

This repository is a Windows-first project. It reuses the upstream product semantics and transplants the provider-neutral core logic; it is not a macOS fork and does not aim to land Windows support back upstream in the first milestone.

## Product Decisions

| Decision | Choice |
| --- | --- |
| Form factor | Floating desktop capsule + system tray |
| Scope | Usable MVP first; defer charts, 24h budget detail, reset credits, full i18n |
| Shell | Tauri 2 (Rust + WebView) |
| Repo strategy | Independent Windows repository |
| Provider | Codex-first, read-only local rate-limit source |
| Privacy | Local-only by default; never touch Codex login state |

## Architecture

```text
apps/windows/          Tauri 2 app (Rust shell + WebView UI)
packages/core/         Provider-neutral quota model, six states, runway judgment
packages/source-codex/ Read-only Codex probe producing a unified snapshot
```

### Responsibilities

| Layer | Owns | Does not own |
| --- | --- | --- |
| Tauri Rust shell | Floating window, tray, single-instance, refresh scheduling, process lifecycle | Prediction math |
| WebView UI | Collapsed/expanded capsule, status copy, progress, refresh affordance | Codex credentials |
| `source-codex` | Discover/invoke local Codex CLI or app-server; read `rateLimits` | Logout, reinstall, auth mutation |
| `core` | Turn a snapshot into six states + runway judgment | UI framework details |

### Local storage

Path: `%AppData%\Quota Capsule Beta\`

Persist:

- Last successful quota snapshot
- Last successful refresh timestamp
- Capsule window position

Do not persist:

- Auth tokens, cookies, API keys
- Prompt / session / code content
- Private project paths beyond what is strictly required for app config

## Data Flow

```text
Timer (60s) / Tray Refresh / App launch
        ↓
source-codex: read-only Codex rateLimits
        ↓
Success → core computes DisplayModel
       → write last-success snapshot
       → push to UI + tray tooltip
Failure → keep last-success snapshot
       → mark stale or Data unavailable
       → show safe diagnostic reason
```

### MVP inputs from Codex

- Weekly window used percentage (or equivalent usable fields)
- Weekly window reset / remaining time
- Any additional rate-limit fields needed to compute runway when available

If required fields are missing, the app enters Data unavailable rather than guessing.

### MVP outputs to UI

- One of six states
- Weekly used percentage
- Reset countdown
- One plain-language runway judgment
- Freshness: just updated / N minutes ago / unavailable

### Deferred (post-MVP)

- Trend chart, forecast band, sustainable line
- Next-24-hour budget breakdown
- Reset-credit lifecycle UI
- Remote analytics
- Full multilingual UI surface
- Launch at login
- Other agent provider adapters

## Six States

Aligned with Mac product semantics:

1. **Early estimate** — first valid weekly reading; judgment is provisional
2. **On track** — current pace can likely last until weekly reset
3. **Running fast** — may still last, but pace is already high
4. **May run out** — even with restraint, current pace may not last
5. **Exhausted** — weekly quota is gone; wait for reset
6. **Data unavailable** — live read failed or data is too stale for pace judgment

## Windows UI

### Floating capsule

- Borderless, always-on-top, draggable window
- Position persisted in AppData
- Collapsed: status color + short label + used% + reset countdown
- Expanded: plain-language judgment + last update time + Refresh
- Click toggles collapsed/expanded in MVP

### System tray

- Icon/status aligned with capsule state
- Tooltip: state + used% + reset countdown
- Right-click: Show/Hide capsule, Refresh now, Quit
- Left-click: show and focus capsule

### Visual direction

- Dense, glanceable gauge — not a dashboard
- Match Mac information hierarchy where practical
- MVP may ship one clear theme; system light/dark follow-up is allowed later

## Error Handling

| Condition | Behavior |
| --- | --- |
| `codex` not found | Data unavailable; tell user to install/configure PATH |
| Not logged in / cannot read rateLimits | Data unavailable; user must log in via Codex themselves |
| Timeout / parse failure | Keep last success as stale; repeated failure may become fully unavailable |
| Missing fields | Compute only what is safe; otherwise unavailable |
| Second process start | Single-instance: activate existing app |

Diagnostic codes stored/logged must be safe, for example: `cli_missing`, `auth_required`, `timeout`, `parse_error`, `stale`.

Safety rules:

- Never run `codex logout`
- Never reinstall or replace Codex binaries
- Never print or upload tokens, cookies, prompts, or session text

## Testing Strategy

- Unit tests in `packages/core` for state transitions and runway judgment using fixtures
- Source probe tests with recorded fixtures where possible; live Codex probe only in local manual checks
- Smoke checklist on Windows after `tauri build`

## Acceptance Criteria (MVP Done)

1. Core unit tests pass for six states and key boundary fixtures
2. Windows `tauri build` produces a runnable artifact
3. With local Codex logged in: 60s auto-refresh and tray manual refresh update the capsule
4. When Codex is unavailable: show unavailable/stale clearly; no crash; no login-state mutation
5. Tray can show/hide capsule and quit
6. Logs and persisted files contain no tokens, cookies, or prompts

## Non-Goals for MVP

- Trend charts and 24h budget detail
- Reset-credit panel
- Full i18n parity with Mac
- Signed/store-grade installer polish beyond a basic Tauri bundle
- Chrome extension
- Non-Codex adapters

## Open Follow-ups After MVP

- System theme follow
- Launch at login
- Richer history and pace evidence parity with Mac
- Optional portable vs installer packaging preference from users
- Contribution path back to upstream if both sides want it later
