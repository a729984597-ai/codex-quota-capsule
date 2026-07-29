import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  capsuleHeights,
  placeholderModel,
  renderCapsule,
  type CapsuleViewModel,
  type LayoutMode,
} from "./render";
import { clampFrameToWorkArea } from "./placement";
import { createSerialExecutor } from "./serial";

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
const WORK_AREA_MARGIN_CSS_PX = 8;

/** Collapsed outer frame (physical px), saved on expand so collapse can restore exactly. */
let collapsedFrame: {
  x: number;
  y: number;
  width: number;
  height: number;
} | null = null;

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

function applyTheme(mode: string): void {
  const theme = mode === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
}

type FitMode = "expand" | "collapse" | "resize";
const runWindowFitSerially = createSerialExecutor();

async function persistCollapsedPosition(x: number, y: number): Promise<void> {
  try {
    await invoke("save_window_position", { x, y });
  } catch {
    // ignore persistence failures
  }
}

async function withSuppressedPositionSave<T>(fn: () => Promise<T>): Promise<T> {
  try {
    await invoke("suppress_window_position_save", { suppress: true });
  } catch {
    // older builds without the command — still attempt the move
  }
  try {
    return await fn();
  } finally {
    try {
      await invoke("suppress_window_position_save", { suppress: false });
    } catch {
      // ignore
    }
  }
}

function fitWindow(mode: FitMode = "resize"): Promise<void> {
  return runWindowFitSerially(() => fitWindowNow(mode));
}

async function fitWindowNow(mode: FitMode): Promise<void> {
  const { width, height } = capsuleHeights(model, expanded, layoutMode);
  const win = getCurrentWindow();
  const scaledW = Math.round(width * fontScale);
  const fallbackH = Math.round(height * fontScale);

  const prevPos = await win.outerPosition();
  const prevSize = await win.outerSize();
  const scale = await win.scaleFactor();

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
    let rect: DOMRect | null = null;
    try {
      document.body.style.height = "auto";
      root.style.height = "auto";
      if (expanded) {
        // Keep a stable expanded width — max-content shrinks after short copy.
        root.style.width = `${width}px`;
      } else {
        root.style.width = "max-content";
      }
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      rect = root.getBoundingClientRect();
    } finally {
      root.style.width = prevWidth;
      root.style.height = prevHeight;
      document.body.style.height = prevBodyHeight;
    }
    // Keep the HWND flush to the visible capsule — extra padding steals tray clicks.
    const safety = 0;
    if (rect) {
      measuredW = expanded ? scaledW : Math.ceil(rect.width) + safety;
      measuredH = Math.ceil(rect.height) + safety;
    }
  }

  const nextW = expanded ? scaledW : Math.max(scaledW, measuredW);
  const nextH = Math.max(1, measuredH);
  const nextWPhys = Math.round(nextW * scale);
  const nextHPhys = Math.round(nextH * scale);

  let nextX = prevPos.x;
  let nextY = prevPos.y;
  const monitor = await currentMonitor();

  if (mode === "collapse" && collapsedFrame) {
    // Exact restore — avoid recomputing from the expanded frame (DPI/clamp drift).
    nextX = collapsedFrame.x;
    nextY = collapsedFrame.y;
  } else if (monitor) {
    const wa = monitor.workArea;
    const waTop = wa.position.y;
    const waBottom = wa.position.y + wa.size.height;
    const waMidY = waTop + wa.size.height / 2;

    if (mode === "resize" && !expanded) {
      // Keep the user's anchor unless it enters the taskbar / reserved work area.
    } else if (mode === "expand" && collapsedFrame) {
      const anchorBottom = collapsedFrame.y + collapsedFrame.height;
      const anchorRight = collapsedFrame.x + collapsedFrame.width;
      const anchorCenterY = collapsedFrame.y + collapsedFrame.height / 2;
      const monLeft = monitor.position.x;
      const monRight = monitor.position.x + monitor.size.width;
      const monMidX = monLeft + monitor.size.width / 2;
      const anchorCenterX = collapsedFrame.x + collapsedFrame.width / 2;
      const growUp =
        anchorCenterY >= waMidY || collapsedFrame.y + nextHPhys > waBottom;
      // Near the tray (right half): grow left so a wider panel stays on-screen.
      const growLeft =
        anchorCenterX >= monMidX || collapsedFrame.x + nextWPhys > monRight;
      nextX = growLeft ? anchorRight - nextWPhys : collapsedFrame.x;
      nextY = growUp ? anchorBottom - nextHPhys : collapsedFrame.y;
    } else {
      // Refresh / font / layout while staying expanded: keep bottom when low,
      // keep right edge when sitting on the right half of the monitor.
      const prevBottom = prevPos.y + prevSize.height;
      const prevRight = prevPos.x + prevSize.width;
      const prevCenterY = prevPos.y + prevSize.height / 2;
      const prevCenterX = prevPos.x + prevSize.width / 2;
      const monLeft = monitor.position.x;
      const monRight = monitor.position.x + monitor.size.width;
      const monMidX = monLeft + monitor.size.width / 2;
      const growUp =
        prevCenterY >= waMidY || prevPos.y + nextHPhys > waBottom;
      const growLeft =
        prevCenterX >= monMidX || prevPos.x + nextWPhys > monRight;
      nextX = growLeft ? prevRight - nextWPhys : prevPos.x;
      nextY = growUp ? prevBottom - nextHPhys : prevPos.y;
    }

    const margin = Math.round(WORK_AREA_MARGIN_CSS_PX * scale);
    const clamped = clampFrameToWorkArea(
      { x: nextX, y: nextY, width: nextWPhys, height: nextHPhys },
      {
        x: wa.position.x,
        y: wa.position.y,
        width: wa.size.width,
        height: wa.size.height,
      },
      margin,
    );
    nextX = clamped.x;
    nextY = clamped.y;
  }

  const positionChanged = nextX !== prevPos.x || nextY !== prevPos.y;
  await withSuppressedPositionSave(async () => {
    await win.setSize(new LogicalSize(nextW, nextH));
    if (positionChanged || mode !== "resize") {
      await win.setPosition(new PhysicalPosition(nextX, nextY));
    }
  });
  if (!expanded && mode === "resize" && positionChanged) {
    await persistCollapsedPosition(nextX, nextY);
  }
}

