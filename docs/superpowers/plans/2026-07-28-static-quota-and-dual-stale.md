# Static Quota and Dual Stale Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make static remaining-quota states the tested contract, restore stale data per provider in dual mode, and block releases when those contracts fail.

**Architecture:** Add a provider-neutral cached-slice restoration helper to `packages/core`, then let `scripts/refresh-once.mjs` select live, same-provider stale, or unavailable slices before building the aggregate ViewModel. Rust passes cache state into the first bridge call, owns full-failure escalation, and persists mixed live/stale dual snapshots without refreshing the stale provider timestamp.

**Tech Stack:** TypeScript 5, Vitest 3, Node.js 22, Rust 2021, Tauri 2, GitHub Actions

---

## File Map

- Modify `packages/core/src/model.ts`: remove the unreachable `earlyEstimate` state.
- Modify `packages/core/src/display.ts`: remove dead mappings and ranking entries.
- Create `packages/core/src/stale.ts`: validate cached slices and select live/stale provider data.
- Modify `packages/core/src/index.ts`: export the stale helper.
- Modify `packages/core/test/predict.test.ts`: encode static quota boundaries.
- Modify `packages/core/test/display.test.ts`: align the approved Chinese label.
- Modify `packages/core/test/model-smoke.test.ts`: make the typed fixture valid.
- Create `packages/core/test/stale.test.ts`: cover provider isolation, cache expiry, and dual selection.
- Modify `scripts/refresh-once.mjs`: perform per-provider live/cache selection.
- Modify `apps/windows/src-tauri/src/model.rs`: identify nested stale data and test it.
- Modify `apps/windows/src-tauri/src/refresh.rs`: pass cache on the first bridge call and simplify failure handling.
- Create `tsconfig.tests.json`: type-check TypeScript test files.
- Modify `package.json`: add the test type-check command and static-gauge description.
- Modify `.github/workflows/release-windows.yml`: run tests before packaging.
- Modify `apps/windows/src-tauri/src/layering.rs`: remove the current Clippy warning.
- Modify `README.md`: document five reachable states and static remaining-quota semantics.

### Task 1: Lock the Static State Contract

**Files:**
- Modify: `packages/core/test/predict.test.ts`
- Modify: `packages/core/test/display.test.ts`
- Modify: `packages/core/test/model-smoke.test.ts`
- Create: `tsconfig.tests.json`
- Modify: `package.json`
- Modify: `packages/core/src/model.ts`
- Modify: `packages/core/src/display.ts`

- [ ] **Step 1: Record the current red baseline**

Run:

```powershell
npm test
```

Expected: FAIL with the existing `earlyEstimate`, pace-based state, and `够用`
assertions.

- [ ] **Step 2: Add test-file type checking**

Create `tsconfig.tests.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["node"]
  },
  "include": ["packages/*/test/**/*.test.ts"]
}
```

Add to the root `package.json` scripts:

```json
"test:types": "tsc -p tsconfig.tests.json"
```

- [ ] **Step 3: Add a type-level test that rejects `earlyEstimate`**

Change the existing type import in `packages/core/test/model-smoke.test.ts` to:

```ts
import type { CapsuleState, CapsuleViewModel } from "../src/index.ts";
```

Then add:

```ts
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Assert<T extends true> = T;

type ExpectedCapsuleState =
  | "onTrack"
  | "runningFast"
  | "mayRunOut"
  | "exhausted"
  | "dataUnavailable";

type _CapsuleStateContract = Assert<
  Equal<CapsuleState, ExpectedCapsuleState>
>;
```

Also make the existing `CapsuleViewModel` fixture structurally valid:

```ts
const model: CapsuleViewModel = {
  provider: "codex",
  displayMode: "single",
  state: "onTrack",
  tone: "safe",
  statusLabel: "充足",
  judgmentText: "剩余额度充足",
  usedPercent: 42,
  resetCountdownText: "还剩 3 天",
  freshnessText: "刚刚更新",
  isStale: false,
  diagnosticCode: null,
  fetchedAtIso: "2026-07-16T01:00:00.000Z",
  resetsAtIso: "2026-07-19T01:00:00.000Z",
};
```

- [ ] **Step 4: Verify the type-level test is red**

Run:

