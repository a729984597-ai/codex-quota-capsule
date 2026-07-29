export type Frame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WorkArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function clampFrameToMonitor(
  frame: Frame,
  monitor: WorkArea,
  margin: number,
): { x: number; y: number } {
  const inset = Math.max(0, margin);
  return {
    x: clampAxis(
      frame.x,
      frame.width,
      monitor.x,
      monitor.width,
      inset,
    ),
    y: clampAxis(
      frame.y,
      frame.height,
      monitor.y,
      monitor.height,
      inset,
    ),
  };
}

function clampAxis(
  position: number,
  frameSize: number,
  workStart: number,
  workSize: number,
  margin: number,
): number {
  const min = workStart + margin;
  const max = Math.max(min, workStart + workSize - frameSize - margin);
  return Math.min(max, Math.max(min, position));
}
