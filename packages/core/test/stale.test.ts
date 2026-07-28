import { describe, expect, it } from "vitest";
import { mergeDualViewModel } from "../src/display.ts";
import {
  restoreCachedProviderSlice,
  selectProviderSlice,
} from "../src/stale.ts";
import type { ProviderId, ProviderSlice } from "../src/model.ts";

const NOW = new Date("2026-07-28T06:00:00.000Z");

function cachedSlice(
  provider: "cursor" | "codex",
  fetchedAtIso: string,
  usedPercent = provider === "cursor" ? 40 : 25,
): ProviderSlice {
  return {
    provider,
    state: "onTrack",
    tone: "safe",
    statusLabel: "充足",
    judgmentText: "剩余额度充足",
    usedPercent,
    usageBreakdown:
      provider === "cursor"
        ? { autoPercent: 40, apiPercent: 35, totalPercent: 30 }
        : null,
    resetCountdownText: "2d",
    freshnessText: "刚刚更新",
    isStale: false,
    diagnosticCode: null,
    fetchedAtIso,
    resetsAtIso: "2026-07-30T06:00:00.000Z",
  };
}

function unavailableSlice(provider: ProviderId): ProviderSlice {
  return {
    ...cachedSlice(provider, NOW.toISOString()),
    state: "dataUnavailable",
    tone: "unknown",
    statusLabel: "数据暂不可用",
    judgmentText: "读取失败",
    usedPercent: null,
    usageBreakdown: null,
    isStale: false,
    diagnosticCode: "timeout",
  };
}

describe("restoreCachedProviderSlice", () => {
  it("restores only the requested provider and preserves its quota fields", () => {
    const cached = {
      viewModel: {
        provider: "both",
        providers: [
          cachedSlice("cursor", "2026-07-28T05:40:00.000Z"),
          cachedSlice("codex", "2026-07-28T05:45:00.000Z"),
        ],
      },
    };

    const result = restoreCachedProviderSlice({
      cached,
      provider: "codex",
      now: NOW,
      diagnosticCode: "timeout",
    });

    expect(result).toMatchObject({
      provider: "codex",
      usedPercent: 25,
      state: "dataUnavailable",
      tone: "unknown",
      statusLabel: "数据暂不可用",
      isStale: true,
      diagnosticCode: "timeout",
      fetchedAtIso: "2026-07-28T05:45:00.000Z",
      resetsAtIso: "2026-07-30T06:00:00.000Z",
    });
  });

  it("preserves a valid Cursor usage breakdown", () => {
    const result = restoreCachedProviderSlice({
      cached: {
        viewModel: cachedSlice("cursor", "2026-07-28T05:45:00.000Z"),
      },
      provider: "cursor",
      now: NOW,
    });

    expect(result?.usageBreakdown).toEqual({
      autoPercent: 40,
      apiPercent: 35,
      totalPercent: 30,
    });
  });

  it("rejects another provider's single-source cache", () => {
    const result = restoreCachedProviderSlice({
      cached: {
        viewModel: cachedSlice("cursor", "2026-07-28T05:45:00.000Z"),
      },
      provider: "codex",
      now: NOW,
    });

    expect(result).toBeNull();
  });

  it("accepts a slice exactly 30 minutes old", () => {
    const result = restoreCachedProviderSlice({
      cached: {
        viewModel: cachedSlice("codex", "2026-07-28T05:30:00.000Z"),
      },
      provider: "codex",
      now: NOW,
    });

    expect(result?.freshnessText).toBe("上次成功：30 分钟前");
  });

  it("rejects a slice older than 30 minutes", () => {
    const result = restoreCachedProviderSlice({
      cached: {
        viewModel: cachedSlice("codex", "2026-07-28T05:29:59.000Z"),
      },
      provider: "codex",
      now: NOW,
    });

    expect(result).toBeNull();
  });

  it("rejects malformed percentages", () => {
    const result = restoreCachedProviderSlice({
      cached: {
        viewModel: cachedSlice(
          "codex",
          "2026-07-28T05:45:00.000Z",
          101,
        ),
      },
      provider: "codex",
      now: NOW,
    });

    expect(result).toBeNull();
  });

  it("rejects an invalid fetch timestamp", () => {
    const result = restoreCachedProviderSlice({
      cached: {
        viewModel: cachedSlice("codex", "not-a-date"),
      },
      provider: "codex",
      now: NOW,
    });

    expect(result).toBeNull();
  });

  it("rejects a timestamp more than 60 seconds in the future", () => {
    const result = restoreCachedProviderSlice({
      cached: {
        viewModel: cachedSlice("codex", "2026-07-28T06:01:01.000Z"),
      },
      provider: "codex",
      now: NOW,
    });

    expect(result).toBeNull();
  });
});

describe("selectProviderSlice", () => {
  const dualCache = {
    viewModel: {
      provider: "both",
      providers: [
        cachedSlice("cursor", "2026-07-28T05:40:00.000Z"),
        cachedSlice("codex", "2026-07-28T05:45:00.000Z"),
      ],
    },
  };

  it("keeps Cursor live while restoring cached Codex", () => {
    const cursorLive = cachedSlice("cursor", NOW.toISOString());
    const cursor = selectProviderSlice({
      current: cursorLive,
      live: true,
      cached: dualCache,
      now: NOW,
    });
    const codex = selectProviderSlice({
      current: unavailableSlice("codex"),
      live: false,
      cached: dualCache,
      now: NOW,
      diagnosticCode: "timeout",
    });

    expect(cursor).toEqual({ live: true, slice: cursorLive });
    expect(codex.live).toBe(false);
    expect(codex.slice).toMatchObject({
      provider: "codex",
      usedPercent: 25,
      isStale: true,
      diagnosticCode: "timeout",
    });

    const merged = mergeDualViewModel(cursor.slice, codex.slice);
    expect(merged.providers).toEqual([cursor.slice, codex.slice]);
    expect(merged.isStale).toBe(false);
  });

  it("keeps Codex live while restoring cached Cursor", () => {
    const cursor = selectProviderSlice({
      current: unavailableSlice("cursor"),
      live: false,
      cached: dualCache,
      now: NOW,
      diagnosticCode: "auth_required",
    });
    const codexLive = cachedSlice("codex", NOW.toISOString());
    const codex = selectProviderSlice({
      current: codexLive,
      live: true,
      cached: dualCache,
      now: NOW,
    });

    expect(cursor.slice).toMatchObject({
      provider: "cursor",
      usedPercent: 40,
      isStale: true,
      diagnosticCode: "auth_required",
    });
    expect(codex).toEqual({ live: true, slice: codexLive });
  });

  it("restores both provider slices when both live reads fail", () => {
    const cursor = selectProviderSlice({
      current: unavailableSlice("cursor"),
      live: false,
      cached: dualCache,
      now: NOW,
    });
    const codex = selectProviderSlice({
      current: unavailableSlice("codex"),
      live: false,
      cached: dualCache,
      now: NOW,
    });

    expect(cursor.slice.isStale).toBe(true);
    expect(codex.slice.isStale).toBe(true);
    expect(mergeDualViewModel(cursor.slice, codex.slice).isStale).toBe(true);
  });

  it("keeps the unavailable slice when no usable cache exists", () => {
    const current = unavailableSlice("codex");
    const selected = selectProviderSlice({
      current,
      live: false,
      cached: null,
      now: NOW,
    });

    expect(selected).toEqual({ live: false, slice: current });
  });
});