```powershell
npm run test:types
```

Expected: FAIL because `CapsuleState` still includes `earlyEstimate`.

- [ ] **Step 5: Replace pace assertions with exact static boundaries**

Refactor `packages/core/test/predict.test.ts` to use a compact helper and add:

```ts
it.each([
  [30, "onTrack"],
  [29.99, "runningFast"],
  [10, "runningFast"],
  [9.99, "mayRunOut"],
  [0.51, "mayRunOut"],
  [0.5, "exhausted"],
] as const)("maps %s%% remaining to %s", (remaining, expected) => {
  const used = 100 - remaining;
  const forecast = predictRunway(
    snap({ used, remaining, hoursLeft: 48, fetchedAt: t0 }),
    t0,
  );
  expect(forecast.state).toBe(expected);
});
```

Keep the source-error test. Delete the three pace-based assertions and the
`earlyEstimate` assertion.

Add the expired-reset case explicitly:

```ts
it("returns dataUnavailable when the reset is not in the future", () => {
  const forecast = predictRunway(
    snap({ used: 40, remaining: 60, hoursLeft: 0, fetchedAt: t0 }),
    t0,
  );
  expect(forecast.state).toBe("dataUnavailable");
});
```

Change the display label assertion in
`packages/core/test/display.test.ts` to:

```ts
expect(vm.statusLabel).toBe("充足");
```

- [ ] **Step 6: Remove the unreachable production state**

In `packages/core/src/model.ts`, change the state union to:

```ts
/** Product-facing static quota states. */
export type CapsuleState =
  | "onTrack"
  | "runningFast"
  | "mayRunOut"
  | "exhausted"
  | "dataUnavailable";
```

Remove `earlyEstimate` from `STATUS`, `TONE`, `pickWorse`, and `judgmentFor` in
`packages/core/src/display.ts`.

- [ ] **Step 7: Verify the core contract is green**

Run:

```powershell
npm run test:types
npx vitest run packages/core/test
```

Expected: both commands PASS.

- [ ] **Step 8: Commit the state contract**

```powershell
git add package.json tsconfig.tests.json packages/core/src/model.ts packages/core/src/display.ts packages/core/test
git commit -m "fix(core): align static quota state contract"
```

### Task 2: Add a Pure Same-Provider Cache Restorer

**Files:**
- Create: `packages/core/src/stale.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/stale.test.ts`

- [ ] **Step 1: Write failing provider-isolation and expiry tests**

Create `packages/core/test/stale.test.ts` with fixed times:

```ts
import { describe, expect, it } from "vitest";
import { restoreCachedProviderSlice } from "../src/stale.ts";

const NOW = new Date("2026-07-28T06:00:00.000Z");

function cachedSlice(provider: "cursor" | "codex", fetchedAtIso: string) {
  return {
    provider,
    state: "onTrack",
    tone: "safe",
    statusLabel: "充足",
    judgmentText: "剩余额度充足",
    usedPercent: provider === "cursor" ? 40 : 25,
    usageBreakdown:
      provider === "cursor"
        ? { autoPercent: 40, apiPercent: 35, totalPercent: 30 }
        : null,
    resetCountdownText: "2d",
    freshnessText: "刚刚更新",
    isStale: false,
    diagnosticCode: null,
    fetchedAtIso,
    resetsAtIso: "2026-07-30T06:00:00.000Z",
  };
}

describe("restoreCachedProviderSlice", () => {
  it("restores only the requested provider and preserves its quota fields", () => {
    const cached = {
      viewModel: {
        provider: "both",
        providers: [
          cachedSlice("cursor", "2026-07-28T05:40:00.000Z"),
          cachedSlice("codex", "2026-07-28T05:45:00.000Z"),
        ],
      },
    };

    const result = restoreCachedProviderSlice({
      cached,
      provider: "codex",
      now: NOW,
      diagnosticCode: "timeout",
    });

    expect(result).toMatchObject({
      provider: "codex",
      usedPercent: 25,
      state: "dataUnavailable",
      tone: "unknown",
      isStale: true,
      diagnosticCode: "timeout",
      fetchedAtIso: "2026-07-28T05:45:00.000Z",
    });
  });

  it("rejects another provider's single-source cache", () => {
    const result = restoreCachedProviderSlice({
      cached: { viewModel: cachedSlice("cursor", "2026-07-28T05:45:00.000Z") },
      provider: "codex",
      now: NOW,
    });
    expect(result).toBeNull();
  });

  it("rejects a slice older than 30 minutes", () => {
    const result = restoreCachedProviderSlice({
      cached: {
        viewModel: cachedSlice("codex", "2026-07-28T05:29:59.000Z"),
      },
      provider: "codex",
      now: NOW,
    });
    expect(result).toBeNull();
  });
});
```

