import { describe, expect, it } from "vitest";
import {
  capsuleHeights,
  renderCapsule,
  type CapsuleViewModel,
} from "../src/render.ts";

function model(): CapsuleViewModel {
  return {
    provider: "codex",
    displayMode: "single",
    state: "onTrack",
    tone: "safe",
    statusLabel: "充足",
    judgmentText: "剩余额度充足",
    usedPercent: 0,
    subscription: {
      planLabel: "Plus",
      validityText: "有效期 19天",
      expiresAtText: "2026-08-22 09:59",
      expiresAtIso: "2026-08-22T01:59:00.000Z",
    },
    resetCountdownText: "5d15h · 8/9 00:04",
    freshnessText: "刚刚更新",
    isStale: false,
    diagnosticCode: null,
    fetchedAtIso: "2026-08-03T02:00:00.000Z",
    resetsAtIso: "2026-08-09T00:04:00.000Z",
  };
}

describe("Codex subscription rendering", () => {
  it("shows Plus validity only in the expanded detail", () => {
    const root = {
      dataset: {},
      classList: { toggle: () => undefined },
      innerHTML: "",
    } as unknown as HTMLElement;

    renderCapsule(root, model(), true);
    expect(root.innerHTML).toContain("Plus");
    expect(root.innerHTML).toContain("有效期 19天");
    expect(root.innerHTML).toContain("2026-08-22 09:59");

    renderCapsule(root, model(), false);
    expect(root.innerHTML).not.toContain("有效期 19天");
  });

  it("reserves another row in the expanded window", () => {
    expect(capsuleHeights(model(), true).height).toBe(165);
  });
});
