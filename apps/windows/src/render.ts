export type CapsuleTone = "safe" | "watch" | "danger" | "unknown";

export type UsageBreakdown = {
  autoPercent: number | null;
  apiPercent: number | null;
  totalPercent: number | null;
};

export type SubscriptionValidity = {
  planLabel: string;
  validityText: string;
  expiresAtText: string;
  expiresAtIso: string;
};

export type QuotaWindowDisplay = {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetCountdownText: string;
  resetsAtIso: string;
};

export type ProviderSlice = {
  provider: "codex" | "cursor";
  state: string;
  tone: CapsuleTone;
  statusLabel: string;
  judgmentText: string;
  usedPercent: number | null;
  quotaWindows?: QuotaWindowDisplay[] | null;
  usageBreakdown?: UsageBreakdown | null;
  subscription?: SubscriptionValidity | null;
  resetCountdownText: string;
  freshnessText: string;
  isStale: boolean;
  diagnosticCode: string | null;
  fetchedAtIso: string | null;
  resetsAtIso: string | null;
};

export type CapsuleViewModel = {
  provider: "codex" | "cursor" | "both";
  displayMode: "single" | "both";
  state: string;
  tone: CapsuleTone;
  statusLabel: string;
  judgmentText: string;
  usedPercent: number | null;
  quotaWindows?: QuotaWindowDisplay[] | null;
  usageBreakdown?: UsageBreakdown | null;
  subscription?: SubscriptionValidity | null;
  resetCountdownText: string;
  freshnessText: string;
  isStale: boolean;
  diagnosticCode: string | null;
  fetchedAtIso: string | null;
  resetsAtIso: string | null;
  providers?: ProviderSlice[];
};

const PLACEHOLDER: CapsuleViewModel = {
  provider: "codex",
  displayMode: "single",
  state: "dataUnavailable",
  tone: "unknown",
  statusLabel: "数据暂不可用",
  judgmentText: "等待首次刷新…",
  usedPercent: null,
  usageBreakdown: null,
  subscription: null,
  resetCountdownText: "重置时间未知",
  freshnessText: "尚未成功读取",
  isStale: false,
  diagnosticCode: null,
  fetchedAtIso: null,
  resetsAtIso: null,
};

function providerLabel(provider: string): string {
  if (provider === "cursor") return "Cursor";
  if (provider === "both") return "双源";
  return "Codex";
}

