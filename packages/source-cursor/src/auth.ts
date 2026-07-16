import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ACCESS_TOKEN_KEY = "cursorAuth/accessToken";

/**
 * Read Cursor access token from a copy of state.vscdb.
 * Uses Node's built-in sqlite (path open) so multi-GB DBs do not need to
 * fit in a single Buffer. Never logs the token. Does not write back.
 */
export async function readCursorAccessToken(
  dbPath: string,
): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), "quota-capsule-cursor-"));
  const copyPath = join(dir, "state.vscdb");
  try {
    copyFileSync(dbPath, copyPath);
    const db = new DatabaseSync(copyPath, { readOnly: true });
    try {
      const row = db
        .prepare("SELECT value FROM ItemTable WHERE key = ?")
        .get(ACCESS_TOKEN_KEY) as { value?: unknown } | undefined;
      return typeof row?.value === "string" && row.value.length > 0
        ? row.value
        : null;
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
