import type {
  CapsuleState,
  CapsuleTone,
  CapsuleViewModel,
  DiagnosticCode,
  RunwayForecast,
} from "./model.js";

export type BuildViewModelInput = {
  forecast: RunwayForecast;
  fetchedAt: Date | null;
  resetsAt: Date | null;
  now?: Date;
  isStale?: boolean;
  diagnosticCode?: DiagnosticCode | null;
};

const STATUS: Record<CapsuleState, string> = {
  earlyEstimate: "初步判断",
  onTrack: "够用",
  runningFast: "偏快",
  mayRunOut: "可能不够",
  exhausted: "已用尽",
  dataUnavailable: "数据暂不可用",
};

const TONE: Record<CapsuleState, CapsuleTone> = {
  earlyEstimate: "unknown",
  onTrack: "safe",
  runningFast: "watch",
  mayRunOut: "danger",
  exhausted: "danger",
  dataUnavailable: "unknown",
};

export function buildCapsuleViewModel(input: BuildViewModelInput): CapsuleViewModel {
  const now = input.now ?? new Date();
  if (input.isStale) {
    return {
      state: "dataUnavailable",
      tone: "unknown",
      statusLabel: STATUS.dataUnavailable,
      judgmentText: "正在显示上次成功的周额度数据，恢复实时读取前暂不判断周速度。",
      usedPercent: input.forecast.usedPercent,
      resetCountdownText: formatCountdown(input.resetsAt, now),
      freshnessText: formatFreshness(input.fetchedAt, now, true),
      isStale: true,
      diagnosticCode: input.diagnosticCode ?? "stale",
      fetchedAtIso: input.fetchedAt?.toISOString() ?? null,
      resetsAtIso: input.resetsAt?.toISOString() ?? null,
    };
  }

  const state = input.forecast.state;
  return {
    state,
    tone: TONE[state],
    statusLabel: STATUS[state],
    judgmentText: judgmentFor(input.forecast),
    usedPercent: input.forecast.usedPercent,
    resetCountdownText: formatCountdown(input.resetsAt, now),
    freshnessText: formatFreshness(input.fetchedAt, now, false),
    isStale: false,
    diagnosticCode: state === "dataUnavailable" ? (input.diagnosticCode ?? null) : null,
    fetchedAtIso: input.fetchedAt?.toISOString() ?? null,
    resetsAtIso: input.resetsAt?.toISOString() ?? null,
  };
}

function judgmentFor(f: RunwayForecast): string {
  switch (f.state) {
    case "dataUnavailable":
      return "暂时没有可用的周额度数据";
    case "exhausted":
      return "本周额度已用尽，重置后会自动恢复";
    case "earlyEstimate":
      return f.confidenceReason === "no-consumption-observed"
        ? "尚未观察到消耗，先按本周剩余时间匀速使用"
        : "初步判断：按本周平均速度估算是否可持续";
    case "onTrack":
      return "按当前节奏，有望撑到本周重置";
    case "runningFast":
      return "仍可能撑到重置，但当前速度已经偏快";
    case "mayRunOut":
      return "按本周平均速度，本周额度可能在重置前用完";
  }
}

function formatCountdown(resetsAt: Date | null, now: Date): string {
  if (!resetsAt) return "重置时间未知";
  const hours = (resetsAt.getTime() - now.getTime()) / 3600_000;
  if (!Number.isFinite(hours) || hours <= 0) return "即将重置或已过期";
  if (hours < 24) return `还剩 ${Math.max(1, Math.round(hours))} 小时`;
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours - days * 24);
  return rem > 0 ? `还剩 ${days} 天 ${rem} 小时` : `还剩 ${days} 天`;
}

function formatFreshness(fetchedAt: Date | null, now: Date, stale: boolean): string {
  if (!fetchedAt) return "尚未成功读取";
  const mins = Math.max(0, Math.round((now.getTime() - fetchedAt.getTime()) / 60_000));
  if (stale) return mins <= 1 ? "上次成功：刚刚" : `上次成功：${mins} 分钟前`;
  if (mins <= 1) return "刚刚更新";
  if (mins < 60) return `${mins} 分钟前更新`;
  return `${Math.round(mins / 60)} 小时前更新`;
}
