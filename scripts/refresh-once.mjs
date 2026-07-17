#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { chdir } from "node:process";
import {
  buildCapsuleViewModel,
  buildProviderSlice,
  mergeDualViewModel,
  predictRunway,
} from "../packages/core/dist/index.js";
import { readCodexRateLimits } from "../packages/source-codex/dist/index.js";
import { readCursorRateLimits } from "../packages/source-cursor/dist/index.js";

/** Node 22 on Windows can EISDIR on paths that still carry the `\\?\` prefix. */
function stripWinLongPath(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  if (value.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${value.slice("\\\\?\\UNC\\".length)}`;
  }
  if (value.startsWith("\\\\?\\")) {
    return value.slice("\\\\?\\".length);
  }
  return value;
}

try {
  const cwd = stripWinLongPath(process.cwd());
  if (cwd && cwd !== process.cwd()) {
    chdir(cwd);
  }
} catch {
  // ignore cwd normalize failures
}

const args = process.argv.slice(2).map(stripWinLongPath);
const staleFromIdx = args.indexOf("--stale-from");
const staleFromPath =
  staleFromIdx >= 0 ? args[staleFromIdx + 1] : undefined;
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined;
const providerIdx = args.indexOf("--provider");
const providerArg =
  providerIdx >= 0 ? (args[providerIdx + 1] ?? "auto") : "auto";

function writeResult(payload) {
  const text = JSON.stringify(payload);
  if (outPath) {
    writeFileSync(outPath, text, "utf8");
    return;
  }
  process.stdout.write(text);
}

function isCursorRunning() {
  try {
    const out = execFileSync(
      "tasklist",
      ["/FI", "IMAGENAME eq Cursor.exe", "/NH"],
      { encoding: "utf8", windowsHide: true },
    );
    return /Cursor\.exe/i.test(out);
  } catch {
    return false;
  }
}

function resolveProvider(pref) {
  if (pref === "codex" || pref === "cursor" || pref === "both") return pref;
  return isCursorRunning() ? "cursor" : "codex";
}

function snapshotToViewModel(snapshot, fetchedAt, provider) {
  const breakdown = snapshot.usageBreakdown ?? null;
  if (snapshot.sourceStatus === "ok" && snapshot.weeklyWindow) {
    const forecast = predictRunway(snapshot, fetchedAt);
    return {
      ok: true,
      viewModel: buildCapsuleViewModel({
        forecast,
        fetchedAt: snapshot.fetchedAt,
        resetsAt: snapshot.weeklyWindow.resetsAt,
        now: fetchedAt,
        isStale: false,
        diagnosticCode: snapshot.diagnosticCode ?? null,
        provider,
        displayMode: "single",
        usageBreakdown: breakdown,
      }),
      snapshotMeta: {
        sourceStatus: snapshot.sourceStatus,
        diagnosticCode: snapshot.diagnosticCode ?? null,
      },
    };
  }

  const forecast = predictRunway(snapshot, fetchedAt);
  return {
    ok: false,
    viewModel: buildCapsuleViewModel({
      forecast,
      fetchedAt: snapshot.fetchedAt,
      resetsAt: snapshot.weeklyWindow?.resetsAt ?? null,
      now: fetchedAt,
      isStale: false,
      diagnosticCode: snapshot.diagnosticCode ?? null,
      provider,
      displayMode: "single",
      usageBreakdown: breakdown,
    }),
    snapshotMeta: {
      sourceStatus: snapshot.sourceStatus,
      diagnosticCode: snapshot.diagnosticCode ?? null,
    },
  };
}

function snapshotToSlice(snapshot, fetchedAt, provider) {
  const breakdown = snapshot.usageBreakdown ?? null;
  if (snapshot.sourceStatus === "ok" && snapshot.weeklyWindow) {
    const forecast = predictRunway(snapshot, fetchedAt);
    return buildProviderSlice({
      provider,
      forecast,
      fetchedAt: snapshot.fetchedAt,
      resetsAt: snapshot.weeklyWindow.resetsAt,
      now: fetchedAt,
      isStale: false,
      diagnosticCode: snapshot.diagnosticCode ?? null,
      usageBreakdown: breakdown,
    });
  }
  const forecast = predictRunway(snapshot, fetchedAt);
  return buildProviderSlice({
    provider,
    forecast,
    fetchedAt: snapshot.fetchedAt,
    resetsAt: snapshot.weeklyWindow?.resetsAt ?? null,
    now: fetchedAt,
    isStale: false,
    diagnosticCode: snapshot.diagnosticCode ?? null,
    usageBreakdown: breakdown,
  });
}

function tryStale(provider, fetchedAt, diagnosticCode) {
  if (!staleFromPath) return null;
  try {
    const raw = JSON.parse(readFileSync(staleFromPath, "utf8"));
    const vm = raw.viewModel ?? raw;
    // Never show another provider's cached numbers under this provider's label.
    let usedPercent = null;
    let fetchedAtIso = null;
    let resetsAtIso = null;
    if (Array.isArray(vm.providers)) {
      const slice = vm.providers.find((p) => p.provider === provider);
      if (slice) {
        usedPercent =
          typeof slice.usedPercent === "number" ? slice.usedPercent : null;
        fetchedAtIso = slice.fetchedAtIso ?? null;
        resetsAtIso = slice.resetsAtIso ?? null;
      }
    }
    if (usedPercent === null && vm.provider === provider) {
      usedPercent =
        typeof raw.usedPercent === "number"
          ? raw.usedPercent
          : typeof vm.usedPercent === "number"
            ? vm.usedPercent
            : null;
      fetchedAtIso = raw.fetchedAtIso ?? vm.fetchedAtIso ?? null;
      resetsAtIso = raw.resetsAtIso ?? vm.resetsAtIso ?? null;
    }
    if (usedPercent === null) return null;
    const forecast = {
      state: "dataUnavailable",
      usedPercent,
      remainingPercent:
        usedPercent === null ? null : Math.max(0, 100 - usedPercent),
      elapsedPercent: null,
      hoursUntilReset: null,
      projectedRemainingAtReset: null,
      sustainableRatePerHour: null,
      cycleRatePerHour: null,
      confidenceReason: "stale",
    };
    return buildCapsuleViewModel({
      forecast,
      fetchedAt: fetchedAtIso ? new Date(fetchedAtIso) : null,
      resetsAt: resetsAtIso ? new Date(resetsAtIso) : null,
      now: fetchedAt,
      isStale: true,
      diagnosticCode: diagnosticCode ?? "stale",
      provider,
      displayMode: "single",
    });
  } catch {
    return null;
  }
}

try {
  const fetchedAt = new Date();
  const selected = resolveProvider(providerArg);

  if (selected === "both") {
    const [cursorSnap, codexSnap] = await Promise.all([
      readCursorRateLimits({ fetchedAt, timeoutMs: 30_000 }),
      readCodexRateLimits({ fetchedAt, timeoutMs: 30_000 }),
    ]);
    const cursorSlice = snapshotToSlice(cursorSnap, fetchedAt, "cursor");
    const codexSlice = snapshotToSlice(codexSnap, fetchedAt, "codex");
    const viewModel = mergeDualViewModel(cursorSlice, codexSlice);
    const ok =
      cursorSnap.sourceStatus === "ok" || codexSnap.sourceStatus === "ok";
    writeResult({
      ok,
      viewModel,
      snapshotMeta: {
        sourceStatus: ok ? "ok" : "error",
        diagnosticCode: ok
          ? null
          : (cursorSnap.diagnosticCode ?? codexSnap.diagnosticCode ?? null),
      },
    });
    process.exit(ok ? 0 : 0);
  }

  const snapshot =
    selected === "cursor"
      ? await readCursorRateLimits({ fetchedAt, timeoutMs: 30_000 })
      : await readCodexRateLimits({ fetchedAt, timeoutMs: 30_000 });

  const live = snapshotToViewModel(snapshot, fetchedAt, selected);
  if (live.ok) {
    writeResult(live);
    process.exit(0);
  }

  const staleVm = tryStale(selected, fetchedAt, snapshot.diagnosticCode);
  if (staleVm) {
    writeResult({
      ok: false,
      viewModel: staleVm,
      snapshotMeta: {
        sourceStatus: "error",
        diagnosticCode: staleVm.diagnosticCode,
      },
    });
    process.exit(0);
  }

  writeResult(live);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeResult({
    ok: false,
    viewModel: {
      provider: "codex",
      displayMode: "single",
      state: "dataUnavailable",
      tone: "unknown",
      statusLabel: "数据暂不可用",
      judgmentText: "暂时没有可用的额度周期数据",
      usedPercent: null,
      resetCountdownText: "重置时间未知",
      freshnessText: "尚未成功读取",
      isStale: false,
      diagnosticCode: "parse_error",
      fetchedAtIso: null,
      resetsAtIso: null,
    },
    snapshotMeta: {
      sourceStatus: "error",
      diagnosticCode: "parse_error",
      error: message.slice(0, 200),
    },
  });
  process.exitCode = 1;
}
