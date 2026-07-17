export type CapsuleTone = "safe" | "watch" | "danger" | "unknown";

export type UsageBreakdown = {
  autoPercent: number | null;
  apiPercent: number | null;
  totalPercent: number | null;
};

export type ProviderSlice = {
  provider: "codex" | "cursor";
  state: string;
  tone: CapsuleTone;
  statusLabel: string;
  judgmentText: string;
  usedPercent: number | null;
  usageBreakdown?: UsageBreakdown | null;
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
  usageBreakdown?: UsageBreakdown | null;
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

/** Tone class for a single pool, by its own remaining quota. */
function pctClass(used: number | null | undefined): string {
  if (used === null || used === undefined || !Number.isFinite(used)) {
    return "pct";
  }
  const remaining = 100 - used;
  if (remaining < 10) return "pct pct-danger";
  if (remaining < 30) return "pct pct-watch";
  return "pct pct-safe";
}

function usedHtml(
  usedPercent: number | null,
  breakdown?: UsageBreakdown | null,
): string {
  if (
    breakdown &&
    (breakdown.autoPercent !== null || breakdown.apiPercent !== null)
  ) {
    return `Auto <b class="${pctClass(breakdown.autoPercent)}">${escapeHtml(fmtPct(breakdown.autoPercent))}</b> · API <b class="${pctClass(breakdown.apiPercent)}">${escapeHtml(fmtPct(breakdown.apiPercent))}</b>`;
  }
  return usedPercent === null
    ? "—"
    : `已用 <b class="${pctClass(usedPercent)}">${Math.round(usedPercent)}%</b>`;
}

export type LayoutMode = "standard" | "minimal";

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
  root.classList.toggle("minimal", layoutMode === "minimal" && !expanded);
  root.classList.toggle("refreshing", refreshing);

  const isDual =
    (model.displayMode === "both" || model.provider === "both") &&
    !!model.providers?.length;

  // Minimal layout only affects the collapsed view; expand still shows detail.
  if (!expanded && layoutMode === "minimal") {
    if (isDual) {
      root.innerHTML = (model.providers ?? [])
        .map((p) => minimalChip(p.provider, p.usedPercent, p.tone, p.usageBreakdown))
        .join("");
      return;
    }
    root.innerHTML = minimalChip(
      model.provider,
      model.usedPercent,
      model.tone,
      model.usageBreakdown,
    );
    return;
  }

  if (isDual) {
    renderDual(root, model, expanded, refreshing);
    return;
  }

  const used = usedHtml(model.usedPercent, model.usageBreakdown);
  const tag = providerLabel(model.provider);

  if (!expanded) {
    root.innerHTML = `
      <span class="dot" aria-hidden="true"></span>
      <span class="tag">${escapeHtml(tag)}</span>
      <span class="status">${escapeHtml(model.statusLabel)}</span>
      <span class="used">${used}</span>
      <span class="countdown">${escapeHtml(model.resetCountdownText)}</span>
    `;
    return;
  }

  const refreshLabel = refreshing ? "刷新中" : "刷新";
  const bars =
    breakdownBars(model.usageBreakdown) || singleBar(model.usedPercent);
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
): string {
  const tag = providerLabel(provider === "both" ? "codex" : provider);
  const hasSplit =
    breakdown &&
    (breakdown.autoPercent !== null || breakdown.apiPercent !== null);
  const pctHtml = hasSplit
    ? `<b class="${pctClass(breakdown.autoPercent)}">${escapeHtml(fmtPct(breakdown.autoPercent))}</b><span class="mini-sep">/</span><b class="${pctClass(breakdown.apiPercent)}">${escapeHtml(fmtPct(breakdown.apiPercent))}</b>`
    : `<b class="${pctClass(usedPercent)}">${escapeHtml(fmtPct(usedPercent))}</b>`;
  return `
    <div class="mini-chip" data-tone="${escapeHtml(tone)}">
      <span class="dot" aria-hidden="true"></span>
      <span class="tag">${escapeHtml(tag)}</span>
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
        <span class="usage-name">Auto+Composer</span>
        <span class="usage-bar"><i style="width:${barWidth(breakdown.autoPercent)}%"></i></span>
        <span class="usage-pct ${pctClass(breakdown.autoPercent)}">${escapeHtml(fmtPct(breakdown.autoPercent))}</span>
      </div>
      <div class="usage-line">
        <span class="usage-name">API</span>
        <span class="usage-bar"><i style="width:${barWidth(breakdown.apiPercent)}%"></i></span>
        <span class="usage-pct ${pctClass(breakdown.apiPercent)}">${escapeHtml(fmtPct(breakdown.apiPercent))}</span>
      </div>
    </div>
  `;
}

function singleBar(usedPercent: number | null): string {
  if (usedPercent === null || !Number.isFinite(usedPercent)) return "";
  return `
    <div class="usage-split">
      <div class="usage-line">
        <span class="usage-name">已用</span>
        <span class="usage-bar"><i style="width:${barWidth(usedPercent)}%"></i></span>
        <span class="usage-pct ${pctClass(usedPercent)}">${escapeHtml(fmtPct(usedPercent))}</span>
      </div>
    </div>
  `;
}

function barWidth(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function renderDual(
  root: HTMLElement,
  model: CapsuleViewModel,
  expanded: boolean,
  refreshing: boolean,
): void {
  const rows = (model.providers ?? [])
    .map((p) => {
      const used = usedHtml(p.usedPercent, p.usageBreakdown);
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
          ${breakdownBars(p.usageBreakdown) || singleBar(p.usedPercent) || `<span class="used">${used}</span>`}
          <p class="judgment">${escapeHtml(p.judgmentText)}</p>
          <div class="meta">
            <span>${escapeHtml(p.freshnessText)}</span>
            <span>${escapeHtml(p.resetCountdownText)}</span>
          </div>
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
  if (!expanded && layoutMode === "minimal") {
    if (model.displayMode === "both") {
      return { width: 240, height: 28 };
    }
    return { width: 140, height: 28 };
  }
  if (model.displayMode === "both") {
    // Fallback heights; fitWindow measures real content when expanded.
    return { width: 380, height: expanded ? (hasCursorSplit ? 210 : 185) : 52 };
  }
  if (hasCursorSplit) {
    return { width: 340, height: expanded ? 150 : 36 };
  }
  // Single provider with one usage bar (e.g. codex).
  return { width: 300, height: expanded ? 135 : 36 };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
