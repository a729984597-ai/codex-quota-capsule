import type {
  AgentQuotaSnapshot,
  DiagnosticCode,
  QuotaWindow,
} from "@quota-capsule/core";

export type CodexRateLimitParseOptions = {
  fetchedAt: Date;
};

export function parseCodexRateLimits(
  result: unknown,
  options: CodexRateLimitParseOptions,
): AgentQuotaSnapshot {
  const rateLimits = readObject(readObject(result).rateLimits);
  const windows = ["primary", "secondary"]
    .map((key) => parseRateLimitWindow(rateLimits[key]))
    .filter((window): window is QuotaWindow => Boolean(window));

  const weeklyCandidate = windows.find(
    (window) =>
      Math.abs(window.windowMinutes - 10_080) <= 60 &&
      window.resetsAt.getTime() > options.fetchedAt.getTime() &&
      window.resetsAt.getTime() - options.fetchedAt.getTime() <=
        8 * 24 * 60 * 60_000,
  );
  const weeklyWindow = weeklyCandidate
    ? { ...weeklyCandidate, label: "weekly" }
    : undefined;

  if (!weeklyWindow) {
    return {
      provider: "codex",
      sourceStatus: "error",
      fetchedAt: options.fetchedAt,
      diagnosticCode: "no_weekly_window" satisfies DiagnosticCode,
      errorMessage:
        "codex app-server rateLimits did not include any usable weekly windows.",
    };
  }

  return {
    provider: "codex",
    sourceStatus: "ok",
    fetchedAt: options.fetchedAt,
    weeklyWindow,
  };
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
