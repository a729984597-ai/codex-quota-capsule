import { describe, expect, it } from "vitest";
import { clampFrameToWorkArea } from "../src/placement.ts";

describe("clampFrameToWorkArea", () => {
  it("moves a capsule out of the taskbar activation area", () => {
    expect(
      clampFrameToWorkArea(
        { x: 1200, y: 1040, width: 348, height: 37 },
        { x: 0, y: 0, width: 1920, height: 1040 },
        8,
      ),
    ).toEqual({ x: 1200, y: 995 });
  });

  it("keeps an in-bounds capsule in place", () => {
    expect(
      clampFrameToWorkArea(
        { x: 1200, y: 900, width: 348, height: 37 },
        { x: 0, y: 0, width: 1920, height: 1040 },
        8,
      ),
    ).toEqual({ x: 1200, y: 900 });
  });

  it("supports work areas with negative monitor coordinates", () => {
    expect(
      clampFrameToWorkArea(
        { x: -2000, y: 100, width: 348, height: 37 },
        { x: -1920, y: 0, width: 1920, height: 1040 },
        8,
      ),
    ).toEqual({ x: -1912, y: 100 });
  });
});
