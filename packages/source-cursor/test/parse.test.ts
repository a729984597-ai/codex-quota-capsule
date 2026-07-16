import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCursorPeriodUsage } from "../src/parse.ts";
import { classifyCursorError } from "../src/diagnose.ts";
import { findCursorStateDb } from "../src/paths.ts";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/cursor-usage",
);

const FETCHED_AT = new Date("2026-07-16T00:00:00.000Z");

describe("parseCursorPeriodUsage", () => {
  it("parses period-ok into ok snapshot with billing-cycle window", () => {
    const raw = JSON.parse(
      readFileSync(join(fixturesDir, "period-ok.json"), "utf8"),
    );
    const snap = parseCursorPeriodUsage(raw, { fetchedAt: FETCHED_AT });
    expect(snap.sourceStatus).toBe("ok");
    expect(snap.provider).toBe("cursor");
    expect(snap.weeklyWindow?.label).toBe("billing-cycle");
    // Runway uses the hotter pool (max of Auto vs API).
    expect(snap.weeklyWindow?.usedPercent).toBe(46.5);
    expect(snap.usageBreakdown).toEqual({
      autoPercent: 40.4,
      apiPercent: 46.5,
      totalPercent: 37,
    });
    expect(snap.weeklyWindow?.resetsAt.toISOString()).toBe(
      new Date(1786752000000).toISOString(),
    );
  });

  it("returns parse_error when fields missing", () => {
    const raw = JSON.parse(
      readFileSync(join(fixturesDir, "missing-fields.json"), "utf8"),
    );
    const snap = parseCursorPeriodUsage(raw, { fetchedAt: FETCHED_AT });
    expect(snap.sourceStatus).toBe("error");
    expect(snap.diagnosticCode).toBe("parse_error");
  });
});

describe("classifyCursorError", () => {
  it("maps 401 to auth_required", () => {
    expect(classifyCursorError("cursor usage HTTP 401: unauthorized")).toBe(
      "auth_required",
    );
  });
});

describe("findCursorStateDb", () => {
  it("returns null when APPDATA missing candidate", () => {
    const r = findCursorStateDb({ APPDATA: "C:\\definitely-missing-qc-path" });
    expect(r.dbPath).toBeNull();
    expect(r.checkedPaths.length).toBe(1);
  });
});
