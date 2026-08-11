import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isAccessTokenExpired } from "../src/auth.ts";
import { classifyCursorError } from "../src/diagnose.ts";
import { refreshCursorAccessToken } from "../src/oauth.ts";
import { readCursorRateLimits } from "../src/read.ts";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/cursor-usage",
);

const PERIOD_OK = JSON.parse(
  readFileSync(join(fixturesDir, "period-ok.json"), "utf8"),
);

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeJwt(expSec: number): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "test", exp: expSec }),
  ).toString("base64url");
  return `${header}.${payload}.sig`;
}

function makeStateDb(tokens: {
  accessToken?: string | null;
  refreshToken?: string | null;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "qc-cursor-test-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "state.vscdb");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
  const insert = db.prepare(
    "INSERT INTO ItemTable (key, value) VALUES (?, ?)",
  );
  if (tokens.accessToken) {
    insert.run("cursorAuth/accessToken", tokens.accessToken);
  }
  if (tokens.refreshToken) {
    insert.run("cursorAuth/refreshToken", tokens.refreshToken);
  }
  db.close();
  return dbPath;
}

describe("isAccessTokenExpired", () => {
  it("is false when exp is in the future beyond skew", () => {
    const now = Date.parse("2026-08-11T02:00:00.000Z");
    const token = makeJwt(Math.floor(now / 1000) + 3600);
    expect(isAccessTokenExpired(token, now, 60_000)).toBe(false);
  });

  it("is true when exp is within skew window", () => {
    const now = Date.parse("2026-08-11T02:00:00.000Z");
    const token = makeJwt(Math.floor(now / 1000) + 30);
    expect(isAccessTokenExpired(token, now, 60_000)).toBe(true);
  });

  it("is true when exp is in the past", () => {
    const now = Date.parse("2026-08-11T02:00:00.000Z");
    const token = makeJwt(Math.floor(now / 1000) - 10);
    expect(isAccessTokenExpired(token, now)).toBe(true);
  });
});

describe("refreshCursorAccessToken", () => {
  it("returns access_token from oauth response", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          access_token: "fresh-access",
          shouldLogout: false,
        }),
        { status: 200 },
      );

    const token = await refreshCursorAccessToken({
      refreshToken: "refresh-1",
      fetchImpl,
    });
    expect(token).toBe("fresh-access");
  });

  it("throws auth error when shouldLogout is true", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          access_token: "",
          shouldLogout: true,
        }),
        { status: 200 },
      );

    await expect(
      refreshCursorAccessToken({
        refreshToken: "refresh-1",
        fetchImpl,
      }),
    ).rejects.toThrow(/shouldLogout/);
  });
});

describe("classifyCursorError", () => {
  it("maps shouldLogout refresh failure to auth_required", () => {
    expect(
      classifyCursorError(
        "cursor oauth refresh requires login (shouldLogout) — Cursor may not be logged in",
      ),
    ).toBe("auth_required");
  });
});

describe("readCursorRateLimits token refresh", () => {
  it("refreshes expired access token before usage fetch", async () => {
    const now = Date.parse("2026-08-11T02:00:00.000Z");
    const expired = makeJwt(Math.floor(now / 1000) - 120);
    const dbPath = makeStateDb({
      accessToken: expired,
      refreshToken: "refresh-ok",
    });

    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: makeJwt(Math.floor(now / 1000) + 3600),
            shouldLogout: false,
          }),
          { status: 200 },
        );
      }
      if (url.includes("GetCurrentPeriodUsage")) {
        return new Response(JSON.stringify(PERIOD_OK), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    const snap = await readCursorRateLimits({
      dbPath,
      fetchedAt: new Date(now),
      nowMs: now,
      fetchImpl,
    });

    expect(snap.sourceStatus).toBe("ok");
    expect(urls.some((u) => u.includes("/oauth/token"))).toBe(true);
    expect(urls.some((u) => u.includes("GetCurrentPeriodUsage"))).toBe(true);
  });

  it("retries usage once after 401 by refreshing", async () => {
    const now = Date.parse("2026-08-11T02:00:00.000Z");
    const validLooking = makeJwt(Math.floor(now / 1000) + 3600);
    const dbPath = makeStateDb({
      accessToken: validLooking,
      refreshToken: "refresh-ok",
    });

    let usageCalls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: makeJwt(Math.floor(now / 1000) + 7200),
            shouldLogout: false,
          }),
          { status: 200 },
        );
      }
      if (url.includes("GetCurrentPeriodUsage")) {
        usageCalls += 1;
        if (usageCalls === 1) {
          return new Response("unauthorized", { status: 401 });
        }
        return new Response(JSON.stringify(PERIOD_OK), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    const snap = await readCursorRateLimits({
      dbPath,
      fetchedAt: new Date(now),
      nowMs: now,
      fetchImpl,
    });

    expect(snap.sourceStatus).toBe("ok");
    expect(usageCalls).toBe(2);
  });

  it("returns auth_required when refresh says shouldLogout", async () => {
    const now = Date.parse("2026-08-11T02:00:00.000Z");
    const expired = makeJwt(Math.floor(now / 1000) - 120);
    const dbPath = makeStateDb({
      accessToken: expired,
      refreshToken: "refresh-dead",
    });

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        return new Response(
          JSON.stringify({ access_token: "", shouldLogout: true }),
          { status: 200 },
        );
      }
      return new Response("should not hit usage", { status: 500 });
    };

    const snap = await readCursorRateLimits({
      dbPath,
      fetchedAt: new Date(now),
      nowMs: now,
      fetchImpl,
    });

    expect(snap.sourceStatus).toBe("error");
    expect(snap.diagnosticCode).toBe("auth_required");
  });
});
