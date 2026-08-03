export type SourceStatus = "ok" | "stale" | "error";

export type ProviderId = "codex" | "cursor";

export type DisplayMode = "single" | "both";

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

/** Cursor-style split pools (Auto+Composer vs API). */
export type UsageBreakdown = {
  autoPercent: number | null;
  apiPercent: number | null;
  totalPercent: number | null;
};

/** Non-secret subscription metadata derived from the local Codex ID token. */
export type SubscriptionInfo = {
  planType: string;
  activeUntil: Date;
};

export type SubscriptionValidity = {
  planLabel: string;
  validityText: string;
  expiresAtText: string;
  expiresAtIso: string;
};

export type AgentQuotaSnapshot = {
  provider: string;
  sourceStatus: SourceStatus;
  fetchedAt: Date;
  weeklyWindow?: QuotaWindow;
  usageBreakdown?: UsageBreakdown;
  subscription?: SubscriptionInfo;
  errorMessage?: string;
  diagnosticCode?: DiagnosticCode;
};

/** Product-facing static quota states. */
export type CapsuleState =
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

export type ProviderSlice = {
  provider: ProviderId;
  state: CapsuleState;
  tone: CapsuleTone;
  statusLabel: string;
  judgmentText: string;
  usedPercent: number | null;
  usageBreakdown?: UsageBreakdown | null;
  subscription?: SubscriptionValidity | null;
  resetCountdownText: string;
  freshnessText: string;
  isStale: boolean;
  diagnosticCode: DiagnosticCode | null;
  fetchedAtIso: string | null;
  resetsAtIso: string | null;
};

export type CapsuleViewModel = {
  /** Active display provider; "both" when dual mode. */
  provider: ProviderId | "both";
  displayMode: DisplayMode;
  state: CapsuleState;
  tone: CapsuleTone;
  statusLabel: string;
  judgmentText: string;
  usedPercent: number | null;
  /** Cursor: Auto+Composer / API split; absent for Codex. */
  usageBreakdown?: UsageBreakdown | null;
  /** Codex Plus subscription validity; absent when unavailable. */
  subscription?: SubscriptionValidity | null;
  resetCountdownText: string;
  freshnessText: string;
  isStale: boolean;
  diagnosticCode: DiagnosticCode | null;
  fetchedAtIso: string | null;
  resetsAtIso: string | null;
  /** Present when displayMode === "both" (Cursor then Codex). */
  providers?: ProviderSlice[];
};
