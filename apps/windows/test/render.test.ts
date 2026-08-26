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

describe("Codex quota-window rendering", () => {
  it("shows five-hour and weekly remaining quota in collapsed and expanded views", () => {
    const root = {
      dataset: {},
      classList: { toggle: () => undefined },
      innerHTML: "",
    } as unknown as HTMLElement;
    const vm = model();
    vm.quotaWindows = [
      {
        label: "5小时",
        usedPercent: 20,
        remainingPercent: 80,
        resetCountdownText: "3h · 7/16 11:00",
        resetsAtIso: "2026-07-16T03:00:00.000Z",
      },
      {
        label: "每周",
        usedPercent: 35,
        remainingPercent: 65,
        resetCountdownText: "3d · 7/19 08:00",
        resetsAtIso: "2026-07-19T00:00:00.000Z",
      },
    ];

    renderCapsule(root, vm, false);
    expect(root.innerHTML).toContain("5小时");
    expect(root.innerHTML).toContain("80%");
    expect(root.innerHTML).toContain("每周");
    expect(root.innerHTML).toContain("65%");

    renderCapsule(root, vm, false, false, "minimal");
    expect(root.innerHTML).not.toContain("5小时");
    expect(root.innerHTML).not.toContain("每周");
    expect(root.innerHTML).toContain("80%");
    expect(root.innerHTML).toContain("65%");
    expect(root.innerHTML).toContain("/</span>");
    expect(root.innerHTML).not.toContain('class="dot"');
    expect(capsuleHeights(vm, false, "minimal").width).toBe(140);

    renderCapsule(root, vm, true);
    expect(root.innerHTML).toContain("3h · 7/16 11:00");
    expect(root.innerHTML).toContain("3d · 7/19 08:00");
    expect(capsuleHeights(vm, false).width).toBe(380);
    expect(capsuleHeights(vm, true).height).toBe(205);
  });
});

describe("logo minimal rendering", () => {
  it("replaces provider names with compact accessible logos", () => {
    const root = {
      dataset: {},
      classList: { toggle: () => undefined },
      innerHTML: "",
    } as unknown as HTMLElement;
    const codex = model();

    renderCapsule(root, codex, false, false, "minimal-logo");
    expect(root.innerHTML).toContain('class="provider-logo provider-logo-codex"');
    expect(root.innerHTML).toContain('aria-label="Codex"');
    expect(root.innerHTML).not.toContain('<span class="tag">Codex</span>');
    expect(root.innerHTML).not.toContain("<svg");
    expect(root.innerHTML).not.toContain('class="dot"');

    const cursor: CapsuleViewModel = {
      ...codex,
      provider: "cursor",
      quotaWindows: null,
      usageBreakdown: {
        autoPercent: 18,
        apiPercent: 67,
        totalPercent: 42,
      },
    };
    renderCapsule(root, cursor, false, false, "minimal-logo");
    expect(root.innerHTML).toContain('class="provider-logo provider-logo-cursor"');
    expect(root.innerHTML).toContain('aria-label="Cursor"');
    expect(root.innerHTML).not.toContain('<span class="tag">Cursor</span>');
  });
});
