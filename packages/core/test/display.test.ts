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

  it("formats Codex Plus subscription validity for the expanded view", () => {
    const vm = buildCapsuleViewModel({
      forecast: base,
      fetchedAt: new Date("2026-08-03T02:00:00.000Z"),
      resetsAt: new Date("2026-08-09T00:04:00.000Z"),
      now: new Date("2026-08-03T02:00:00.000Z"),
      subscription: {
        planType: "plus",
        activeUntil: new Date("2026-08-22T01:59:00.000Z"),
      },
    });

    expect(vm.subscription?.planLabel).toBe("Plus");
    expect(vm.subscription?.validityText).toBe("有效期 19天");
    expect(vm.subscription?.expiresAtText).toMatch(/^2026-08-22 \d{2}:59$/);
    expect(vm.subscription?.expiresAtIso).toBe("2026-08-22T01:59:00.000Z");
  });

  it("formats five-hour and weekly windows for Codex display", () => {
    const vm = buildCapsuleViewModel({
      forecast: base,
      fetchedAt: new Date("2026-07-16T00:00:00.000Z"),
      resetsAt: new Date("2026-07-19T00:00:00.000Z"),
      now: new Date("2026-07-16T00:00:00.000Z"),
      quotaWindows: [
        {
          label: "five-hour",
          windowMinutes: 300,
          usedPercent: 20,
          remainingPercent: 80,
          resetsAt: new Date("2026-07-16T03:00:00.000Z"),
        },
        {
          label: "weekly",
          windowMinutes: 10_080,
          usedPercent: 35,
          remainingPercent: 65,
          resetsAt: new Date("2026-07-19T00:00:00.000Z"),
        },
      ],
    });

    expect(vm.quotaWindows).toEqual([
      {
        label: "5小时",
        usedPercent: 20,
        remainingPercent: 80,
        resetCountdownText: expect.stringMatching(/^3h · /),
        resetsAtIso: "2026-07-16T03:00:00.000Z",
      },
      {
        label: "每周",
        usedPercent: 35,
        remainingPercent: 65,
        resetCountdownText: expect.stringMatching(/^3d · /),
        resetsAtIso: "2026-07-19T00:00:00.000Z",
      },
    ]);
  });
});
