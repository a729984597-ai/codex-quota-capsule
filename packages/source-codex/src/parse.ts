import type {
  AgentQuotaSnapshot,
  DiagnosticCode,
  QuotaWindow,
} from "@quota-capsule/core";

export type CodexRateLimitParseOptions = {
  fetchedAt: Date;
};

/** Codex Plus weekly window (~7 days). */
const WEEKLY_MINUTES = 10_080;
const WEEKLY_TOLERANCE_MINUTES = 60;

/** Accept day / week / month style cycle windows (1 day … 45 days). */
const MIN_CYCLE_MINUTES = 1_440;
const MAX_CYCLE_MINUTES = 45 * 24 * 60;

export function parseCodexRateLimits(
  result: unknown,
  options: CodexRateLimitParseOptions,
): AgentQuotaSnapshot {
  const rateLimits = readObject(readObject(result).rateLimits);
  const windows = ["primary", "secondary"]
    .map((key) => parseRateLimitWindow(rateLimits[key]))
    .filter((window): window is QuotaWindow => Boolean(window));

  const weeklyWindow = pickCycleWindow(windows, options.fetchedAt);

  if (!weeklyWindow) {
    return {
      provider: "codex",
      sourceStatus: "error",
      fetchedAt: options.fetchedAt,
      diagnosticCode: "no_weekly_window" satisfies DiagnosticCode,
      errorMessage:
        "codex app-server rateLimits did not include any usable weekly/monthly windows.",
    };
  }

  return {
    provider: "codex",
    sourceStatus: "ok",
    fetchedAt: options.fetchedAt,
    weeklyWindow,
  };
}

/**
 * Prefer a ~weekly window; otherwise accept a longer free-tier cycle
 * (e.g. 30-day / 43200 min) when Plus weekly is absent.
 */
function pickCycleWindow(
  windows: QuotaWindow[],
  fetchedAt: Date,
): QuotaWindow | undefined {
  const weeklyCandidate = windows.find(
    (window) =>
      Math.abs(window.windowMinutes - WEEKLY_MINUTES) <= WEEKLY_TOLERANCE_MINUTES &&
      isUsableReset(window, fetchedAt, 8 * 24 * 60),
  );
  if (weeklyCandidate) {
    return { ...weeklyCandidate, label: "weekly" };
  }

  const cycleCandidates = windows
    .filter(
      (window) =>
        window.windowMinutes >= MIN_CYCLE_MINUTES &&
        window.windowMinutes <= MAX_CYCLE_MINUTES &&
        isUsableReset(window, fetchedAt, window.windowMinutes + 1_440),
    )
    .sort((a, b) => b.windowMinutes - a.windowMinutes);

  const best = cycleCandidates[0];
  if (!best) return undefined;

  const label =
    Math.abs(best.windowMinutes - 43_200) <= 720
      ? "monthly"
      : Math.abs(best.windowMinutes - WEEKLY_MINUTES) <= WEEKLY_TOLERANCE_MINUTES
        ? "weekly"
        : "cycle";

  return { ...best, label };
}

function isUsableReset(
  window: QuotaWindow,
  fetchedAt: Date,
  maxRemainingMinutes: number,
): boolean {
  const remainingMs = window.resetsAt.getTime() - fetchedAt.getTime();
  return (
    remainingMs > 0 && remainingMs <= maxRemainingMinutes * 60_000
  );
}

function parseRateLimitWindow(value: unknown): QuotaWindow | null {
  const window = readObject(value);
  const usedPercent = readNumber(window.usedPercent);
  const windowMinutes = readNumber(window.windowDurationMins);
  const resetsAtSeconds = readNumber(window.resetsAt);

  if (
    usedPercent === null ||
    windowMinutes === null ||
    resetsAtSeconds === null
  ) {
    return null;
  }

  if (
    !Number.isFinite(usedPercent) ||
    usedPercent < 0 ||
    usedPercent > 100 ||
    !Number.isFinite(windowMinutes) ||
    !Number.isInteger(windowMinutes) ||
    windowMinutes < 1 ||
    windowMinutes > 525_600 ||
    !Number.isFinite(resetsAtSeconds) ||
    resetsAtSeconds < 946_684_800 ||
    resetsAtSeconds > 4_102_444_800
  ) {
    return null;
  }

  return {
    label: "candidate",
    windowMinutes,
    usedPercent: clampPercent(usedPercent),
    remainingPercent: clampPercent(100 - usedPercent),
    resetsAt: new Date(resetsAtSeconds * 1000),
  };
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
