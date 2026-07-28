# Static Quota States and Per-Provider Stale Fallback Design

Date: 2026-07-28
Status: Approved for implementation planning

## Goal

Make the current static remaining-quota behavior an explicit product contract,
repair per-provider stale fallback in dual-source mode, and make the release
pipeline reject contract drift.

## Product Decisions

### Static remaining-quota states

The capsule is a remaining-quota gauge, not a pace forecast. Valid live quota
data maps to states as follows:

| Remaining quota | State | Chinese label |
| --- | --- | --- |
| `>= 30%` | `onTrack` | `充足` |
| `>= 10%` and `< 30%` | `runningFast` | `偏低` |
| `> 0.5%` and `< 10%` | `mayRunOut` | `紧张` |
| `<= 0.5%` | `exhausted` | `已用尽` |

`dataUnavailable` remains the error/stale state. `earlyEstimate` is removed
because static remaining-quota classification has no provisional sampling
period and cannot produce that state.

`RunwayForecast` keeps its calculated timing and rate fields for compatibility
and diagnostics, but those fields do not determine the product state.

### Dual-source partial failure

Dual-source mode degrades each provider independently:

- A successful live read uses the live provider slice.
- A failed live read uses a non-expired cached slice for the same provider and
  marks that slice stale.
- A failed live read without a usable same-provider cache remains unavailable.
- Cached Cursor numbers must never appear under Codex, and vice versa.

The aggregate refresh is successful when at least one provider has a successful
live read. A stale slice does not count as a live success.

## Architecture

Keep the existing ownership boundaries and implement cache merging in the Node
bridge:

```text
Codex live snapshot ----\
                         +-- per-provider live/cache selection -- dual ViewModel
Cursor live snapshot ---/
                              ^
                              |
                     last-success ViewModel
```

The Rust host continues to own scheduling, process execution, persistence,
failure counters, and UI publication. The bridge owns provider-specific
selection because it already converts source snapshots into provider slices.

The bridge's cache-selection logic must be extracted into an importable,
side-effect-free unit so tests can exercise it without reading local auth state
or calling provider APIs.

## Refresh Data Flow

1. Rust resolves the existing `last-success.json` path before every refresh.
2. Rust passes that path to the bridge on the initial refresh invocation when
   the file exists. It does not wait for a full refresh failure before making
   cached data available.
3. The bridge reads both providers in parallel in dual mode.
4. For each provider, the bridge selects a live slice, a same-provider stale
   slice, or an unavailable slice.
5. The bridge returns the merged ViewModel and whether at least one live source
   succeeded.
6. When at least one live source succeeded, Rust publishes and persists the
   merged ViewModel. A stale slice retains its original provider timestamp.
7. When no live source succeeded, Rust increments the existing consecutive
   failure counter and publishes cached slices only while they remain usable.
8. After five consecutive full failures, or when no cached slice is within the
   allowed age, Rust publishes the unavailable result without old numbers.

Passing the cache on the first bridge invocation replaces the current redundant
"live invocation, then stale invocation" path.

## Cache Validity

Each cached provider slice is validated independently:

- The provider field must exactly match the requested provider.
- `usedPercent` must be a finite number in the inclusive range `0..100`.
- `fetchedAtIso` must parse as a valid timestamp.
- The timestamp must not be in the future beyond normal clock-rounding
  tolerance.
- The age at refresh time must be at most 30 minutes.

Expiration uses each slice's `fetchedAtIso`, not the modification time of
`last-success.json`. This prevents a healthy provider from keeping another
provider's stale data alive by causing the aggregate file to be rewritten.

When restoring a slice, preserve its quota values, usage breakdown, reset time,
and original fetch time. Replace its state/tone with the stale presentation and
attach the current live-read diagnostic code.

No tokens, cookies, raw provider responses, or error bodies are added to the
cache.

## Error Handling

- A malformed cache file is treated as no cache and never blocks live data.
- A malformed provider slice is ignored independently; another valid slice can
  still be used.
- Partial live success resets the aggregate consecutive-full-failure counter.
- A fully failed refresh increments that counter.
- Cache parsing and fallback do not log provider payloads or auth state.
- Existing `node_missing`, `cli_missing`, `auth_required`, `timeout`,
  `parse_error`, and `stale` diagnostics remain supported.

## Contract Cleanup

- Remove `earlyEstimate` from the TypeScript state union, status/tone maps, dual
  severity ranking, Rust-facing serialized expectations, and tests.
- Update product documentation from pace/runway wording to remaining-quota
  wording where it describes current behavior.
- Keep existing serialized field names in this change to avoid a storage
  migration.
- Do not restructure the three ViewModel definitions in this change; shared
  schema generation remains a later architecture improvement.

## Testing

### Core

Add boundary tests for exactly `30%`, just below `30%`, exactly `10%`, just below
`10%`, exactly `0.5%`, and invalid/expired windows. Update the Chinese label
expectation to `充足`.

### Bridge cache selection

Use recorded ViewModel objects only. Cover:

- live Cursor plus cached Codex;
- cached Cursor plus live Codex;
- same-provider cache enforcement;
- one malformed cached slice;
- per-slice 30-minute expiration;
- both live reads failing with two valid cached slices;
- both live reads failing without usable caches.

No bridge test may access the real Cursor database, Codex CLI, or network.

### Type and host checks

- Add a test TypeScript configuration so test files are type-checked.
- Repair the existing model smoke fixture to satisfy required ViewModel fields.
- Keep `cargo test` in verification even though Rust test coverage remains
  limited in this change.
- Fix the current Clippy redundant-pattern warning, but do not add Clippy as a
  release-blocking job in this scope.

### Release gate

The Windows release workflow runs, in order:

1. `npm test`
2. test-file TypeScript checking
3. `cargo test`
4. `npm run win:build`

A failing state contract or malformed TypeScript test fixture must prevent a
release artifact from being published.

## Non-Goals

- Reintroducing pace-based forecasting.
- Redesigning the capsule UI.
- Modifying the current uncommitted window sizing and progress-bar work.
- Generating a shared Rust/TypeScript schema.
- Changing provider authentication or probing behavior.
- Adding Clippy as a release blocker.

## Acceptance Criteria

1. Static remaining-quota boundaries are explicit and fully tested.
2. `earlyEstimate` is absent from the runtime contract.
3. In dual mode, one failed provider can display only its own fresh-enough
   cached slice while the other provider remains live.
4. A provider cache expires based on its own fetch timestamp after 30 minutes.
5. Full dual failure uses valid per-provider caches temporarily and then
   escalates to unavailable.
6. `npm test`, test type checking, frontend build, and `cargo test` pass.
7. The release workflow executes those checks before packaging.
8. No auth material or raw provider response is persisted or logged.
