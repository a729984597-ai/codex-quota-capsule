import type { AgentQuotaSnapshot, RunwayForecast } from "./model.js";

const WEEK_MINUTES = 10_080;
const EARLY_HOURS = 2;
const RUNNING_FAST_RATIO = 1;
const MAY_RUN_OUT_RATIO = 1.3;

export function predictRunway(
  snapshot: AgentQuotaSnapshot,
  now: Date = new Date(),
): RunwayForecast {
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
  const paceRatio = cycleRatePerHour / sustainableRatePerHour;
  const projectedRemainingAtReset = remaining - cycleRatePerHour * hoursUntilReset;

  let state: RunwayForecast["state"];
  let confidenceReason: string;

  if (elapsedHours < EARLY_HOURS || used < 0.5) {
    state = "earlyEstimate";
    confidenceReason = used < 0.5 ? "no-consumption-observed" : "cycle-only-sparse";
  } else if (paceRatio > MAY_RUN_OUT_RATIO) {
    state = "mayRunOut";
    confidenceReason = "pace-far-above-sustainable";
  } else if (paceRatio > RUNNING_FAST_RATIO) {
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
