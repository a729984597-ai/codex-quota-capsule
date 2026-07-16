import type { AgentQuotaSnapshot, RunwayForecast } from "./model.js";

const WEEK_MINUTES = 10_080;
// Remaining-quota thresholds (percent).
const LOW_REMAINING = 30;
const CRITICAL_REMAINING = 10;

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
  const projectedRemainingAtReset = remaining - cycleRatePerHour * hoursUntilReset;

  // Classify purely by how much quota is left.
  let state: RunwayForecast["state"];
  let confidenceReason: string;

  if (remaining < CRITICAL_REMAINING) {
    state = "mayRunOut";
    confidenceReason = "remaining-critical";
  } else if (remaining < LOW_REMAINING) {
    state = "runningFast";
    confidenceReason = "remaining-low";
  } else {
    state = "onTrack";
    confidenceReason = "remaining-sufficient";
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
