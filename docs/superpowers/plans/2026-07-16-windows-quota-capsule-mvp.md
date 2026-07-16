# Windows Quota Capsule MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Windows Tauri app with a floating quota capsule and system tray that read-only probes local Codex weekly rate limits and shows a six-state runway judgment.

**Architecture:** npm workspaces hold `packages/core` (provider-neutral MVP predictor + view model) and `packages/source-codex` (Windows-aware Codex app-server reader). A Node bridge script produces a JSON `CapsuleViewModel`. The Tauri Rust shell owns the borderless window, tray, single-instance lock, 60s refresh timer, and AppData persistence; the WebView only renders the view model.

**Tech Stack:** TypeScript 5.8, Vitest 3, Node 20+, Tauri 2, Rust, Vite 7, Windows 10/11.

## Global Constraints

- Windows-first independent repository; do not require the macOS Swift app.
- Form: floating capsule + system tray only.
- Provider: Codex-first, read-only `account/rateLimits/read` via `codex app-server`.
- Never run `codex logout`, never reinstall/replace Codex, never log tokens/cookies/prompts.
- Persist under `%AppData%\Quota Capsule Beta\` only last-success snapshot, refresh time, window position.
- MVP predictor uses **cycle evidence only** (used% vs elapsed%). Full Mac adaptive fusion (recent/activity/historical) is out of scope.
- UI copy for MVP: Simplified Chinese primary labels (English later).
- Product state names: `earlyEstimate` | `onTrack` | `runningFast` | `mayRunOut` | `exhausted` | `dataUnavailable`.
- Diagnostic codes only: `cli_missing` | `auth_required` | `timeout` | `parse_error` | `stale` | `no_weekly_window`.
- Every behavior change follows TDD; commit after each task.
- Commit messages in Chinese.

---

## File Structure

```text
package.json
tsconfig.base.json
vitest.config.ts
.gitignore
README.md
INSTALL.md
AGENTS.md
fixtures/
  codex-rate-limits/
    weekly-ok.json
    missing-weekly.json
    auth-error.json
packages/
  core/
    package.json
    tsconfig.json
    src/
      model.ts
      predict.ts
      display.ts
      index.ts
    test/
      predict.test.ts
      display.test.ts
  source-codex/
    package.json
    tsconfig.json
    src/
      paths.ts
      parse.ts
      transport.ts
      read.ts
      diagnose.ts
      index.ts
    test/
      paths.test.ts
      parse.test.ts
      diagnose.test.ts
scripts/
  refresh-once.mjs
apps/
  windows/
    package.json
    index.html
    vite.config.ts
    tsconfig.json
    src/
      main.ts
      styles.css
      render.ts
    src-tauri/
      Cargo.toml
      tauri.conf.json
      capabilities/default.json
      icons/ (generated)
      src/
        main.rs
        lib.rs
        refresh.rs
        persist.rs
        tray.rs
```

---

### Task 1: Scaffold npm workspaces

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/source-codex/package.json`
- Create: `packages/source-codex/tsconfig.json`
- Create: `AGENTS.md`

**Interfaces:**
- Consumes: none
- Produces: workspace scripts `build`, `test`, `lint`

- [ ] **Step 1: Write root workspace files**

`package.json`:

```json
{
  "name": "codex-quota-capsule-windows",
  "private": true,
  "version": "0.1.0-beta.1",
  "description": "Windows Quota Capsule: Codex weekly runway gauge",
  "license": "MIT",
  "type": "module",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build -w packages/core && npm run build -w packages/source-codex",
    "test": "npm run build && vitest run",
    "lint": "tsc -p tsconfig.base.json --noEmit",
    "refresh:once": "npm run build && node scripts/refresh-once.mjs"
  },
  "devDependencies": {
    "@types/node": "^20.19.2",
    "typescript": "^5.8.3",
    "vitest": "^3.2.6"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
```

`packages/core/package.json`:

```json
{
  "name": "@quota-capsule/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

`packages/source-codex/package.json`:

```json
{
  "name": "@quota-capsule/source-codex",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@quota-capsule/core": "0.1.0"
  }
}
```

`packages/source-codex/tsconfig.json`: same shape as core, `rootDir`/`outDir` under that package.

`AGENTS.md`:

```md
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
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`  
Expected: lockfile created, workspaces linked, exit 0

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json vitest.config.ts packages AGENTS.md
git commit -m "chore: 初始化 Windows monorepo 工作区"
```

---

### Task 2: Core model types

**Files:**
- Create: `packages/core/src/model.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/test/model-smoke.test.ts`

**Interfaces:**
- Consumes: none
- Produces: types `SourceStatus`, `QuotaWindow`, `AgentQuotaSnapshot`, `CapsuleState`, `CapsuleTone`, `RunwayForecast`, `CapsuleViewModel`, `DiagnosticCode`