Add separate cases for malformed `usedPercent`, an invalid timestamp, a
timestamp over 60 seconds in the future, and exactly 30 minutes old.

- [ ] **Step 2: Verify the tests are red**

Run:

```powershell
npx vitest run packages/core/test/stale.test.ts
```

Expected: FAIL because `stale.ts` does not exist.

- [ ] **Step 3: Implement the minimal cache restorer**

Create `packages/core/src/stale.ts` exporting:

```ts
import type {
  DiagnosticCode,
  ProviderId,
  ProviderSlice,
  UsageBreakdown,
} from "./model.js";

export const STALE_MAX_AGE_MS = 30 * 60_000;
const FUTURE_TOLERANCE_MS = 60_000;

export function restoreCachedProviderSlice(input: {
  cached: unknown;
  provider: ProviderId;
  now: Date;
  diagnosticCode?: DiagnosticCode | null;
}): ProviderSlice | null {
  const root = readObject(input.cached);
  const vm = readObject(root.viewModel ?? input.cached);
  const candidates = Array.isArray(vm.providers)
    ? vm.providers
    : [vm];
  const raw = candidates
    .map(readObject)
    .find((candidate) => candidate.provider === input.provider);
  if (!raw) return null;

  const usedPercent = readPercent(raw.usedPercent);
  const fetchedAtIso =
    typeof raw.fetchedAtIso === "string" ? raw.fetchedAtIso : null;
  const fetchedAtMs = fetchedAtIso ? Date.parse(fetchedAtIso) : Number.NaN;
  const ageMs = input.now.getTime() - fetchedAtMs;
  if (
    usedPercent === null ||
    !Number.isFinite(fetchedAtMs) ||
    ageMs < -FUTURE_TOLERANCE_MS ||
    ageMs > STALE_MAX_AGE_MS
  ) {
    return null;
  }

  return {
    provider: input.provider,
    state: "dataUnavailable",
    tone: "unknown",
    statusLabel: "数据暂不可用",
    judgmentText:
      "正在显示上次成功的额度数据，恢复实时读取前暂不判断消耗速度。",
    usedPercent,
    usageBreakdown: readBreakdown(raw.usageBreakdown),
    resetCountdownText: readText(raw.resetCountdownText, "重置未知"),
    freshnessText: formatStaleFreshness(ageMs),
    isStale: true,
    diagnosticCode: input.diagnosticCode ?? "stale",
    fetchedAtIso,
    resetsAtIso:
      typeof raw.resetsAtIso === "string" ? raw.resetsAtIso : null,
  };
}
```

Add these private helpers:

```ts
function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readPercent(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}

function readBreakdown(value: unknown): UsageBreakdown | null {
  const raw = readObject(value);
  const keys = ["autoPercent", "apiPercent", "totalPercent"] as const;
  if (!keys.some((key) => Object.hasOwn(raw, key))) return null;
  const values = keys.map((key) =>
    raw[key] === null ? null : readPercent(raw[key]),
  );
  const invalid = keys.some(
    (key, index) => raw[key] !== null && values[index] === null,
  );
  if (invalid) return null;
  return {
    autoPercent: values[0],
    apiPercent: values[1],
    totalPercent: values[2],
  };
}

function readText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function formatStaleFreshness(ageMs: number): string {
  const mins = Math.max(0, Math.round(ageMs / 60_000));
  return mins <= 1 ? "上次成功：刚刚" : `上次成功：${mins} 分钟前`;
}
```

Export the helper from `packages/core/src/index.ts`:

```ts
export * from "./stale.js";
```

- [ ] **Step 4: Verify cache tests and types are green**

Run:

