import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

/**
 * Stage refresh bridge (script + package dist) into the Tauri resources
 * directory so a packaged .exe can spawn Node without the git checkout.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destRoot = join(root, "apps", "windows", "src-tauri", "resources");

function ensurePackageBuild() {
  const coreIndex = join(root, "packages", "core", "dist", "index.js");
  const sourceIndex = join(root, "packages", "source-codex", "dist", "index.js");
  if (existsSync(coreIndex) && existsSync(sourceIndex)) return;

  console.log("package dist missing; running npm run build…");
  const result = spawnSync("npm", ["run", "build"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

ensurePackageBuild();

rmSync(destRoot, { recursive: true, force: true });
mkdirSync(join(destRoot, "scripts"), { recursive: true });
mkdirSync(join(destRoot, "packages", "core"), { recursive: true });
mkdirSync(join(destRoot, "packages", "source-codex"), { recursive: true });

cpSync(
  join(root, "scripts", "refresh-once.mjs"),
  join(destRoot, "scripts", "refresh-once.mjs"),
);
cpSync(join(root, "packages", "core", "dist"), join(destRoot, "packages", "core", "dist"), {
  recursive: true,
});
cpSync(
  join(root, "packages", "source-codex", "dist"),
  join(destRoot, "packages", "source-codex", "dist"),
  { recursive: true },
);

console.log(`staged bridge resources → ${destRoot}`);
