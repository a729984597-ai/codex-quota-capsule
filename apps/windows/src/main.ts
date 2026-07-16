import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { placeholderModel, renderCapsule, type CapsuleViewModel } from "./render";

let expanded = false;
let model: CapsuleViewModel = placeholderModel();
let refreshing = false;

const DRAG_THRESHOLD_PX = 4;

async function setExpanded(next: boolean): Promise<void> {
  expanded = next;
  const win = getCurrentWindow();
  await win.setSize(new LogicalSize(280, expanded ? 140 : 64));
  paint();
}

function paint(): void {
  const root = document.querySelector<HTMLElement>("#capsule");
  if (!root) return;
  renderCapsule(root, model, expanded, refreshing);
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
}

window.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector<HTMLElement>("#capsule");
  if (!root) return;
  paint();
  bindDragAndToggle(root);

  void listen<CapsuleViewModel>("quota://updated", (event) => {
    applyViewModel(event.payload);
  });

  void invoke<CapsuleViewModel>("get_view_model")
    .then(applyViewModel)
    .catch(() => undefined);
});

export { applyViewModel };
