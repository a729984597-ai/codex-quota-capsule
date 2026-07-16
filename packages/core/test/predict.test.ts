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
    // 84h elapsed, 84h left, 55% used → paceRatio = (55/84)/(45/84) ≈ 1.22 → 1 < r ≤ 1.3 → runningFast
    const fetchedAt = new Date(t0.getTime() + 84 * 3600_000);
    const f = predictRunway(snap({ used: 55, remaining: 45, hoursLeft: 84, fetchedAt }), fetchedAt);
    expect(f.state).toBe("runningFast");
  });

  it("returns mayRunOut when projection is negative", () => {
    // 24h elapsed, 144h left, 40% used → paceRatio = (40/24)/(60/144) = 4 > 1.3 → mayRunOut
    const fetchedAt = new Date(t0.getTime() + 24 * 3600_000);
    const f = predictRunway(snap({ used: 40, remaining: 60, hoursLeft: 144, fetchedAt }), fetchedAt);
    expect(f.state).toBe("mayRunOut");
  });
});
