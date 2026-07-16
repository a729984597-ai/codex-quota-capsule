import type { AgentQuotaSnapshot } from "@quota-capsule/core";
import { readCursorAccessToken } from "./auth.js";
import { classifyCursorError } from "./diagnose.js";
import { parseCursorPeriodUsage } from "./parse.js";
import { findCursorStateDb } from "./paths.js";
import { fetchCursorPeriodUsage } from "./usage.js";

export type CursorUsageReadOptions = {
  fetchedAt?: Date;
  timeoutMs?: number;
  dbPath?: string;
  fetchImpl?: typeof fetch;
};

export async function readCursorRateLimits(
  options: CursorUsageReadOptions = {},
): Promise<AgentQuotaSnapshot> {
  const fetchedAt = options.fetchedAt ?? new Date();
  const resolution = options.dbPath
    ? { dbPath: options.dbPath, checkedPaths: [options.dbPath] }
    : findCursorStateDb();

  if (!resolution.dbPath) {
    return errorSnapshot(
      fetchedAt,
      `cursor state.vscdb was not found. Checked: ${resolution.checkedPaths.join(", ")}`,
    );
  }

  let token: string | null;
  try {
    token = await readCursorAccessToken(resolution.dbPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorSnapshot(fetchedAt, `failed to read cursor token: ${message}`);
  }

  if (!token) {
    return errorSnapshot(
      fetchedAt,
      "cursorAuth/accessToken missing — Cursor may not be logged in",
    );
  }

  try {
    const raw = await fetchCursorPeriodUsage({
      accessToken: token,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    return parseCursorPeriodUsage(raw, { fetchedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorSnapshot(fetchedAt, message);
  }
}

function errorSnapshot(
  fetchedAt: Date,
  errorMessage: string,
): AgentQuotaSnapshot {
  return {
    provider: "cursor",
    sourceStatus: "error",
    fetchedAt,
    diagnosticCode: classifyCursorError(errorMessage),
    errorMessage,
  };
}