- [ ] **Step 1: Write failing smoke test**

```ts
// packages/core/test/model-smoke.test.ts
import { describe, expect, it } from "vitest";
import type { CapsuleViewModel } from "../src/index.ts";

describe("model exports", () => {
  it("allows constructing a CapsuleViewModel shape", () => {
    const model: CapsuleViewModel = {
      state: "onTrack",
      tone: "safe",
      statusLabel: "够用",
      judgmentText: "按当前节奏有望撑到重置",
      usedPercent: 42,
      resetCountdownText: "还剩 3 天",
      freshnessText: "刚刚更新",
      isStale: false,
      diagnosticCode: null,
      fetchedAtIso: "2026-07-16T01:00:00.000Z",
      resetsAtIso: "2026-07-19T01:00:00.000Z",
    };
    expect(model.state).toBe("onTrack");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/model-smoke.test.ts`  
Expected: FAIL resolving `../src/index.ts` or missing type

- [ ] **Step 3: Implement model + export**

```ts
// packages/core/src/model.ts
export type SourceStatus = "ok" | "stale" | "error";

export type DiagnosticCode =
  | "cli_missing"
  | "auth_required"
  | "timeout"
  | "parse_error"
  | "stale"
  | "no_weekly_window";

export type QuotaWindow = {
  label: string;
  windowMinutes: number;
  usedPercent: number;
  remainingPercent: number;
  resetsAt: Date;
};

export type AgentQuotaSnapshot = {
  provider: string;
  sourceStatus: SourceStatus;
  fetchedAt: Date;
  weeklyWindow?: QuotaWindow;
  errorMessage?: string;
  diagnosticCode?: DiagnosticCode;
};

/** Product-facing six states (MVP). */
export type CapsuleState =
  | "earlyEstimate"
  | "onTrack"
  | "runningFast"
  | "mayRunOut"
  | "exhausted"
  | "dataUnavailable";

export type CapsuleTone = "safe" | "watch" | "danger" | "unknown";

export type RunwayForecast = {
  state: CapsuleState;
  usedPercent: number | null;
  remainingPercent: number | null;
  elapsedPercent: number | null;
  hoursUntilReset: number | null;
  projectedRemainingAtReset: number | null;
  sustainableRatePerHour: number | null;
  cycleRatePerHour: number | null;
  confidenceReason: string;
};

export type CapsuleViewModel = {
  state: CapsuleState;
  tone: CapsuleTone;
  statusLabel: string;
  judgmentText: string;
  usedPercent: number | null;
  resetCountdownText: string;
  freshnessText: string;
  isStale: boolean;
  diagnosticCode: DiagnosticCode | null;
  fetchedAtIso: string | null;
  resetsAtIso: string | null;
};
```

```ts
// packages/core/src/index.ts
export * from "./model.js";
```

- [ ] **Step 4: Build and pass smoke test**

Run: `npm run build -w packages/core && npx vitest run packages/core/test/model-smoke.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): 定义额度快照与胶囊视图模型类型"
```

---

### Task 3: Cycle-based runway predictor (TDD)

**Files:**
- Create: `packages/core/src/predict.ts`
- Create: `packages/core/test/predict.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `AgentQuotaSnapshot`
- Produces: `predictRunway(snapshot: AgentQuotaSnapshot, now?: Date): RunwayForecast`

**MVP rules (cycle evidence only):**

1. If `sourceStatus !== "ok"` or no weekly window → `dataUnavailable`
2. If `remainingPercent <= 0.5` → `exhausted`
3. `elapsedHours = windowMinutes/60 - hoursUntilReset` (clamp ≥ small epsilon)
4. `cycleRatePerHour = usedPercent / elapsedHours`
5. `projectedRemainingAtReset = remainingPercent - cycleRatePerHour * hoursUntilReset`
6. If elapsed coverage `< 2 hours` OR usedPercent `< 0.5` → `earlyEstimate`
7. Else if `projectedRemainingAtReset < 0` → `mayRunOut`
8. Else if `cycleRatePerHour > sustainableRatePerHour * 1.15` → `runningFast`
9. Else → `onTrack`

- [ ] **Step 1: Write failing predictor tests**

```ts
// packages/core/test/predict.test.ts
import { describe, expect, it } from "vitest";
import { predictRunway } from "../src/predict.ts";
import type { AgentQuotaSnapshot } from "../src/model.ts";

function snap(partial: Partial<AgentQuotaSnapshot> & { used: number; remaining: number; hoursLeft: number; fetchedAt: Date }): AgentQuotaSnapshot {
  const resetsAt = new Date(partial.fetchedAt.getTime() + partial.hoursLeft * 3600_000);
  return {
    provider: "codex",
    sourceStatus: "ok",
    fetchedAt: partial.fetchedAt,
    weeklyWindow: {
      label: "weekly",
      windowMinutes: 10_080,
      usedPercent: partial.used,
      remainingPercent: partial.remaining,
      resetsAt,
    },
    ...partial,
  };
}

