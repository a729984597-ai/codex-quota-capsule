export function fittedWindowWidth(input: {
  expanded: boolean;
  layoutMode: "standard" | "minimal" | "minimal-logo";
  fallbackWidth: number;
  measuredWidth: number;
}): number {
  if (input.expanded) {
    return input.fallbackWidth;
  }
  if (
    (input.layoutMode === "minimal" || input.layoutMode === "minimal-logo") &&
    input.measuredWidth > 0
  ) {
    return input.measuredWidth;
  }
  return Math.max(input.fallbackWidth, input.measuredWidth);
}
