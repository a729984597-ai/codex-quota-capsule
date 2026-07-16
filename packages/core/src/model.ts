export type SourceStatus = "ok" | "stale" | "error";

export type DiagnosticCode =
  | "cli_missing"
  | "node_missing"
  | "auth_required"
  | "timeout"
  | "parse_error"
  | "stale"
  | "no_weekly_window";

export type QuotaWindow = {
  label: string;
  windowMinutes: number;
  usedPercent: number;
  remainingPercent: number;
  resetsAt: Date;
};

export type AgentQuotaSnapshot = {
  provider: string;
  sourceStatus: SourceStatus;
  fetchedAt: Date;
  weeklyWindow?: QuotaWindow;
  errorMessage?: string;
  diagnosticCode?: DiagnosticCode;
};

/** Product-facing six states (MVP). */
export type CapsuleState =
  | "earlyEstimate"
  | "onTrack"
  | "runningFast"
  | "mayRunOut"
  | "exhausted"
  | "dataUnavailable";

export type CapsuleTone = "safe" | "watch" | "danger" | "unknown";

export type RunwayForecast = {
  state: CapsuleState;
  usedPercent: number | null;
  remainingPercent: number | null;
  elapsedPercent: number | null;
  hoursUntilReset: number | null;
  projectedRemainingAtReset: number | null;
  sustainableRatePerHour: number | null;
  cycleRatePerHour: number | null;
  confidenceReason: string;
};

export type CapsuleViewModel = {
  state: CapsuleState;
  tone: CapsuleTone;
  statusLabel: string;
  judgmentText: string;
  usedPercent: number | null;
  resetCountdownText: string;
  freshnessText: string;
  isStale: boolean;
  diagnosticCode: DiagnosticCode | null;
  fetchedAtIso: string | null;
  resetsAtIso: string | null;
};
