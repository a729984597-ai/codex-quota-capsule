import type {
  CapsuleState,
  CapsuleTone,
  CapsuleViewModel,
  DiagnosticCode,
  DisplayMode,
  ProviderId,
  ProviderSlice,
  RunwayForecast,
  UsageBreakdown,
} from "./model.js";

export type BuildViewModelInput = {
  forecast: RunwayForecast;
  fetchedAt: Date | null;
  resetsAt: Date | null;
  now?: Date;
  isStale?: boolean;
  diagnosticCode?: DiagnosticCode | null;
  provider?: ProviderId;
  displayMode?: DisplayMode;
  providers?: ProviderSlice[];
  usageBreakdown?: UsageBreakdown | null;
};

const STATUS: Record<CapsuleState, string> = {
  earlyEstimate: "充足",
  onTrack: "充足",
  runningFast: "偏低",
  mayRunOut: "紧张",
  exhausted: "已用尽",
  dataUnavailable: "数据暂不可用",
};

const TONE: Record<CapsuleState, CapsuleTone> = {
  earlyEstimate: "safe",
  onTrack: "safe",
  runningFast: "watch",
  mayRunOut: "danger",
  exhausted: "danger",
  dataUnavailable: "unknown",
};

export function buildCapsuleViewModel(input: BuildViewModelInput): CapsuleViewModel {
  const now = input.now ?? new Date();
  const provider = input.provider ?? "codex";
  const displayMode = input.displayMode ?? "single";

  if (input.isStale) {
    return {
      provider: displayMode === "both" ? "both" : provider,
      displayMode,
      state: "dataUnavailable",
      tone: "unknown",
      statusLabel: STATUS.dataUnavailable,
      judgmentText: "正在显示上次成功的额度数据，恢复实时读取前暂不判断消耗速度。",
      usedPercent: input.forecast.usedPercent,
      usageBreakdown: input.usageBreakdown ?? null,
      resetCountdownText: formatCountdown(input.resetsAt, now),
      freshnessText: formatFreshness(input.fetchedAt, now, true),
      isStale: true,
      diagnosticCode: input.diagnosticCode ?? "stale",
      fetchedAtIso: input.fetchedAt?.toISOString() ?? null,
      resetsAtIso: input.resetsAt?.toISOString() ?? null,
      providers: input.providers,
    };
  }

  const state = input.forecast.state;
  return {
    provider: displayMode === "both" ? "both" : provider,
    displayMode,
    state,
    tone: TONE[state],
    statusLabel: STATUS[state],
    judgmentText: judgmentFor(input.forecast, input.usageBreakdown),
    usedPercent: input.forecast.usedPercent,
    usageBreakdown: input.usageBreakdown ?? null,
    resetCountdownText: formatCountdown(input.resetsAt, now),
    freshnessText: formatFreshness(input.fetchedAt, now, false),
    isStale: false,
    diagnosticCode: state === "dataUnavailable" ? (input.diagnosticCode ?? null) : null,
    fetchedAtIso: input.fetchedAt?.toISOString() ?? null,
    resetsAtIso: input.resetsAt?.toISOString() ?? null,
    providers: input.providers,
  };
}

/** Build a single-provider slice from a forecast (for dual mode). */
export function buildProviderSlice(input: {
  provider: ProviderId;
  forecast: RunwayForecast;
  fetchedAt: Date | null;
  resetsAt: Date | null;
  now?: Date;
  isStale?: boolean;
  diagnosticCode?: DiagnosticCode | null;
  usageBreakdown?: UsageBreakdown | null;
}): ProviderSlice {
  const vm = buildCapsuleViewModel({
    ...input,
    provider: input.provider,
    displayMode: "single",
  });
  return {
    provider: input.provider,
    state: vm.state,
    tone: vm.tone,
    statusLabel: vm.statusLabel,
    judgmentText: vm.judgmentText,
    usedPercent: vm.usedPercent,
    usageBreakdown: vm.usageBreakdown ?? null,
    resetCountdownText: vm.resetCountdownText,
    freshnessText: vm.freshnessText,
    isStale: vm.isStale,
    diagnosticCode: vm.diagnosticCode,
    fetchedAtIso: vm.fetchedAtIso,
    resetsAtIso: vm.resetsAtIso,
  };
}

