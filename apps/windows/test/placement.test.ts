import { describe, expect, it } from "vitest";
import { clampFrameToMonitor } from "../src/placement.ts";

describe("clampFrameToMonitor", () => {
  it("keeps a capsule placed inside the taskbar", () => {
    expect(
      clampFrameToMonitor(
        { x: 1200, y: 1040, width: 348, height: 37 },
        { x: 0, y: 0, width: 1920, height: 1080 },
        0,
      ),
    ).toEqual({ x: 1200, y: 1040 });
  });

  it("keeps an in-bounds capsule in place", () => {
    expect(
      clampFrameToMonitor(
        { x: 1200, y: 900, width: 348, height: 37 },
        { x: 0, y: 0, width: 1920, height: 1080 },
        0,
      ),
    ).toEqual({ x: 1200, y: 900 });
  });

  it("supports work areas with negative monitor coordinates", () => {
    expect(
      clampFrameToMonitor(
        { x: -2000, y: 100, width: 348, height: 37 },
        { x: -1920, y: 0, width: 1920, height: 1080 },
        0,
      ),
    ).toEqual({ x: -1920, y: 100 });
  });
});
