import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { placeholderModel, renderCapsule, type CapsuleViewModel } from "./render";

let expanded = false;
let model: CapsuleViewModel = placeholderModel();

async function setExpanded(next: boolean): Promise<void> {
  expanded = next;
  const win = getCurrentWindow();
  await win.setSize(new LogicalSize(280, expanded ? 140 : 64));
  paint();
}

function paint(): void {
  const root = document.querySelector<HTMLElement>("#capsule");
  if (!root) return;
  renderCapsule(root, model, expanded);
  root.querySelector("#refresh-btn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    // Task 10 will wire refresh_now; placeholder keeps UI interactive.
  });
}

window.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector<HTMLElement>("#capsule");
  if (!root) return;
  paint();
  root.addEventListener("click", () => {
    void setExpanded(!expanded);
  });
});

export function applyViewModel(next: CapsuleViewModel): void {
  model = next;
  paint();
}
