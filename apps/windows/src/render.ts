export type CapsuleTone = "safe" | "watch" | "danger" | "unknown";

export type CapsuleViewModel = {
  state: string;
  tone: CapsuleTone;
  statusLabel: string;
  judgmentText: string;
  usedPercent: number | null;
  resetCountdownText: string;
  freshnessText: string;
  isStale: boolean;
  diagnosticCode: string | null;
};

const PLACEHOLDER: CapsuleViewModel = {
  state: "dataUnavailable",
  tone: "unknown",
  statusLabel: "数据暂不可用",
  judgmentText: "等待首次刷新…",
  usedPercent: null,
  resetCountdownText: "重置时间未知",
  freshnessText: "尚未成功读取",
  isStale: false,
  diagnosticCode: null,
};

export function renderCapsule(
  root: HTMLElement,
  model: CapsuleViewModel,
  expanded: boolean,
): void {
  const used =
    model.usedPercent === null ? "—" : `本周已用 ${Math.round(model.usedPercent)}%`;

  root.dataset.tone = model.tone;
  root.classList.toggle("expanded", expanded);

  if (!expanded) {
    root.innerHTML = `
      <span class="dot" aria-hidden="true"></span>
      <span class="status">${escapeHtml(model.statusLabel)}</span>
      <span class="used">${escapeHtml(used)}</span>
      <span class="countdown">${escapeHtml(model.resetCountdownText)}</span>
    `;
    return;
  }

  root.innerHTML = `
    <div class="expanded-row">
      <span class="dot" aria-hidden="true"></span>
      <span class="status">${escapeHtml(model.statusLabel)}</span>
      <span class="used">${escapeHtml(used)}</span>
    </div>
    <p class="judgment">${escapeHtml(model.judgmentText)}</p>
    <div class="meta">
      <span>${escapeHtml(model.freshnessText)}</span>
      <span>${escapeHtml(model.resetCountdownText)}</span>
    </div>
    <button type="button" id="refresh-btn" class="refresh">刷新</button>
  `;
}

export function placeholderModel(): CapsuleViewModel {
  return { ...PLACEHOLDER };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
