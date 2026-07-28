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
    expect(vm.statusLabel).toBe("充足");
    expect(vm.usedPercent).toBe(40);
    expect(vm.isStale).toBe(false);
    expect(vm.provider).toBe("codex");
    expect(vm.displayMode).toBe("single");
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
