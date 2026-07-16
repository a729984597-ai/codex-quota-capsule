#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  buildCapsuleViewModel,
  predictRunway,
} from "../packages/core/dist/index.js";
import { readCodexRateLimits } from "../packages/source-codex/dist/index.js";

const args = process.argv.slice(2);
const staleFromIdx = args.indexOf("--stale-from");
const staleFromPath =
  staleFromIdx >= 0 ? args[staleFromIdx + 1] : undefined;

function writeResult(payload) {
  process.stdout.write(JSON.stringify(payload));
}

try {
  const fetchedAt = new Date();
  const snapshot = await readCodexRateLimits({ fetchedAt, timeoutMs: 30_000 });

  if (snapshot.sourceStatus === "ok" && snapshot.weeklyWindow) {
    const forecast = predictRunway(snapshot, fetchedAt);
    const viewModel = buildCapsuleViewModel({
      forecast,
      fetchedAt: snapshot.fetchedAt,
      resetsAt: snapshot.weeklyWindow.resetsAt,
      now: fetchedAt,
      isStale: false,
      diagnosticCode: snapshot.diagnosticCode ?? null,
    });
    writeResult({
      ok: true,
      viewModel,
      snapshotMeta: {
        sourceStatus: snapshot.sourceStatus,
        diagnosticCode: snapshot.diagnosticCode ?? null,
      },
    });
    process.exit(0);
  }

  if (staleFromPath) {
    try {
      const raw = JSON.parse(readFileSync(staleFromPath, "utf8"));
      const usedPercent =
        typeof raw.usedPercent === "number"
          ? raw.usedPercent
          : typeof raw.viewModel?.usedPercent === "number"
            ? raw.viewModel.usedPercent
            : null;
      const fetchedAtIso =
        raw.fetchedAtIso ?? raw.viewModel?.fetchedAtIso ?? null;
      const resetsAtIso =
        raw.resetsAtIso ?? raw.viewModel?.resetsAtIso ?? null;
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
      const viewModel = buildCapsuleViewModel({
        forecast,
        fetchedAt: fetchedAtIso ? new Date(fetchedAtIso) : null,
        resetsAt: resetsAtIso ? new Date(resetsAtIso) : null,
        now: fetchedAt,
        isStale: true,
        diagnosticCode: snapshot.diagnosticCode ?? "stale",
      });
      writeResult({
        ok: false,
        viewModel,
        snapshotMeta: {
          sourceStatus: "error",
          diagnosticCode: viewModel.diagnosticCode,
        },
      });
      process.exit(0);
    } catch {
      // fall through to live error view
    }
  }

  const forecast = predictRunway(snapshot, fetchedAt);
  const viewModel = buildCapsuleViewModel({
    forecast,
    fetchedAt: snapshot.fetchedAt,
    resetsAt: snapshot.weeklyWindow?.resetsAt ?? null,
    now: fetchedAt,
    isStale: false,
    diagnosticCode: snapshot.diagnosticCode ?? null,
  });
  writeResult({
    ok: false,
    viewModel,
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
      state: "dataUnavailable",
      tone: "unknown",
      statusLabel: "数据暂不可用",
      judgmentText: "暂时没有可用的周额度数据",
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