describe("predictRunway", () => {
  const t0 = new Date("2026-07-16T00:00:00.000Z");

  it("returns dataUnavailable when source errored", () => {
    const f = predictRunway({
      provider: "codex",
      sourceStatus: "error",
      fetchedAt: t0,
      diagnosticCode: "cli_missing",
      errorMessage: "missing",
    }, t0);
    expect(f.state).toBe("dataUnavailable");
  });

  it("returns exhausted when remaining is ~0", () => {
    const f = predictRunway(snap({ used: 100, remaining: 0, hoursLeft: 48, fetchedAt: t0 }), t0);
    expect(f.state).toBe("exhausted");
  });

  it("returns earlyEstimate for first sparse reading", () => {
    // 1 hour into week, 1% used
    const fetchedAt = new Date(t0.getTime() + 1 * 3600_000);
    const f = predictRunway(snap({ used: 1, remaining: 99, hoursLeft: 167, fetchedAt }), fetchedAt);
    expect(f.state).toBe("earlyEstimate");
  });

  it("returns onTrack when pace is sustainable", () => {
    // 84h elapsed of 168h, 40% used → rate ~0.476%/h; sustainable = 60/84 ≈ 0.714
    const fetchedAt = new Date(t0.getTime() + 84 * 3600_000);
    const f = predictRunway(snap({ used: 40, remaining: 60, hoursLeft: 84, fetchedAt }), fetchedAt);
    expect(f.state).toBe("onTrack");
  });

  it("returns runningFast when still projected positive but pace high", () => {
    // 84h elapsed, 55% used → remaining 45; rate 55/84; sustainable 45/84; 55>45*1.15? cycle>sustainable*1.15
    const fetchedAt = new Date(t0.getTime() + 84 * 3600_000);
    const f = predictRunway(snap({ used: 55, remaining: 45, hoursLeft: 84, fetchedAt }), fetchedAt);
    expect(f.state).toBe("runningFast");
  });

  it("returns mayRunOut when projection is negative", () => {
    // 24h elapsed, 40% used → rate 1.667%/h * 144h left = 240 > 60 remaining
    const fetchedAt = new Date(t0.getTime() + 24 * 3600_000);
    const f = predictRunway(snap({ used: 40, remaining: 60, hoursLeft: 144, fetchedAt }), fetchedAt);
    expect(f.state).toBe("mayRunOut");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run packages/core/test/predict.test.ts`  
Expected: FAIL cannot find `predictRunway`

- [ ] **Step 3: Implement `predict.ts`**

```ts
// packages/core/src/predict.ts
import type { AgentQuotaSnapshot, RunwayForecast } from "./model.js";

const WEEK_MINUTES = 10_080;
const EARLY_HOURS = 2;
const FAST_RATIO = 1.15;

export function predictRunway(snapshot: AgentQuotaSnapshot, now: Date = new Date()): RunwayForecast {
  const unavailable = (reason: string): RunwayForecast => ({
    state: "dataUnavailable",
    usedPercent: snapshot.weeklyWindow?.usedPercent ?? null,
    remainingPercent: snapshot.weeklyWindow?.remainingPercent ?? null,
    elapsedPercent: null,
    hoursUntilReset: null,
    projectedRemainingAtReset: null,
    sustainableRatePerHour: null,
    cycleRatePerHour: null,
    confidenceReason: reason,
  });

  if (snapshot.sourceStatus !== "ok" || !snapshot.weeklyWindow) {
    return unavailable(snapshot.diagnosticCode ?? "parse_error");
  }

  const w = snapshot.weeklyWindow;
  const hoursUntilReset = (w.resetsAt.getTime() - now.getTime()) / 3600_000;
  if (!Number.isFinite(hoursUntilReset) || hoursUntilReset <= 0) {
    return unavailable("parse_error");
  }

  const windowHours = (w.windowMinutes || WEEK_MINUTES) / 60;
  const elapsedHours = Math.max(windowHours - hoursUntilReset, 1 / 60);
  const used = clamp(w.usedPercent);
  const remaining = clamp(w.remainingPercent);
  const elapsedPercent = clamp((elapsedHours / windowHours) * 100);

  if (remaining <= 0.5) {
    return {
      state: "exhausted",
      usedPercent: used,
      remainingPercent: remaining,
      elapsedPercent,
      hoursUntilReset,
      projectedRemainingAtReset: 0,
      sustainableRatePerHour: 0,
      cycleRatePerHour: used / elapsedHours,
      confidenceReason: "exhausted",
    };
  }

  const cycleRatePerHour = used / elapsedHours;
  const sustainableRatePerHour = remaining / hoursUntilReset;
  const projectedRemainingAtReset = remaining - cycleRatePerHour * hoursUntilReset;

  let state: RunwayForecast["state"];
  let confidenceReason: string;

  if (elapsedHours < EARLY_HOURS || used < 0.5) {
    state = "earlyEstimate";
    confidenceReason = used < 0.5 ? "no-consumption-observed" : "cycle-only-sparse";
  } else if (projectedRemainingAtReset < 0) {
    state = "mayRunOut";
    confidenceReason = "projected-negative";
  } else if (cycleRatePerHour > sustainableRatePerHour * FAST_RATIO) {
    state = "runningFast";
    confidenceReason = "pace-above-sustainable";
  } else {
    state = "onTrack";
    confidenceReason = "pace-sustainable";
  }

  return {
    state,
    usedPercent: used,
    remainingPercent: remaining,
    elapsedPercent,
    hoursUntilReset,
    projectedRemainingAtReset,
    sustainableRatePerHour,
    cycleRatePerHour,
    confidenceReason,
  };
}

function clamp(n: number): number {
  return Math.min(100, Math.max(0, n));
}
```

Export from `index.ts`: `export * from "./predict.js";`

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm run build -w packages/core && npx vitest run packages/core/test/predict.test.ts`  
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): 实现基于周期证据的跑道预测"
```

---

### Task 4: Display / CapsuleViewModel builder

**Files:**
- Create: `packages/core/src/display.ts`
- Create: `packages/core/test/display.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `RunwayForecast`, optional last-success + stale flag
- Produces:
  - `buildCapsuleViewModel(input: BuildViewModelInput): CapsuleViewModel`
  - `BuildViewModelInput = { forecast, fetchedAt, resetsAt, now?, isStale?, diagnosticCode? }`

- [ ] **Step 1: Write failing display tests**

```ts
import { describe, expect, it } from "vitest";
import { buildCapsuleViewModel } from "../src/display.ts";
import type { RunwayForecast } from "../src/model.ts";

const base: RunwayForecast = {
  state: "onTrack",
  usedPercent: 40,
  remainingPercent: 60,
  elapsedPercent: 50,
  hoursUntilReset: 84,
  projectedRemainingAtReset: 20,
  sustainableRatePerHour: 0.7,
  cycleRatePerHour: 0.5,
  confidenceReason: "pace-sustainable",
};

describe("buildCapsuleViewModel", () => {
  it("maps onTrack to Chinese labels", () => {
    const vm = buildCapsuleViewModel({
      forecast: base,
      fetchedAt: new Date("2026-07-16T12:00:00.000Z"),
      resetsAt: new Date("2026-07-20T00:00:00.000Z"),
      now: new Date("2026-07-16T12:05:00.000Z"),
    });
    expect(vm.state).toBe("onTrack");
    expect(vm.tone).toBe("safe");
    expect(vm.statusLabel).toBe("够用");
    expect(vm.usedPercent).toBe(40);
    expect(vm.isStale).toBe(false);
  });

  it("marks stale last-success as dataUnavailable tone unknown", () => {
    const vm = buildCapsuleViewModel({
      forecast: base,
      fetchedAt: new Date("2026-07-16T10:00:00.000Z"),
      resetsAt: new Date("2026-07-20T00:00:00.000Z"),
      now: new Date("2026-07-16T12:00:00.000Z"),
      isStale: true,
      diagnosticCode: "stale",
    });
    expect(vm.state).toBe("dataUnavailable");
    expect(vm.tone).toBe("unknown");
    expect(vm.isStale).toBe(true);
    expect(vm.usedPercent).toBe(40);
    expect(vm.judgmentText).toContain("上次成功");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement display builder**

```ts
// packages/core/src/display.ts
import type {
  CapsuleState,
  CapsuleTone,
  CapsuleViewModel,
  DiagnosticCode,
  RunwayForecast,
} from "./model.js";

export type BuildViewModelInput = {
  forecast: RunwayForecast;
  fetchedAt: Date | null;
  resetsAt: Date | null;
  now?: Date;
  isStale?: boolean;
  diagnosticCode?: DiagnosticCode | null;
};

const STATUS: Record<CapsuleState, string> = {
  earlyEstimate: "初步判断",
  onTrack: "够用",
  runningFast: "偏快",
  mayRunOut: "可能不够",
  exhausted: "已用尽",
  dataUnavailable: "数据暂不可用",
};

const TONE: Record<CapsuleState, CapsuleTone> = {
  earlyEstimate: "unknown",
  onTrack: "safe",
  runningFast: "watch",
  mayRunOut: "danger",
  exhausted: "danger",
  dataUnavailable: "unknown",
};

export function buildCapsuleViewModel(input: BuildViewModelInput): CapsuleViewModel {
  const now = input.now ?? new Date();
  if (input.isStale) {
    return {
      state: "dataUnavailable",
      tone: "unknown",
      statusLabel: STATUS.dataUnavailable,
      judgmentText: "正在显示上次成功的周额度数据，恢复实时读取前暂不判断周速度。",
      usedPercent: input.forecast.usedPercent,
      resetCountdownText: formatCountdown(input.resetsAt, now),
      freshnessText: formatFreshness(input.fetchedAt, now, true),
      isStale: true,
      diagnosticCode: input.diagnosticCode ?? "stale",
      fetchedAtIso: input.fetchedAt?.toISOString() ?? null,
      resetsAtIso: input.resetsAt?.toISOString() ?? null,
    };
  }

  const state = input.forecast.state;
  return {
    state,
    tone: TONE[state],
    statusLabel: STATUS[state],
    judgmentText: judgmentFor(input.forecast),
    usedPercent: input.forecast.usedPercent,
    resetCountdownText: formatCountdown(input.resetsAt, now),
    freshnessText: formatFreshness(input.fetchedAt, now, false),
    isStale: false,
    diagnosticCode: state === "dataUnavailable" ? (input.diagnosticCode ?? null) : null,
    fetchedAtIso: input.fetchedAt?.toISOString() ?? null,
    resetsAtIso: input.resetsAt?.toISOString() ?? null,
  };
}

function judgmentFor(f: RunwayForecast): string {
  switch (f.state) {
    case "dataUnavailable":
      return "暂时没有可用的周额度数据";
    case "exhausted":
      return "本周额度已用尽，重置后会自动恢复";
    case "earlyEstimate":
      return f.confidenceReason === "no-consumption-observed"
        ? "尚未观察到消耗，先按本周剩余时间匀速使用"
        : "初步判断：按本周平均速度估算是否可持续";
    case "onTrack":
      return "按当前节奏，有望撑到本周重置";
    case "runningFast":
      return "仍可能撑到重置，但当前速度已经偏快";
    case "mayRunOut":
      return "照最近速度，本周额度可能在重置前用完";
  }
}

function formatCountdown(resetsAt: Date | null, now: Date): string {
  if (!resetsAt) return "重置时间未知";
  const hours = (resetsAt.getTime() - now.getTime()) / 3600_000;
  if (!Number.isFinite(hours) || hours <= 0) return "即将重置或已过期";
  if (hours < 24) return `还剩 ${Math.max(1, Math.round(hours))} 小时`;
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours - days * 24);
  return rem > 0 ? `还剩 ${days} 天 ${rem} 小时` : `还剩 ${days} 天`;
}

function formatFreshness(fetchedAt: Date | null, now: Date, stale: boolean): string {
  if (!fetchedAt) return "尚未成功读取";
  const mins = Math.max(0, Math.round((now.getTime() - fetchedAt.getTime()) / 60_000));
  if (stale) return mins <= 1 ? "上次成功：刚刚" : `上次成功：${mins} 分钟前`;
  if (mins <= 1) return "刚刚更新";
  if (mins < 60) return `${mins} 分钟前更新`;
  return `${Math.round(mins / 60)} 小时前更新`;
}
```

- [ ] **Step 4: Pass tests + commit**

```bash
npm run build -w packages/core && npx vitest run packages/core/test/display.test.ts
git add packages/core
git commit -m "feat(core): 生成中文胶囊视图模型"
```

---

### Task 5: Codex rate-limit parser + fixtures

**Files:**
- Create: `fixtures/codex-rate-limits/weekly-ok.json`
- Create: `fixtures/codex-rate-limits/missing-weekly.json`
- Create: `fixtures/codex-rate-limits/auth-error.json`
- Create: `packages/source-codex/src/parse.ts`
- Create: `packages/source-codex/src/diagnose.ts`
- Create: `packages/source-codex/src/index.ts`
- Create: `packages/source-codex/test/parse.test.ts`
- Create: `packages/source-codex/test/diagnose.test.ts`

**Interfaces:**
- Consumes: raw JSON-RPC `result` object
- Produces:
  - `parseCodexRateLimits(result: unknown, options: { fetchedAt: Date }): AgentQuotaSnapshot`
  - `classifyCodexError(message: string): DiagnosticCode`

- [ ] **Step 1: Add fixtures**

`weekly-ok.json` — minimal shape:

```json
{
  "rateLimits": {
    "primary": {
      "usedPercent": 35,
      "windowDurationMins": 10080,
      "resetsAt": 1753200000
    },
    "secondary": {
      "usedPercent": 10,
      "windowDurationMins": 180,
      "resetsAt": 1752681600
    }
  }
}
```

`missing-weekly.json`:

```json
{
  "rateLimits": {
    "primary": {
      "usedPercent": 10,
      "windowDurationMins": 180,
      "resetsAt": 1752681600
    }
  }
}
```

`auth-error.json` — used only as message corpus in diagnose tests, not as parse input.

- [ ] **Step 2: Write failing parse/diagnose tests**

Parse: weekly-ok → `sourceStatus: "ok"` + weekly window label `weekly`; missing-weekly → error + `no_weekly_window`.  
Diagnose: message containing `auth`/`login`/`unauthorized` → `auth_required`; `timed out` → `timeout`; `not found` → `cli_missing`; else `parse_error`.

- [ ] **Step 3: Implement parser**

Port the weekly-window selection rules from upstream `packages/source-codex/src/probe.ts`:

- Accept windows with `|windowMinutes - 10080| <= 60`
- `resetsAt` in the future relative to `fetchedAt`
- Remaining time ≤ 8 days
- `remainingPercent = 100 - usedPercent`
- Do **not** model reset credits in MVP (ignore that field)

Also implement `classifyCodexError`.

- [ ] **Step 4: Pass tests + commit**

```bash
npm run build && npx vitest run packages/source-codex/test
git add fixtures packages/source-codex
git commit -m "feat(source-codex): 解析 Codex rateLimits 并分类安全诊断码"
```

---

### Task 6: Windows Codex path resolution + app-server transport

**Files:**
- Create: `packages/source-codex/src/paths.ts`
- Create: `packages/source-codex/src/transport.ts`
- Create: `packages/source-codex/src/read.ts`
- Create: `packages/source-codex/test/paths.test.ts`
- Modify: `packages/source-codex/src/index.ts`

**Interfaces:**
- Consumes: `process.env.PATH`, `os.homedir()`
- Produces:
  - `codexPathCandidates(envPath?: string, home?: string, platform?: NodeJS.Platform): string[]`
  - `findCodexPath(): Promise<{ codexPath: string | null; checkedPaths: string[] }>`
  - `readCodexRateLimits(options?: { fetchedAt?: Date; timeoutMs?: number; codexPath?: string }): Promise<AgentQuotaSnapshot>`

- [ ] **Step 1: Write failing path tests**

```ts
import { describe, expect, it } from "vitest";
import { codexPathCandidates } from "../src/paths.ts";

describe("codexPathCandidates", () => {
  it("splits Windows PATH with semicolons and includes .cmd/.exe", () => {
    const paths = codexPathCandidates(
      "C:\\\\bin;D:\\\\tools",
      "C:\\\\Users\\\\demo",
      "win32",
    );
    expect(paths.some((p) => p.endsWith("C:\\\\bin\\\\codex.cmd") || p.endsWith("C:\\bin\\codex.cmd"))).toBe(true);
    expect(paths.some((p) => p.includes(".codex"))).toBe(true);
  });

  it("splits POSIX PATH with colons", () => {
    const paths = codexPathCandidates("/usr/local/bin:/usr/bin", "/home/demo", "linux");
    expect(paths).toContain("/usr/local/bin/codex");
  });
});
```

- [ ] **Step 2: Implement Windows-aware candidates**

On `win32`:

- Split PATH on `;`
- For each dir, candidates: `codex.cmd`, `codex.exe`, `codex`
- Home candidates: `%USERPROFILE%\\.local\\bin\\codex.cmd`, `%USERPROFILE%\\.codex\\...` if present patterns mirror upstream

Use `fs.access` with `fs.constants.F_OK` (Windows executability differs from POSIX `X_OK`).

- [ ] **Step 3: Port ProcessCodexAppServerTransport**

Adapt upstream spawn:

```ts
spawn(codexPath, ["-s", "read-only", "-a", "untrusted", "app-server"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: process.env })
```

JSON-RPC sequence unchanged:

1. `initialize`
2. `initialized` notification
3. `account/rateLimits/read`

Sanitize stderr before attaching to errors (redact Bearer tokens, URLs, user home segments). Map thrown errors through `classifyCodexError`.

- [ ] **Step 4: Export `readCodexRateLimits` and unit-test parse path via transport mock if easy; otherwise keep live probe manual-only**

Add a tiny fake transport test: feed canned initialize + rateLimits responses → snapshot ok.

- [ ] **Step 5: Commit**

```bash
git add packages/source-codex
git commit -m "feat(source-codex): 支持 Windows 路径探测与 app-server 只读读取"
```

---

### Task 7: refresh-once bridge script

**Files:**
- Create: `scripts/refresh-once.mjs`

**Interfaces:**
- Consumes: built `@quota-capsule/source-codex` + `@quota-capsule/core`
- Produces: stdout JSON `{ ok: boolean, viewModel: CapsuleViewModel, snapshotMeta: { sourceStatus, diagnosticCode } }` only — never raw auth

- [ ] **Step 1: Implement script**

```js
import { readCodexRateLimits } from "../packages/source-codex/dist/index.js";
import { predictRunway, buildCapsuleViewModel } from "../packages/core/dist/index.js";

const fetchedAt = new Date();
const snapshot = await readCodexRateLimits({ fetchedAt, timeoutMs: 30_000 });
const forecast = predictRunway(snapshot, fetchedAt);
const viewModel = buildCapsuleViewModel({
  forecast,
  fetchedAt: snapshot.weeklyWindow ? snapshot.fetchedAt : snapshot.fetchedAt,
  resetsAt: snapshot.weeklyWindow?.resetsAt ?? null,
  now: fetchedAt,
  isStale: false,
  diagnosticCode: snapshot.diagnosticCode ?? null,
});

process.stdout.write(
  JSON.stringify({
    ok: snapshot.sourceStatus === "ok",
    viewModel,
    snapshotMeta: {
      sourceStatus: snapshot.sourceStatus,
      diagnosticCode: snapshot.diagnosticCode ?? null,
    },
  }),
);
```

- [ ] **Step 2: Manual smoke (optional if Codex installed)**

Run: `npm run refresh:once`  
Expected: JSON with `viewModel.state` one of six states; if CLI missing → `dataUnavailable` + `cli_missing`

- [ ] **Step 3: Commit**

```bash
git add scripts/refresh-once.mjs package.json
git commit -m "feat: 添加一次性刷新桥接脚本"
```

---

### Task 8: Tauri 2 app scaffold + borderless window

**Files:**
- Create: `apps/windows/package.json`
- Create: `apps/windows/index.html`
- Create: `apps/windows/vite.config.ts`
- Create: `apps/windows/tsconfig.json`
- Create: `apps/windows/src/main.ts`
- Create: `apps/windows/src/styles.css`
- Create: `apps/windows/src/render.ts`
- Create: `apps/windows/src-tauri/*` via `npm create tauri-app` **or** hand-written minimal Tauri 2 project named `quota-capsule-windows`

**Interfaces:**
- Consumes: none yet
- Produces: runnable `npm run tauri dev -w apps/windows` showing a 280×64 borderless always-on-top window

- [ ] **Step 1: Scaffold Tauri 2 + Vite vanilla TS in `apps/windows`**

Window config (`tauri.conf.json` excerpt):

```json
{
  "productName": "Quota Capsule Beta",
  "identifier": "com.bono.quota-capsule.beta.windows",
  "app": {
    "windows": [
      {
        "title": "Quota Capsule Beta",
        "width": 280,
        "height": 64,
        "resizable": false,
        "decorations": false,
        "alwaysOnTop": true,
        "transparent": true,
        "skipTaskbar": true
      }
    ]
  }
}
```

Enable plugins later: `tauri-plugin-single-instance`, shell/process for node refresh.

- [ ] **Step 2: Placeholder UI**

`render.ts` draws collapsed capsule with hardcoded `dataUnavailable` so window is visible before live data.

- [ ] **Step 3: Verify window opens**

Run: `npm run tauri dev -w apps/windows`  
Expected: small floating window appears; close via Alt+F4 or tray (tray comes next — for now allow temporary close button in expanded placeholder)

- [ ] **Step 4: Commit**

```bash
git add apps/windows
git commit -m "feat(windows): 搭建 Tauri 无边框悬浮窗壳"
```

---

### Task 9: System tray + single instance

**Files:**
- Modify: `apps/windows/src-tauri/Cargo.toml`
- Modify: `apps/windows/src-tauri/src/lib.rs`
- Create: `apps/windows/src-tauri/src/tray.rs`

**Interfaces:**
- Consumes: current `CapsuleViewModel` held in `AppState`
- Produces: tray menu Show/Hide, Refresh, Quit; left-click show+focus; tooltip text

- [ ] **Step 1: Add tray menu**

Menu items (Chinese):

- 显示胶囊 / 隐藏胶囊
- 立即刷新
- 退出

Left-click tray icon → `show()` + `set_focus()` on main window.

- [ ] **Step 2: Single instance**

Use `tauri-plugin-single-instance`: second launch focuses existing window and exits.

- [ ] **Step 3: Manual verify**

Start app twice → one process. Tray hide/show works. Quit exits process.

- [ ] **Step 4: Commit**

```bash
git add apps/windows/src-tauri
git commit -m "feat(windows): 添加系统托盘与单实例"
```

---

### Task 10: Persist AppData + refresh loop

**Files:**
- Create: `apps/windows/src-tauri/src/persist.rs`
- Create: `apps/windows/src-tauri/src/refresh.rs`
- Modify: `apps/windows/src-tauri/src/lib.rs`
- Modify: root/package scripts if needed to expose node path

**Interfaces:**
- Consumes: `scripts/refresh-once.mjs` via `Command::new("node")`
- Produces:
  - `AppState { view_model: CapsuleViewModel, last_success: Option<...> }`
  - events `quota://updated` to frontend
  - files:
    - `%AppData%/Quota Capsule Beta/last-success.json`
    - `%AppData%/Quota Capsule Beta/window-position.json`

- [ ] **Step 1: Implement persistence**

On successful `ok: true`, write `last-success.json` with viewModel + fetchedAt.  
On failure: if last-success exists, rebuild stale view via calling core logic **or** mark `isStale` in Rust by setting fields (`state=dataUnavailable`, keep usedPercent, `diagnosticCode=stale`). Prefer: bridge accepts `--stale-from path` later; MVP can stale-mark in Rust by shallow field overrides matching Task 4 semantics.

Also save/restore window position on move/exit.

- [ ] **Step 2: Refresh command**

```rust
// pseudo
fn refresh(app: AppHandle) {
  let output = Command::new("node")
    .args([repo_or_resource_path.join("scripts/refresh-once.mjs")])
    .output();
  // parse JSON, update state, tray tooltip, emit event
}
```

Packaging note: in dev, resolve script relative to workspace root env `QUOTA_CAPSULE_ROOT`; in production bundle, ship `scripts/` + `packages/*/dist` as resources and run with bundled node **or** require system Node on PATH for Beta. **MVP decision: require system Node.js on PATH** (document in INSTALL). Same for `codex`.

- [ ] **Step 3: Timer**

Every 60s call refresh. Tray "立即刷新" calls same. Launch triggers immediate refresh.

- [ ] **Step 4: Manual verify**

With Codex logged in: capsule updates within 60s and on tray refresh.  
Stop Codex / rename PATH: shows stale/unavailable, no crash.

- [ ] **Step 5: Commit**

```bash
git add apps/windows scripts
git commit -m "feat(windows): 接入刷新循环与 AppData 持久化"
```

---

### Task 11: Capsule UI polish (collapsed / expanded)

**Files:**
- Modify: `apps/windows/src/render.ts`
- Modify: `apps/windows/src/styles.css`
- Modify: `apps/windows/src/main.ts`

**Interfaces:**
- Consumes: `quota://updated` payload `CapsuleViewModel`
- Produces: collapsed/expanded DOM; click toggles; Refresh button invokes Tauri command `refresh_now`

- [ ] **Step 1: Collapsed layout**

Row: tone dot · statusLabel · `本周已用 {n}%` · resetCountdownText  
Colors: safe=green, watch=amber, danger=red, unknown=gray.

- [ ] **Step 2: Expanded layout**

Height animates to ~140px (Rust `set_size` on toggle). Show judgmentText, freshnessText, diagnosticCode (if any), Refresh button.

- [ ] **Step 3: Drag

Use Tauri `data-tauri-drag-region` on capsule chrome so users can reposition; persist position via existing persist hooks.

- [ ] **Step 4: Manual UI pass + commit**

```bash
git add apps/windows/src
git commit -m "feat(windows): 完成胶囊折叠展开与状态渲染"
```

---

### Task 12: Docs, install notes, acceptance checklist

**Files:**
- Create: `README.md`
- Create: `INSTALL.md`
- Modify: `package.json` scripts (`win:dev`, `win:build`)

- [ ] **Step 1: Write README/INSTALL in 中文**

Cover:

- Prerequisites: Windows 10/11, Node 20+, Rust/MSVC build tools, Codex CLI logged in
- `npm ci` → `npm test` → `npm run build` → `npm run win:dev` / `win:build`
- Privacy boundary
- Troubleshooting `cli_missing` / `auth_required`

- [ ] **Step 2: Acceptance checklist run**

1. `npm test` PASS  
2. `npm run win:build` produces installer/exe  
3. Live Codex refresh works  
4. Unavailable path safe  
5. Tray show/hide/quit works  
6. AppData JSON has no secrets  

- [ ] **Step 3: Commit**

```bash
git add README.md INSTALL.md package.json
git commit -m "docs: 添加 Windows 安装说明与验收清单"
```

---

## Spec Coverage Self-Review

| Spec requirement | Task |
| --- | --- |
| Floating capsule + tray | 8, 9, 11 |
| Tauri 2 | 8–11 |
| Independent Windows repo | 1 |
| packages/core + source-codex | 2–6 |
| Six states | 3, 4 |
| 60s + manual refresh | 10 |
| AppData persistence | 10 |
| Safe diagnostics / no auth mutation | 5, 6, 7 |
| Single instance | 9 |
| MVP non-goals deferred | explicitly omitted (charts, credits, i18n, analytics) |
| Acceptance criteria | 12 |

## Placeholder / Consistency Check

- State names consistent: `earlyEstimate|onTrack|runningFast|mayRunOut|exhausted|dataUnavailable`
- Bridge output always `CapsuleViewModel`
- Stale behavior matches display tests
- Windows PATH uses `;` and `codex.cmd`

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-16-windows-quota-capsule-mvp.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每个 Task 开一个新子代理，任务间做审查，迭代快  
2. **Inline Execution** — 本会话内按 executing-plans 连续执行，并设检查点  

你要哪一种？
