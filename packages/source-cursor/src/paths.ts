import { existsSync } from "node:fs";
import { join } from "node:path";

export type CursorDbResolution = {
  dbPath: string | null;
  checkedPaths: string[];
};

export function findCursorStateDb(
  env: NodeJS.ProcessEnv = process.env,
): CursorDbResolution {
  const checkedPaths: string[] = [];
  const appData = env.APPDATA;
  if (!appData) {
    return { dbPath: null, checkedPaths };
  }

  const candidate = join(
    appData,
    "Cursor",
    "User",
    "globalStorage",
    "state.vscdb",
  );
  checkedPaths.push(candidate);
  if (existsSync(candidate)) {
    return { dbPath: candidate, checkedPaths };
  }
  return { dbPath: null, checkedPaths };
}
