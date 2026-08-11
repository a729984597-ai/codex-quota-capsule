import type { AgentQuotaSnapshot } from "@quota-capsule/core";
import {
  isAccessTokenExpired,
  readCursorAuthTokens,
} from "./auth.js";
import { classifyCursorError } from "./diagnose.js";
import { refreshCursorAccessToken } from "./oauth.js";
import { parseCursorPeriodUsage } from "./parse.js";
import { findCursorStateDb } from "./paths.js";
import { fetchCursorPeriodUsage } from "./usage.js";

export type CursorUsageReadOptions = {
  fetchedAt?: Date;
  timeoutMs?: number;
  dbPath?: string;
  fetchImpl?: typeof fetch;
  /** Test seam: override "now" for expiry checks. */
  nowMs?: number;
};

export async function readCursorRateLimits(
  options: CursorUsageReadOptions = {},
): Promise<AgentQuotaSnapshot> {
  const fetchedAt = options.fetchedAt ?? new Date();
  const nowMs = options.nowMs ?? fetchedAt.getTime();
  const resolution = options.dbPath
    ? { dbPath: options.dbPath, checkedPaths: [options.dbPath] }
    : findCursorStateDb();

  if (!resolution.dbPath) {
    return errorSnapshot(
      fetchedAt,
      `cursor state.vscdb was not found. Checked: ${resolution.checkedPaths.join(", ")}`,
    );
  }

  let accessToken: string | null;
  let refreshToken: string | null;
  try {
    const tokens = await readCursorAuthTokens(resolution.dbPath);
    accessToken = tokens.accessToken;
    refreshToken = tokens.refreshToken;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorSnapshot(fetchedAt, `failed to read cursor token: ${message}`);
  }

  if (!accessToken && !refreshToken) {
    return errorSnapshot(
      fetchedAt,
      "cursorAuth/accessToken missing — Cursor may not be logged in",
    );
  }

  let didRefresh = false;
  let token = accessToken;

  if (!token || isAccessTokenExpired(token, nowMs)) {
    if (!refreshToken) {
      return errorSnapshot(
        fetchedAt,
        "cursor access token expired and refreshToken missing — Cursor may not be logged in",
      );
    }
    try {
      token = await refreshCursorAccessToken({
        refreshToken,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      });
      didRefresh = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorSnapshot(fetchedAt, message);
    }
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
    if (!didRefresh && refreshToken && isAuthFailure(message)) {
      try {
        token = await refreshCursorAccessToken({
          refreshToken,
          timeoutMs: options.timeoutMs,
          fetchImpl: options.fetchImpl,
        });
        const raw = await fetchCursorPeriodUsage({
          accessToken: token,
          timeoutMs: options.timeoutMs,
          fetchImpl: options.fetchImpl,
        });
        return parseCursorPeriodUsage(raw, { fetchedAt });
      } catch (retryError) {
        const retryMessage =
          retryError instanceof Error ? retryError.message : String(retryError);
        return errorSnapshot(fetchedAt, retryMessage);
      }
    }
    return errorSnapshot(fetchedAt, message);
  }
}

function isAuthFailure(message: string): boolean {
  return classifyCursorError(message) === "auth_required";
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