function fmtPct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value)}%`;
}

/** Codex UI matches official app: show remaining %, not used %. */
function toRemaining(used: number | null | undefined): number | null {
  if (used === null || used === undefined) return null;
  const n = Number(used);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, 100 - n));
}

function isCodexProvider(provider: string): boolean {
  return provider === "codex";
}

/** Tone class for a single pool, by its own remaining quota. */
function pctClass(used: number | null | undefined): string {
  const tone = remainingTone(used);
  return tone ? `pct pct-${tone}` : "pct";
}

/** safe | watch | danger from remaining quota thresholds. */
function remainingTone(
  used: number | null | undefined,
): "safe" | "watch" | "danger" | null {
  if (used === null || used === undefined) return null;
  const n = Number(used);
  if (!Number.isFinite(n)) return null;
  const remaining = 100 - n;
  if (remaining < 10) return "danger";
  if (remaining < 30) return "watch";
  return "safe";
}

function fillClass(used: number | null | undefined): string {
  const tone = remainingTone(used);
  return tone ? `usage-fill fill-${tone}` : "usage-fill";
}

function usedHtml(
  provider: string,
  usedPercent: number | null,
  breakdown?: UsageBreakdown | null,
  quotaWindows?: QuotaWindowDisplay[] | null,
): string {
  if (
    breakdown &&
    (breakdown.autoPercent !== null || breakdown.apiPercent !== null)
  ) {
    return `Auto <b class="${pctClass(breakdown.autoPercent)}">${escapeHtml(fmtPct(breakdown.autoPercent))}</b> · API <b class="${pctClass(breakdown.apiPercent)}">${escapeHtml(fmtPct(breakdown.apiPercent))}</b>`;
  }
  if (isCodexProvider(provider) && quotaWindows?.length) {
    return quotaWindows
      .map(
        (window) =>
          `${escapeHtml(window.label)} <b class="${pctClass(window.usedPercent)}">${escapeHtml(fmtPct(window.remainingPercent))}</b>`,
      )
      .join(" · ");
  }
  if (isCodexProvider(provider)) {
    const remaining = toRemaining(usedPercent);
    return remaining === null
      ? "—"
      : `剩余 <b class="${pctClass(usedPercent)}">${Math.round(remaining)}%</b>`;
  }
  return usedPercent === null
    ? "—"
    : `已用 <b class="${pctClass(usedPercent)}">${Math.round(usedPercent)}%</b>`;
}

export type LayoutMode = "standard" | "minimal" | "minimal-logo";

export function renderCapsule(
  root: HTMLElement,
  model: CapsuleViewModel,
  expanded: boolean,
  refreshing = false,
  layoutMode: LayoutMode = "standard",
): void {
  root.dataset.tone = model.tone;
  root.classList.toggle("expanded", expanded);
  root.classList.toggle("dual", model.displayMode === "both");
  const isMinimal = layoutMode === "minimal" || layoutMode === "minimal-logo";
  const usesProviderLogos = layoutMode === "minimal-logo";
  root.classList.toggle("minimal", isMinimal && !expanded);
  root.classList.toggle("minimal-logo", usesProviderLogos && !expanded);
  root.classList.toggle("refreshing", refreshing);

  const isDual =
    (model.displayMode === "both" || model.provider === "both") &&
    !!model.providers?.length;

  // Minimal layout only affects the collapsed view; expand still shows detail.
  if (!expanded && isMinimal) {
    if (isDual) {
      root.innerHTML = (model.providers ?? [])
        .map((p) =>
          minimalChip(
            p.provider,
            p.usedPercent,
            p.tone,
            p.usageBreakdown,
            p.quotaWindows,
            usesProviderLogos,
          ),
        )
        .join("");
      return;
    }
    root.innerHTML = minimalChip(
      model.provider,
      model.usedPercent,
      model.tone,
      model.usageBreakdown,
      model.quotaWindows,
      usesProviderLogos,
    );
    return;
  }

  if (isDual) {
    renderDual(root, model, expanded, refreshing);
    return;
  }

  const used = usedHtml(
    model.provider,
    model.usedPercent,
    model.usageBreakdown,
    model.quotaWindows,
  );
  const tag = providerLabel(model.provider);

  if (!expanded) {
    const hint =
      model.state === "dataUnavailable"
        ? escapeHtml(model.judgmentText)
        : escapeHtml(model.resetCountdownText);
    root.innerHTML = `
      <span class="dot" aria-hidden="true"></span>
      <span class="tag">${escapeHtml(tag)}</span>
      <span class="status">${escapeHtml(model.statusLabel)}</span>
      <span class="used">${used}</span>
      <span class="countdown" title="${hint}">${
        model.state === "dataUnavailable"
          ? escapeHtml(shortUnavailableHint(model.diagnosticCode))
          : escapeHtml(model.resetCountdownText)
      }</span>
    `;
    return;
  }

  const refreshLabel = refreshing ? "刷新中" : "刷新";
  const bars =
    breakdownBars(model.usageBreakdown) ||
    quotaWindowBars(model.quotaWindows) ||
    singleBar(model.usedPercent, isCodexProvider(model.provider));
  root.innerHTML = `
    <div class="expanded-row">
      <span class="dot" aria-hidden="true"></span>
      <span class="tag">${escapeHtml(tag)}</span>
      <span class="status">${escapeHtml(model.statusLabel)}</span>
    </div>
    ${bars}
    <p class="judgment">${escapeHtml(model.judgmentText)}</p>
    <div class="meta">
      <span>${escapeHtml(model.freshnessText)}</span>
      <span>${escapeHtml(model.resetCountdownText)}</span>
    </div>
    ${subscriptionRow(model.subscription)}
    <button type="button" id="refresh-btn" class="refresh${refreshing ? " is-busy" : ""}" ${refreshing ? "disabled" : ""}>
      <span class="refresh-spinner" aria-hidden="true"></span>
      <span class="refresh-label">${refreshLabel}</span>
    </button>
  `;
}

function minimalChip(
  provider: string,
  usedPercent: number | null,
  tone: CapsuleTone,
  breakdown?: UsageBreakdown | null,
  quotaWindows?: QuotaWindowDisplay[] | null,
  useProviderLogo = false,
): string {
  const tag = providerLabel(provider === "both" ? "codex" : provider);
  const hasSplit =
    breakdown &&
    (breakdown.autoPercent !== null || breakdown.apiPercent !== null);
  const hasQuotaWindows = isCodexProvider(provider) && !!quotaWindows?.length;
  const showPct = hasSplit
    ? null
    : isCodexProvider(provider)
      ? toRemaining(usedPercent)
      : usedPercent;
  const pctHtml = hasSplit
    ? `<span class="mini-values"><b class="${pctClass(breakdown.autoPercent)}">${escapeHtml(fmtPct(breakdown.autoPercent))}</b><span class="mini-sep">/</span><b class="${pctClass(breakdown.apiPercent)}">${escapeHtml(fmtPct(breakdown.apiPercent))}</b></span>`
    : hasQuotaWindows
      ? `<span class="mini-values">${quotaWindows
          .map(
            (window) =>
              `<b class="${pctClass(window.usedPercent)}">${escapeHtml(fmtPct(window.remainingPercent))}</b>`,
          )
          .join('<span class="mini-sep">/</span>')}</span>`
      : `<span class="mini-values"><b class="${pctClass(usedPercent)}">${escapeHtml(fmtPct(showPct))}</b></span>`;
  return `
    <div class="mini-chip" data-tone="${escapeHtml(tone)}">
      <span class="dot" aria-hidden="true"></span>
      ${useProviderLogo ? providerLogo(provider) : `<span class="tag">${escapeHtml(tag)}</span>`}
      ${pctHtml}
    </div>
  `;
}

function breakdownBars(breakdown?: UsageBreakdown | null): string {
  if (
    !breakdown ||
    (breakdown.autoPercent === null && breakdown.apiPercent === null)
  ) {
    return "";
  }
  return `
    <div class="usage-split">
      <div class="usage-line">
        <span class="usage-name">Auto</span>
        <span class="usage-bar"><span class="${fillClass(breakdown.autoPercent)}" style="width:${barWidth(breakdown.autoPercent)}%"></span></span>
        <span class="usage-pct ${pctClass(breakdown.autoPercent)}">${escapeHtml(fmtPct(breakdown.autoPercent))}</span>
      </div>
      <div class="usage-line">
        <span class="usage-name">API</span>
        <span class="usage-bar"><span class="${fillClass(breakdown.apiPercent)}" style="width:${barWidth(breakdown.apiPercent)}%"></span></span>
        <span class="usage-pct ${pctClass(breakdown.apiPercent)}">${escapeHtml(fmtPct(breakdown.apiPercent))}</span>
      </div>
    </div>
  `;
}

function quotaWindowBars(windows?: QuotaWindowDisplay[] | null): string {
  if (!windows?.length) return "";
  return `
    <div class="usage-split quota-windows">
      ${windows
        .map(
          (window) => `
            <div class="quota-window">
              <div class="usage-line">
                <span class="usage-name">${escapeHtml(window.label)}</span>
                <span class="usage-bar" aria-hidden="true"><span class="${fillClass(window.usedPercent)}" style="width:${barWidth(window.remainingPercent)}%"></span></span>
                <span class="usage-pct ${pctClass(window.usedPercent)}">${escapeHtml(fmtPct(window.remainingPercent))}</span>
              </div>
              <div class="quota-reset">${escapeHtml(window.resetCountdownText)}</div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function providerLogo(provider: string): string {
  const label = providerLabel(provider);
  const logoClass = provider === "cursor" ? "cursor" : "codex";
  return `<span class="provider-logo provider-logo-${logoClass}" role="img" aria-label="${label}" title="${label}"></span>`;
}

function singleBar(usedPercent: number | null, asRemaining = false): string {
  if (usedPercent === null || usedPercent === undefined) return "";
  const used = Number(usedPercent);
  if (!Number.isFinite(used)) return "";
  const value = asRemaining ? toRemaining(used) : used;
  if (value === null || !Number.isFinite(value)) return "";
  const label = asRemaining ? "剩余" : "已用";
  const width = barWidth(value);
  return `
    <div class="usage-split">
      <div class="usage-line">
        <span class="usage-name">${label}</span>
        <span class="usage-bar" aria-hidden="true"><span class="${fillClass(used)}" style="width:${width}%"></span></span>
        <span class="usage-pct ${pctClass(used)}">${escapeHtml(fmtPct(value))}</span>
      </div>
    </div>
  `;
}

function barWidth(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return 0;
  }
  return Math.min(100, Math.max(0, Number(value)));
}

function renderDual(
  root: HTMLElement,
  model: CapsuleViewModel,
  expanded: boolean,
  refreshing: boolean,
): void {
  const rows = (model.providers ?? [])
    .map((p) => {
      const used = usedHtml(p.provider, p.usedPercent, p.usageBreakdown, p.quotaWindows);
      const tag = providerLabel(p.provider);
      if (!expanded) {
        return `
          <div class="dual-row" data-tone="${escapeHtml(p.tone)}">
            <span class="dot" aria-hidden="true"></span>
            <span class="tag">${escapeHtml(tag)}</span>
            <span class="status">${escapeHtml(p.statusLabel)}</span>
            <span class="used">${used}</span>
            <span class="countdown">${escapeHtml(p.resetCountdownText)}</span>
          </div>
        `;
      }
      return `
        <div class="dual-block" data-tone="${escapeHtml(p.tone)}">
          <div class="expanded-row">
            <span class="dot" aria-hidden="true"></span>
            <span class="tag">${escapeHtml(tag)}</span>
            <span class="status">${escapeHtml(p.statusLabel)}</span>
          </div>
          ${breakdownBars(p.usageBreakdown) || quotaWindowBars(p.quotaWindows) || singleBar(p.usedPercent, isCodexProvider(p.provider)) || `<span class="used">${used}</span>`}
          <p class="judgment">${escapeHtml(p.judgmentText)}</p>
          <div class="meta">
            <span>${escapeHtml(p.freshnessText)}</span>
            <span>${escapeHtml(p.resetCountdownText)}</span>
          </div>
          ${subscriptionRow(p.subscription)}
        </div>
      `;
    })
    .join("");

  if (!expanded) {
    root.innerHTML = rows;
    return;
  }

  const refreshLabel = refreshing ? "刷新中" : "刷新";
  root.innerHTML = `
    ${rows}
    <button type="button" id="refresh-btn" class="refresh${refreshing ? " is-busy" : ""}" ${refreshing ? "disabled" : ""}>
      <span class="refresh-spinner" aria-hidden="true"></span>
      <span class="refresh-label">${refreshLabel}</span>
    </button>
  `;
}

export function placeholderModel(): CapsuleViewModel {
  return { ...PLACEHOLDER };
}

/** Window heights for single vs dual layouts. */
export function capsuleHeights(
  model: CapsuleViewModel,
  expanded: boolean,
  layoutMode: LayoutMode = "standard",
): {
  width: number;
  height: number;
} {
  const hasCursorSplit =
    !!model.usageBreakdown ||
    !!model.providers?.some((p) => p.provider === "cursor" && p.usageBreakdown);
  const hasSubscription =
    !!model.subscription || !!model.providers?.some((p) => !!p.subscription);
  const hasQuotaWindows =
    !!model.quotaWindows?.length ||
    !!model.providers?.some((p) => !!p.quotaWindows?.length);
  if (
    !expanded &&
    (layoutMode === "minimal" || layoutMode === "minimal-logo")
  ) {
    if (model.displayMode === "both") {
      return { width: layoutMode === "minimal-logo" ? 200 : 240, height: 28 };
    }
    return { width: layoutMode === "minimal-logo" ? 112 : 140, height: 28 };
  }
  if (model.displayMode === "both") {
    // Fixed expanded width so short judgment text doesn't shrink the bars.
    const expandedHeight =
      (hasCursorSplit ? 210 : 185) +
      (hasSubscription ? 30 : 0) +
      (hasQuotaWindows ? 40 : 0);
    return { width: expanded ? 220 : 380, height: expanded ? expandedHeight : 52 };
  }
  if (hasCursorSplit) {
    return { width: expanded ? 220 : 340, height: expanded ? 150 + (hasSubscription ? 30 : 0) : 36 };
  }
  // Single provider with one usage bar (e.g. codex).
  return {
    width: expanded ? 220 : hasQuotaWindows ? 380 : 300,
    height: expanded
      ? 135 + (hasSubscription ? 30 : 0) + (hasQuotaWindows ? 40 : 0)
      : 36,
  };
}

function subscriptionRow(
  subscription?: SubscriptionValidity | null,
): string {
  if (!subscription) return "";
  return `
    <div class="meta" title="${escapeHtml(subscription.expiresAtIso)}">
      <span>${escapeHtml(subscription.planLabel)} ${escapeHtml(subscription.validityText)}</span>
      <span>${escapeHtml(subscription.expiresAtText)}</span>
    </div>
  `;
}

function shortUnavailableHint(code: string | null): string {
  switch (code) {
    case "node_missing":
      return "缺 Node 运行时";
    case "cli_missing":
      return "未找到客户端";
    case "auth_required":
      return "请先登录";
    case "timeout":
      return "读取超时";
    default:
      return "点开查看原因";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
