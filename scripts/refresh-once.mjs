#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { chdir } from "node:process";
import {
  buildProviderSlice,
  mergeDualViewModel,
  predictRunway,
  selectProviderSlice,
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
const cachedPayload = readCachedPayload(staleFromPath);

function writeResult(payload) {
  const text = JSON.stringify(payload);
  if (outPath) {
    writeFileSync(outPath, text, "utf8");
    return;
  }
  process.stdout.write(text);
}

function readCachedPayload(path) {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
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
      subscription: snapshot.subscription ?? null,
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
    subscription: snapshot.subscription ?? null,
  });
}

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
    subscription: slice.subscription ?? null,
    resetCountdownText: slice.resetCountdownText,
    freshnessText: slice.freshnessText,
    isStale: slice.isStale,
    diagnosticCode: slice.diagnosticCode,
    fetchedAtIso: slice.fetchedAtIso,
    resetsAtIso: slice.resetsAtIso,
  };
}

try {
  const fetchedAt = new Date();
  const selected = resolveProvider(providerArg);

  if (selected === "both") {
    const [cursorSnap, codexSnap] = await Promise.all([
      readCursorRateLimits({ fetchedAt, timeoutMs: 30_000 }),
      readCodexRateLimits({ fetchedAt, timeoutMs: 30_000 }),
    ]);
    const cursor = snapshotToSelectedSlice(
      cursorSnap,
      fetchedAt,
      "cursor",
      cachedPayload,
    );
    const codex = snapshotToSelectedSlice(
      codexSnap,
      fetchedAt,
      "codex",
      cachedPayload,
    );
    const viewModel = mergeDualViewModel(cursor.slice, codex.slice);
    const ok = cursor.live || codex.live;
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
    process.exit(0);
  }

  const snapshot =
    selected === "cursor"
      ? await readCursorRateLimits({ fetchedAt, timeoutMs: 30_000 })
      : await readCodexRateLimits({ fetchedAt, timeoutMs: 30_000 });

  const selectedSlice = snapshotToSelectedSlice(
    snapshot,
    fetchedAt,
    selected,
    cachedPayload,
  );
  writeResult({
    ok: selectedSlice.live,
    viewModel: sliceToViewModel(selectedSlice.slice),
    snapshotMeta: {
      sourceStatus: snapshot.sourceStatus,
      diagnosticCode: snapshot.diagnosticCode ?? null,
    },
  });
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
      subscription: null,
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