```powershell
npx vitest run packages/core/test/stale.test.ts
npm run test:types
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the cache helper**

```powershell
git add packages/core/src/stale.ts packages/core/src/index.ts packages/core/test/stale.test.ts
git commit -m "feat(core): restore cached provider slices safely"
```

### Task 3: Apply Per-Provider Fallback in the Bridge

**Files:**
- Modify: `packages/core/src/stale.ts`
- Modify: `packages/core/test/stale.test.ts`
- Modify: `scripts/refresh-once.mjs`

- [ ] **Step 1: Add a failing dual-selection test**

Add tests for a pure `selectProviderSlice` function to
`packages/core/test/stale.test.ts`. The first test must prove this behavior:

```ts
it("keeps Cursor live while restoring cached Codex", () => {
  const cursor = selectProviderSlice({
    current: cursorLive,
    live: true,
    cached: dualCache,
    now: NOW,
  });
  const codex = selectProviderSlice({
    current: codexUnavailable,
    live: false,
    cached: dualCache,
    now: NOW,
    diagnosticCode: "timeout",
  });

  expect(cursor.live).toBe(true);
  expect(cursor.slice.isStale).toBe(false);
  expect(codex.live).toBe(false);
  expect(codex.slice).toMatchObject({
    provider: "codex",
    isStale: true,
    diagnosticCode: "timeout",
  });

  const merged = mergeDualViewModel(cursor.slice, codex.slice);
  expect(merged.providers).toEqual([cursor.slice, codex.slice]);
  expect(merged.isStale).toBe(false);
});
```

Add the mirror case, both cached, and no usable caches.

- [ ] **Step 2: Verify the new dual tests are red for the missing composition**

Run:

```powershell
npx vitest run packages/core/test/stale.test.ts
```

Expected: FAIL because `selectProviderSlice` is not exported.

- [ ] **Step 3: Implement the tested selection helper**

Add to `packages/core/src/stale.ts`:

```ts
export function selectProviderSlice(input: {
  current: ProviderSlice;
  live: boolean;
  cached: unknown;
  now: Date;
  diagnosticCode?: DiagnosticCode | null;
}): { live: boolean; slice: ProviderSlice } {
  if (input.live) {
    return { live: true, slice: input.current };
  }
  const stale = restoreCachedProviderSlice({
    cached: input.cached,
    provider: input.current.provider,
    now: input.now,
    diagnosticCode: input.diagnosticCode,
  });
  return { live: false, slice: stale ?? input.current };
}
```

- [ ] **Step 4: Refactor the bridge to load cache once**

In `scripts/refresh-once.mjs`:

- import `selectProviderSlice`;
- parse `staleFromPath` once into `cachedPayload`;
- replace `tryStale` with a `snapshotToSelectedSlice` helper returning
  `{ live: boolean, slice }`;
- use the cached slice only when the live snapshot failed;
- convert a selected single slice to a top-level single ViewModel;
- preserve `ok = cursor.live || codex.live` in dual mode;
- remove the no-op `process.exit(ok ? 0 : 0)` expression in favor of
  `process.exit(0)`.

Load the cache once with:

```js
function readCachedPayload(path) {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const cachedPayload = readCachedPayload(staleFromPath);
```

The selection helper should have this shape:

```js
function snapshotToSelectedSlice(snapshot, fetchedAt, provider, cached) {
  const current = snapshotToSlice(snapshot, fetchedAt, provider);
  return selectProviderSlice({
    current,
    live: snapshot.sourceStatus === "ok" && Boolean(snapshot.weeklyWindow),
    cached,
    now: fetchedAt,
    diagnosticCode: snapshot.diagnosticCode ?? null,
  });
}
```

Convert a selected slice back to the single-provider top-level contract with:

```js
function sliceToViewModel(slice) {
  return {
    provider: slice.provider,
    displayMode: "single",
    state: slice.state,
    tone: slice.tone,
    statusLabel: slice.statusLabel,
    judgmentText: slice.judgmentText,
    usedPercent: slice.usedPercent,
    usageBreakdown: slice.usageBreakdown ?? null,
    resetCountdownText: slice.resetCountdownText,
    freshnessText: slice.freshnessText,
    isStale: slice.isStale,
    diagnosticCode: slice.diagnosticCode,
    fetchedAtIso: slice.fetchedAtIso,
    resetsAtIso: slice.resetsAtIso,
  };
}
```

- [ ] **Step 5: Verify bridge behavior without live provider access**

Run:

```powershell
npm run build
npx vitest run packages/core/test/stale.test.ts
npm test
```

Expected: all commands PASS. Tests must use fixtures only and must not read
Cursor state or launch Codex.

- [ ] **Step 6: Commit bridge fallback**

```powershell
git add packages/core/src/stale.ts packages/core/test/stale.test.ts scripts/refresh-once.mjs
git commit -m "fix(bridge): degrade dual sources independently"
```

### Task 4: Pass Cache State Through Rust Once

**Files:**
- Modify: `apps/windows/src-tauri/src/model.rs`
- Modify: `apps/windows/src-tauri/src/refresh.rs`

- [ ] **Step 1: Add failing Rust tests for nested stale detection**

Add under `#[cfg(test)]` in `model.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::CapsuleViewModel;

    fn from_json(value: serde_json::Value) -> CapsuleViewModel {
        serde_json::from_value(value).expect("valid view model")
    }

    #[test]
    fn detects_stale_data_in_one_provider_slice() {
        let vm = from_json(serde_json::json!({
            "provider": "both",
            "displayMode": "both",
            "state": "onTrack",
            "tone": "safe",
            "statusLabel": "双源监控",
            "judgmentText": "",
            "usedPercent": 40.0,
            "resetCountdownText": "2d",
            "freshnessText": "刚刚更新",
            "isStale": false,
            "diagnosticCode": null,
            "fetchedAtIso": null,
            "resetsAtIso": null,
            "providers": [{
                "provider": "codex",
                "state": "dataUnavailable",
                "tone": "unknown",
                "statusLabel": "数据暂不可用",
                "judgmentText": "",
                "usedPercent": 25.0,
                "resetCountdownText": "2d",
                "freshnessText": "上次成功：10 分钟前",
                "isStale": true,
                "diagnosticCode": "timeout",
                "fetchedAtIso": "2026-07-28T05:50:00.000Z",
                "resetsAtIso": null
            }]
        }));
        assert!(vm.has_stale_data());
    }
}
```

Add cases for a single stale ViewModel and an unavailable ViewModel with no
cached number.

- [ ] **Step 2: Verify the Rust tests are red**

Run:

```powershell
cargo test --manifest-path apps/windows/src-tauri/Cargo.toml model::tests
```

Expected: FAIL because `has_stale_data` is missing.

- [ ] **Step 3: Implement stale-data detection**

Add to `impl CapsuleViewModel`:

```rust
pub fn has_stale_data(&self) -> bool {
    (self.is_stale && self.used_percent.is_some())
        || self.providers.as_ref().is_some_and(|providers| {
            providers
                .iter()
                .any(|provider| provider.is_stale && provider.used_percent.is_some())
        })
}
```

- [ ] **Step 4: Simplify the Rust refresh flow**

In `refresh_inner`:

1. Resolve `last_success_path()` before the first `spawn_refresh`.
2. Pass `Some(&path)` on the first call when the file exists.
3. Delete the unconditional second stale bridge invocation.
4. On `live.ok`, persist the mixed ViewModel as today.
5. On full failure, increment the failure count.
6. If cached data is present and failures are below five, publish
   `live.view_model`.
7. If five failures are reached while stale data is present, invoke the bridge
   once without cache to obtain the unavailable ViewModel.
8. If no stale data is present, publish the already-unavailable ViewModel
   immediately.
9. Remove the file-modification-time `STALE_MAX_AGE` check; core now validates
   each provider timestamp.

Use this control-flow shape:

```rust
let cache_path = last_success_path();
let cached = cache_path.exists().then_some(cache_path.as_path());
let live = spawn_refresh(&node, &script, &root, &effective_provider, cached)?;

