import { describe, expect, it } from "vitest";
import { fittedWindowWidth } from "../src/sizing.ts";

describe("fittedWindowWidth", () => {
  it("lets minimal mode shrink-wrap its rendered text", () => {
    expect(
      fittedWindowWidth({
        expanded: false,
        layoutMode: "minimal",
        fallbackWidth: 348,
        measuredWidth: 306,
      }),
    ).toBe(306);
  });

  it("keeps the configured width for standard and expanded layouts", () => {
    expect(
      fittedWindowWidth({
        expanded: false,
        layoutMode: "standard",
        fallbackWidth: 348,
        measuredWidth: 306,
      }),
    ).toBe(348);
    expect(
      fittedWindowWidth({
        expanded: true,
        layoutMode: "minimal",
        fallbackWidth: 319,
        measuredWidth: 280,
      }),
    ).toBe(319);
  });
});
