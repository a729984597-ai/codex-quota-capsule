import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCodexRateLimits } from "../src/parse.ts";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/codex-rate-limits",
);

/** Fixed fetchedAt earlier than fixture resetsAt (see plan review). */
const FETCHED_AT = new Date("2026-07-16T00:00:00.000Z");

describe("parseCodexRateLimits", () => {
  it("parses weekly-ok into an ok snapshot with weekly window", () => {
    const result = JSON.parse(
      readFileSync(join(fixturesDir, "weekly-ok.json"), "utf8"),
    );
    const snap = parseCodexRateLimits(result, { fetchedAt: FETCHED_AT });
    expect(snap.sourceStatus).toBe("ok");
    expect(snap.weeklyWindow?.label).toBe("weekly");
    expect(snap.weeklyWindow?.windowMinutes).toBe(10_080);
    expect(snap.weeklyWindow?.usedPercent).toBe(35);
    expect(snap.weeklyWindow?.remainingPercent).toBe(65);
  });

  it("returns error + no_weekly_window when only a short window exists", () => {
    const result = JSON.parse(
      readFileSync(join(fixturesDir, "missing-weekly.json"), "utf8"),
    );
    const snap = parseCodexRateLimits(result, { fetchedAt: FETCHED_AT });
    expect(snap.sourceStatus).toBe("error");
    expect(snap.diagnosticCode).toBe("no_weekly_window");
    expect(snap.weeklyWindow).toBeUndefined();
  });

  it("parses free-tier monthly (43200 min) as an ok cycle window", () => {
    const result = JSON.parse(
      readFileSync(join(fixturesDir, "free-monthly.json"), "utf8"),
    );
    const snap = parseCodexRateLimits(result, { fetchedAt: FETCHED_AT });
    expect(snap.sourceStatus).toBe("ok");
    expect(snap.weeklyWindow?.label).toBe("monthly");
    expect(snap.weeklyWindow?.windowMinutes).toBe(43_200);
    expect(snap.weeklyWindow?.usedPercent).toBe(0);
  });
});