export function mergeDualViewModel(
  cursor: ProviderSlice,
  codex: ProviderSlice,
): CapsuleViewModel {
  const worse = pickWorse(cursor, codex);
  return {
    provider: "both",
    displayMode: "both",
    state: worse.state,
    tone: worse.tone,
    statusLabel: "双源监控",
    judgmentText: `Cursor ${formatSliceLine(cursor)}；Codex ${formatSliceLine(codex)}`,
    usedPercent: worse.usedPercent,
    resetCountdownText: worse.resetCountdownText,
    freshnessText: pickFreshest(cursor, codex),
    isStale: cursor.isStale && codex.isStale,
    diagnosticCode: null,
    fetchedAtIso: worse.fetchedAtIso,
    resetsAtIso: worse.resetsAtIso,
    providers: [cursor, codex],
  };
}

function formatSliceLine(slice: ProviderSlice): string {
  const used =
    slice.usedPercent === null ? "—" : `${Math.round(slice.usedPercent)}%`;
  return `${slice.statusLabel} ${used}`;
}

function pickWorse(a: ProviderSlice, b: ProviderSlice): ProviderSlice {
  const rank: Record<string, number> = {
    exhausted: 5,
    mayRunOut: 4,
    runningFast: 3,
    earlyEstimate: 2,
    onTrack: 1,
    dataUnavailable: 0,
  };
  return (rank[a.state] ?? 0) >= (rank[b.state] ?? 0) ? a : b;
}

function pickFreshest(a: ProviderSlice, b: ProviderSlice): string {
  if (a.freshnessText === "刚刚更新" || b.freshnessText === "刚刚更新") {
    return "刚刚更新";
  }
  return a.freshnessText;
}

function judgmentFor(
  f: RunwayForecast,
  breakdown?: UsageBreakdown | null,
): string {
  const split =
    breakdown &&
    (breakdown.autoPercent !== null || breakdown.apiPercent !== null)
      ? `（Auto ${fmtPct(breakdown.autoPercent)} · API ${fmtPct(breakdown.apiPercent)}）`
      : "";
  switch (f.state) {
    case "dataUnavailable":
      return "暂时没有可用的额度周期数据";
    case "exhausted":
      return `本周期额度已用尽，重置后会自动恢复${split}`;
    case "earlyEstimate":
    case "onTrack":
      return `剩余额度充足${split}`;
    case "runningFast":
      return `剩余额度不足 30%，注意用量${split}`;
    case "mayRunOut":
      return `剩余额度不足 10%，即将用尽${split}`;
  }
}

function fmtPct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function formatCountdown(resetsAt: Date | null, now: Date): string {
  if (!resetsAt) return "重置未知";
  const hours = (resetsAt.getTime() - now.getTime()) / 3600_000;
  if (!Number.isFinite(hours) || hours <= 0) return "即将重置";
  const at = formatResetMoment(resetsAt);
  if (hours < 24) return `${Math.max(1, Math.round(hours))}h · ${at}`;
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours - days * 24);
  const left = rem > 0 ? `${days}d${rem}h` : `${days}d`;
  return `${left} · ${at}`;
}

function formatResetMoment(resetsAt: Date): string {
  const mm = resetsAt.getMonth() + 1;
  const dd = resetsAt.getDate();
  const hh = String(resetsAt.getHours()).padStart(2, "0");
  const mi = String(resetsAt.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

function formatFreshness(fetchedAt: Date | null, now: Date, stale: boolean): string {
  if (!fetchedAt) return "尚未成功读取";
  const mins = Math.max(0, Math.round((now.getTime() - fetchedAt.getTime()) / 60_000));
  if (stale) return mins <= 1 ? "上次成功：刚刚" : `上次成功：${mins} 分钟前`;
  if (mins <= 1) return "刚刚更新";
  if (mins < 60) return `${mins} 分钟前更新`;
  return `${Math.round(mins / 60)} 小时前更新`;
}