async function setExpanded(next: boolean): Promise<void> {
  const win = getCurrentWindow();
  if (next && !expanded) {
    const pos = await win.outerPosition();
    const size = await win.outerSize();
    collapsedFrame = {
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
    };
    // Persist collapsed spot before expand so quit-while-expanded still restores it.
    await persistCollapsedPosition(pos.x, pos.y);
    expanded = true;
    paint();
    await fitWindow("expand");
    return;
  }
  if (!next && expanded) {
    expanded = false;
    paint();
    await fitWindow("collapse");
    const pos = await win.outerPosition();
    await persistCollapsedPosition(pos.x, pos.y);
    collapsedFrame = null;
    return;
  }
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
      return;
    }
    // Persist after any user drag — not on OS-driven Moved events (display wake).
    if (wasDragging && event.type === "pointerup") {
      void (async () => {
        const win = getCurrentWindow();
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        const monitor = await currentMonitor();
        const scale = await win.scaleFactor();
        let next = { x: pos.x, y: pos.y };
        if (monitor) {
          const wa = monitor.workArea;
          next = clampFrameToWorkArea(
            { x: pos.x, y: pos.y, width: size.width, height: size.height },
            {
              x: wa.position.x,
              y: wa.position.y,
              width: wa.size.width,
              height: wa.size.height,
            },
            Math.round(WORK_AREA_MARGIN_CSS_PX * scale),
          );
        }
        if (next.x !== pos.x || next.y !== pos.y) {
          await withSuppressedPositionSave(() =>
            win.setPosition(new PhysicalPosition(next.x, next.y)),
          );
        }
        await persistCollapsedPosition(next.x, next.y);
        if (!expanded) {
          collapsedFrame = {
            x: next.x,
            y: next.y,
            width: size.width,
            height: size.height,
          };
        }
      })();
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

  void listen<string>("quota://theme-changed", (event) => {
    applyTheme(event.payload);
  });

  void invoke<string>("get_font_size")
    .then(applyFontSize)
    .catch(() => undefined);

  void invoke<string>("get_layout_mode")
    .then(applyLayoutMode)
    .catch(() => undefined);

  void invoke<string>("get_theme_mode")
    .then(applyTheme)
    .catch(() => undefined);

  void invoke<CapsuleViewModel>("get_view_model")
    .then(applyViewModel)
    .catch(() => undefined);
});

export { applyViewModel };
