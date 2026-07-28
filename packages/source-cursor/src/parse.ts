import type {
  AgentQuotaSnapshot,
  DiagnosticCode,
  QuotaWindow,
  UsageBreakdown,
} from "@quota-capsule/core";

export type CursorUsageParseOptions = {
  fetchedAt: Date;
};

/**
 * Map DashboardService GetCurrentPeriodUsage JSON into AgentQuotaSnapshot.
 * Keeps Auto+Composer / API / Total split; quota state uses the hotter pool.
 */
export function parseCursorPeriodUsage(
  raw: unknown,
  options: CursorUsageParseOptions,
): AgentQuotaSnapshot {
  const root = readObject(raw);
  const plan = readObject(root.planUsage);

  const breakdown = readBreakdown(plan);
  const usedPercent = pickRunwayPercent(breakdown, plan);
  const cycleStart = readTimestamp(root.billingCycleStart);
  const cycleEnd = readTimestamp(root.billingCycleEnd);

  if (usedPercent === null || !cycleEnd) {
    return {
      provider: "cursor",
      sourceStatus: "error",
      fetchedAt: options.fetchedAt,
      diagnosticCode: "parse_error" satisfies DiagnosticCode,
      errorMessage:
        "cursor GetCurrentPeriodUsage missing usable percent or billingCycleEnd",
    };
  }

  if (cycleEnd.getTime() <= options.fetchedAt.getTime()) {
    return {
      provider: "cursor",
      sourceStatus: "error",
      fetchedAt: options.fetchedAt,
      diagnosticCode: "no_weekly_window" satisfies DiagnosticCode,
      errorMessage: "cursor billing cycle end is not in the future",
    };
  }

  const startMs = cycleStart?.getTime() ?? options.fetchedAt.getTime();
  const windowMinutes = Math.max(
    1,
    Math.round((cycleEnd.getTime() - startMs) / 60_000),
  );

  const weeklyWindow: QuotaWindow = {
    label: "billing-cycle",
    windowMinutes,
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    resetsAt: cycleEnd,
  };

  return {
    provider: "cursor",
    sourceStatus: "ok",
    fetchedAt: options.fetchedAt,
    weeklyWindow,
    usageBreakdown: breakdown,
  };
}

function readBreakdown(plan: Record<string, unknown>): UsageBreakdown {
  return {
    autoPercent: clampNullable(readNumber(plan.autoPercentUsed)),
    apiPercent: clampNullable(readNumber(plan.apiPercentUsed)),
    totalPercent: clampNullable(readNumber(plan.totalPercentUsed)),
  };
}

/** Prefer the hotter of Auto vs API pools; else total / derived. */
function pickRunwayPercent(
  breakdown: UsageBreakdown,
  plan: Record<string, unknown>,
): number | null {
  const candidates = [breakdown.autoPercent, breakdown.apiPercent].filter(
    (n): n is number => n !== null,
  );
  if (candidates.length > 0) {
    return Math.max(...candidates);
  }
  if (breakdown.totalPercent !== null) return breakdown.totalPercent;
  const limit = readNumber(plan.limit);
  const remaining = readNumber(plan.remaining);
  if (limit !== null && limit > 0 && remaining !== null) {
    return clampPercent(((limit - remaining) / limit) * 100);
  }
  return null;
}

function readTimestamp(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string" && value.trim()) {
    if (/^\d+$/.test(value.trim())) {
      return readTimestamp(Number(value.trim()));
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
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

function clampNullable(value: number | null): number | null {
  return value === null ? null : clampPercent(value);
}