if live.ok {
    let vm = live.view_model.clone();
    let _ = write_last_success(&LastSuccessFile {
        used_percent: vm.used_percent,
        fetched_at_iso: vm.fetched_at_iso.clone(),
        resets_at_iso: vm.resets_at_iso.clone(),
        view_model: vm.clone(),
    });
    return publish(app, &state, vm, true);
}

let failures = {
    let mut count = state.consecutive_failures.lock().map_err(|e| e.to_string())?;
    *count += 1;
    *count
};

let mut vm = if failures >= MAX_CONSECUTIVE_FAILURES
    && live.view_model.has_stale_data()
{
    spawn_refresh(&node, &script, &root, &effective_provider, None)
        .map(|payload| payload.view_model)?
} else {
    live.view_model
};

if failures >= MAX_CONSECUTIVE_FAILURES {
    vm.is_stale = false;
    vm.judgment_text = "额度数据长时间不可用，已停止使用旧数据判断".into();
}

publish(app, &state, vm, false)
```

The no-cache bridge call is allowed only at the five-failure escalation point;
ordinary failures use one provider read pass.

- [ ] **Step 5: Verify Rust behavior**

Run:

```powershell
cargo test --manifest-path apps/windows/src-tauri/Cargo.toml
cargo check --manifest-path apps/windows/src-tauri/Cargo.toml
```

Expected: both commands PASS with the new model tests.

- [ ] **Step 6: Commit Rust orchestration**

```powershell
git add apps/windows/src-tauri/src/model.rs apps/windows/src-tauri/src/refresh.rs
git commit -m "fix(windows): pass provider cache through refresh"
```

### Task 5: Strengthen Release Gates and Documentation

**Files:**
- Modify: `.github/workflows/release-windows.yml`
- Modify: `apps/windows/src-tauri/src/layering.rs`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add release verification before packaging**

Insert after `npm ci` in `.github/workflows/release-windows.yml`:

```yaml
      - name: Test TypeScript behavior
        run: npm test

      - name: Type-check TypeScript tests
        run: npm run test:types

      - name: Test Rust host
        run: cargo test --manifest-path apps/windows/src-tauri/Cargo.toml
