import type {
  DiagnosticCode,
  ProviderId,
  ProviderSlice,
  UsageBreakdown,
} from "./model.js";

export const STALE_MAX_AGE_MS = 30 * 60_000;
const FUTURE_TOLERANCE_MS = 60_000;

export function restoreCachedProviderSlice(input: {
  cached: unknown;
  provider: ProviderId;
  now: Date;
  diagnosticCode?: DiagnosticCode | null;
}): ProviderSlice | null {
  const root = readObject(input.cached);
  const vm = readObject(root.viewModel ?? input.cached);
  const candidates = Array.isArray(vm.providers) ? vm.providers : [vm];
  const raw = candidates
    .map(readObject)
    .find((candidate) => candidate.provider === input.provider);
  if (!raw) return null;

  const usedPercent = readPercent(raw.usedPercent);
  const fetchedAtIso =
    typeof raw.fetchedAtIso === "string" ? raw.fetchedAtIso : null;
  const fetchedAtMs = fetchedAtIso ? Date.parse(fetchedAtIso) : Number.NaN;
  const nowMs = input.now.getTime();
  const ageMs = nowMs - fetchedAtMs;
  if (
    usedPercent === null ||
    !Number.isFinite(fetchedAtMs) ||
    !Number.isFinite(nowMs) ||
    ageMs < -FUTURE_TOLERANCE_MS ||
    ageMs > STALE_MAX_AGE_MS
  ) {
    return null;
  }

  return {
    provider: input.provider,
    state: "dataUnavailable",
    tone: "unknown",
    statusLabel: "数据暂不可用",
    judgmentText:
      "正在显示上次成功的额度数据，恢复实时读取前暂不判断消耗速度。",
    usedPercent,
    usageBreakdown: readBreakdown(raw.usageBreakdown),
    resetCountdownText: readText(raw.resetCountdownText, "重置未知"),
    freshnessText: formatStaleFreshness(ageMs),
    isStale: true,
    diagnosticCode: input.diagnosticCode ?? "stale",
    fetchedAtIso,
    resetsAtIso:
      typeof raw.resetsAtIso === "string" ? raw.resetsAtIso : null,
  };
}

export function selectProviderSlice(input: {
  current: ProviderSlice;
  live: boolean;
  cached: unknown;
  now: Date;
  diagnosticCode?: DiagnosticCode | null;
}): { live: boolean; slice: ProviderSlice } {
  if (input.live) {
    return { live: true, slice: input.current };
  }
  const stale = restoreCachedProviderSlice({
    cached: input.cached,
    provider: input.current.provider,
    now: input.now,
    diagnosticCode: input.diagnosticCode,
  });
  return { live: false, slice: stale ?? input.current };
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readPercent(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}

function readBreakdown(value: unknown): UsageBreakdown | null {
  const raw = readObject(value);
  const keys = ["autoPercent", "apiPercent", "totalPercent"] as const;
  if (!keys.some((key) => Object.hasOwn(raw, key))) return null;
  const values = keys.map((key) =>
    raw[key] === null ? null : readPercent(raw[key]),
  );
  const invalid = keys.some(
    (key, index) => raw[key] !== null && values[index] === null,
  );
  if (invalid) return null;
  return {
    autoPercent: values[0],
    apiPercent: values[1],
    totalPercent: values[2],
  };
}

function readText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function formatStaleFreshness(ageMs: number): string {
  const mins = Math.max(0, Math.round(ageMs / 60_000));
  return mins <= 1 ? "上次成功：刚刚" : `上次成功：${mins} 分钟前`;
}
