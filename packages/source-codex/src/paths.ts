import path from "node:path";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";

export function codexPathCandidates(
  envPath: string = process.env.PATH ?? "",
  homeDirectory: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const sep = platform === "win32" ? ";" : ":";
  const pathEntries = envPath.split(sep).filter(Boolean);

  const explicit: string[] =
    platform === "win32"
      ? [
          join(homeDirectory, "AppData", "Roaming", "npm", "codex.cmd"),
          join(homeDirectory, "AppData", "Roaming", "npm", "codex.exe"),
          join(homeDirectory, "AppData", "Roaming", "npm", "codex"),
          join(homeDirectory, ".local", "bin", "codex.cmd"),
          join(homeDirectory, ".local", "bin", "codex.exe"),
          join(homeDirectory, ".local", "bin", "codex"),
          join(
            homeDirectory,
            ".codex",
            "packages",
            "standalone",
            "current",
            "bin",
            "codex.cmd",
          ),
          join(
            homeDirectory,
            ".codex",
            "packages",
            "standalone",
            "current",
            "bin",
            "codex.exe",
          ),
          join(
            homeDirectory,
            ".codex",
            "packages",
            "standalone",
            "current",
            "bin",
            "codex",
          ),
        ]
      : [
          join(homeDirectory, ".local", "bin", "codex"),
          join(
            homeDirectory,
            ".codex",
            "packages",
            "standalone",
            "current",
            "bin",
            "codex",
          ),
          "/opt/homebrew/bin/codex",
          "/usr/local/bin/codex",
          "/usr/bin/codex",
        ];

  const fromPath =
    platform === "win32"
      ? pathEntries.flatMap((entry) => [
          join(entry, "codex.cmd"),
          join(entry, "codex.exe"),
          join(entry, "codex"),
        ])
      : pathEntries.map((entry) => join(entry, "codex"));

  return [...new Set([...explicit, ...fromPath])];
}

export async function findCodexPath(
  envPath?: string,
  homeDirectory?: string,
  platform?: NodeJS.Platform,
): Promise<{ codexPath: string | null; checkedPaths: string[] }> {
  const checkedPaths = codexPathCandidates(envPath, homeDirectory, platform);

  for (const candidate of checkedPaths) {
    try {
      await access(candidate, constants.F_OK);
      return { codexPath: candidate, checkedPaths };
    } catch {
      // Keep checking the remaining candidates.
    }
  }

  return { codexPath: null, checkedPaths };
}
