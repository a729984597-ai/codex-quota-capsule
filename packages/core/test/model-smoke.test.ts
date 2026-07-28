import { describe, expect, it } from "vitest";
import type { CapsuleState, CapsuleViewModel } from "../src/index.ts";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Assert<T extends true> = T;

type ExpectedCapsuleState =
  | "onTrack"
  | "runningFast"
  | "mayRunOut"
  | "exhausted"
  | "dataUnavailable";

type _CapsuleStateContract = Assert<
  Equal<CapsuleState, ExpectedCapsuleState>
>;

describe("model exports", () => {
  it("allows constructing a CapsuleViewModel shape", () => {
    const model: CapsuleViewModel = {
      provider: "codex",
      displayMode: "single",
      state: "onTrack",
      tone: "safe",
      statusLabel: "充足",
      judgmentText: "剩余额度充足",
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