```

Keep `Build portable app` after these steps.

- [ ] **Step 2: Fix the existing Clippy warning**

In `apps/windows/src-tauri/src/layering.rs`, replace:

```rust
if let Err(_) = result {
```

with:

```rust
if result.is_err() {
```

- [ ] **Step 3: Align product wording**

Change the root package description to:

```json
"description": "Windows Quota Capsule: Codex and Cursor remaining-quota gauge"
```

Update `README.md` to say the capsule reports remaining quota through five
reachable states:

```markdown
面向 Codex / Cursor 用户的 Windows 桌面额度胶囊：悬浮窗 + 系统托盘，只读本机额度周期，直观显示距离用尽还有多少余量。

- 五状态：充足 / 偏低 / 紧张 / 已用尽 / 数据暂不可用
```

- [ ] **Step 4: Run the full non-packaging verification**

Run:

```powershell
npm test
npm run test:types
npm run lint
npm run build -w quota-capsule-windows
cargo test --manifest-path apps/windows/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/windows/src-tauri/Cargo.toml --all-targets -- -D warnings
git diff --check
```

Expected: every command exits `0`, all TypeScript tests pass, Rust reports the
new model tests, and Clippy emits no warnings.

- [ ] **Step 5: Commit gates and docs**

```powershell
git add .github/workflows/release-windows.yml apps/windows/src-tauri/src/layering.rs package.json README.md
git commit -m "ci: gate Windows releases on tests"
```

### Task 6: Final Integration Verification

**Files:**
- Verify only

- [ ] **Step 1: Inspect the complete change set**

Run:

```powershell
git status --short --branch
git log --oneline --decorate -8
git diff HEAD~5 --stat
```

Expected: only the planned commits are present and no generated files are
tracked.

- [ ] **Step 2: Run the packaged bridge with fixture-only tests**

Run:

```powershell
npm test
npm run test:types
```

Expected: PASS without invoking real provider credentials.

- [ ] **Step 3: Run host verification**

Run:

```powershell
npm run build -w quota-capsule-windows
cargo test --manifest-path apps/windows/src-tauri/Cargo.toml
```

Expected: both commands PASS.

- [ ] **Step 4: Optional local packaging smoke check**

Run only when the bundled Node cache and Windows build prerequisites are
available:

```powershell
npm run win:build
```

Expected: root `Quota Capsule Beta.exe`, `resources/`, and the NSIS bundle are
produced. Do not probe live Codex or Cursor quota as part of automated
verification.
