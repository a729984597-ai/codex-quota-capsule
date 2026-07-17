import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  capsuleHeights,
  placeholderModel,
  renderCapsule,
  type CapsuleViewModel,
  type LayoutMode,
} from "./render";

let expanded = false;
let model: CapsuleViewModel = placeholderModel();
let refreshing = false;
let fontScale = 1;
let layoutMode: LayoutMode = "standard";

const FONT_SCALES: Record<string, number> = {
  small: 1,
  standard: 1.15,
  large: 1.3,
  xlarge: 1.45,
};

const DRAG_THRESHOLD_PX = 4;

function applyFontSize(size: string): void {
  fontScale = FONT_SCALES[size] ?? 1;
  // zoom scales the whole layout; the window is resized to match.
  (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom =
    String(fontScale);
  paint();
  void fitWindow();
}

function applyLayoutMode(mode: string): void {
  layoutMode = mode === "minimal" ? "minimal" : "standard";
  paint();
  void fitWindow();
}

async function fitWindow(): Promise<void> {
  const { width, height } = capsuleHeights(model, expanded, layoutMode);
  const win = getCurrentWindow();
  const scaledW = Math.round(width * fontScale);
  const fallbackH = Math.round(height * fontScale);

  // Measure intrinsic content size so expanded/collapsed windows hug content
  // instead of leaving large top/bottom gaps from fixed heights + centering.
  const root = document.querySelector<HTMLElement>("#capsule");
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  let measuredW = scaledW;
  let measuredH = fallbackH;
  if (root) {
    const prevWidth = root.style.width;
    const prevHeight = root.style.height;
    const prevBodyHeight = document.body.style.height;
    document.body.style.height = "auto";
    root.style.height = "auto";
    if (!expanded) {
      root.style.width = "max-content";
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    const rect = root.getBoundingClientRect();
    root.style.width = prevWidth;
    root.style.height = prevHeight;
    document.body.style.height = prevBodyHeight;
    const safety = expanded ? 4 : 6;
    measuredW = Math.ceil(rect.width) + (expanded ? 0 : safety);
    measuredH = Math.ceil(rect.height) + safety;
  }

  await win.setSize(
    new LogicalSize(
      expanded ? scaledW : Math.max(scaledW, measuredW),
      Math.max(1, measuredH),
    ),
  );
}

async function setExpanded(next: boolean): Promise<void> {
  expanded = next;
  paint();
  await fitWindow();
}

function paint(): void {
  document.body.classList.toggle("is-expanded", expanded);
  const root = document.querySelector<HTMLElement>("#capsule");
  if (!root) return;
  renderCapsule(root, model, expanded, refreshing, layoutMode);
  root.querySelector("#refresh-btn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    void refreshNow();
  });
}

async function refreshNow(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  paint();
  try {
    const next = await invoke<CapsuleViewModel>("refresh_now");
    model = next;
  } catch (error) {
    console.error("refresh_now failed", error);
  } finally {
    refreshing = false;
    paint();
    void fitWindow();
  }
}

function bindDragAndToggle(root: HTMLElement): void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;

  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea")) return;

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    dragging = false;
  });

  root.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId || dragging) return;
    const dx = Math.abs(event.clientX - startX);
    const dy = Math.abs(event.clientY - startY);
    if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return;

    dragging = true;
    void getCurrentWindow().startDragging();
  });

  const endPointer = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    const wasDragging = dragging;
    pointerId = null;
    dragging = false;
    if (!wasDragging && event.type === "pointerup") {
      void setExpanded(!expanded);
    }
  };

  root.addEventListener("pointerup", endPointer);
  root.addEventListener("pointercancel", endPointer);
}

function applyViewModel(next: CapsuleViewModel): void {
  model = next;
  paint();
  void fitWindow();
}

window.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector<HTMLElement>("#capsule");
  if (!root) return;
  paint();
  void fitWindow();
  bindDragAndToggle(root);

  // Replace the WebView2 default context menu with the app menu.
  window.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    void invoke("show_context_menu").catch(() => undefined);
  });

  void listen<CapsuleViewModel>("quota://updated", (event) => {
    applyViewModel(event.payload);
  });

  void listen<string>("quota://font-changed", (event) => {
    applyFontSize(event.payload);
  });

  void listen<string>("quota://layout-changed", (event) => {
    applyLayoutMode(event.payload);
  });

  void invoke<string>("get_font_size")
    .then(applyFontSize)
    .catch(() => undefined);

  void invoke<string>("get_layout_mode")
    .then(applyLayoutMode)
    .catch(() => undefined);

  void invoke<CapsuleViewModel>("get_view_model")
    .then(applyViewModel)
    .catch(() => undefined);
});

export { applyViewModel };
