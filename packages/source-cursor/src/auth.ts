import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ACCESS_TOKEN_KEY = "cursorAuth/accessToken";
const REFRESH_TOKEN_KEY = "cursorAuth/refreshToken";

export type CursorAuthTokens = {
  accessToken: string | null;
  refreshToken: string | null;
};

/**
 * Read Cursor access + refresh tokens from a copy of state.vscdb.
 * Uses Node's built-in sqlite (path open) so multi-GB DBs do not need to
 * fit in a single Buffer. Never logs tokens. Does not write back.
 */
export async function readCursorAuthTokens(
  dbPath: string,
): Promise<CursorAuthTokens> {
  const dir = mkdtempSync(join(tmpdir(), "quota-capsule-cursor-"));
  const copyPath = join(dir, "state.vscdb");
  try {
    copyFileSync(dbPath, copyPath);
    const db = new DatabaseSync(copyPath, { readOnly: true });
    try {
      return {
        accessToken: readTokenValue(db, ACCESS_TOKEN_KEY),
        refreshToken: readTokenValue(db, REFRESH_TOKEN_KEY),
      };
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Read Cursor access token from a copy of state.vscdb.
 * @deprecated Prefer readCursorAuthTokens so refresh can run when access expires.
 */
export async function readCursorAccessToken(
  dbPath: string,
): Promise<string | null> {
  const tokens = await readCursorAuthTokens(dbPath);
  return tokens.accessToken;
}

/** True when JWT `exp` is missing-parse fails → false (let the API decide). */
export function isAccessTokenExpired(
  token: string,
  nowMs: number = Date.now(),
  skewMs: number = 60_000,
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const json = Buffer.from(parts[1]!, "base64url").toString("utf8");
    const payload = JSON.parse(json) as { exp?: unknown };
    if (typeof payload.exp !== "number") return false;
    return payload.exp * 1000 <= nowMs + skewMs;
  } catch {
    return false;
  }
}

function readTokenValue(
  db: DatabaseSync,
  key: string,
): string | null {
  const row = db
    .prepare("SELECT value FROM ItemTable WHERE key = ?")
    .get(key) as { value?: unknown } | undefined;
  return typeof row?.value === "string" && row.value.length > 0
    ? row.value
    : null;
}
