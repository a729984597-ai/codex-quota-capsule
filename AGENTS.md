# Repository Guidance

Windows Quota Capsule — Codex-first local weekly runway gauge.

## Safety
- Never log or commit tokens, cookies, API keys, or Codex auth state.
- Never run `codex logout` or replace Codex binaries.
- Quota probing is read-only.

## Layout
- `packages/core` — provider-neutral MVP prediction + view model
- `packages/source-codex` — Codex app-server reader
- `apps/windows` — Tauri 2 shell + WebView UI
