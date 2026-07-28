import { describe, expect, it } from "vitest";
import { predictRunway } from "../src/predict.ts";
import type { AgentQuotaSnapshot } from "../src/model.ts";

function snap(input: {
  used: number;
  remaining: number;
  hoursLeft: number;
  fetchedAt: Date;
}): AgentQuotaSnapshot {
  const resetsAt = new Date(
    input.fetchedAt.getTime() + input.hoursLeft * 3600_000,
  );
  return {
    provider: "codex",
    sourceStatus: "ok",
    fetchedAt: input.fetchedAt,
    weeklyWindow: {
      label: "weekly",
      windowMinutes: 10_080,
      usedPercent: input.used,
      remainingPercent: input.remaining,
      resetsAt,
    },
  };
}

describe("predictRunway", () => {
  const t0 = new Date("2026-07-16T00:00:00.000Z");

  it("returns dataUnavailable when source errored", () => {
    const f = predictRunway(
      {
        provider: "codex",
        sourceStatus: "error",
        fetchedAt: t0,
        diagnosticCode: "cli_missing",
        errorMessage: "missing",
      },
      t0,
    );
    expect(f.state).toBe("dataUnavailable");
  });

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

  it("returns dataUnavailable when the reset is not in the future", () => {
    const forecast = predictRunway(
      snap({ used: 40, remaining: 60, hoursLeft: 0, fetchedAt: t0 }),
      t0,
    );
    expect(forecast.state).toBe("dataUnavailable");
  });
});
