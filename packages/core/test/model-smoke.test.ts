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
