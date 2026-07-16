import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

/**
 * Stage refresh bridge (script + package dist + sql.js) into the Tauri resources
 * directory so a packaged .exe can spawn Node without the git checkout.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destRoot = join(root, "apps", "windows", "src-tauri", "resources");

function ensurePackageBuild() {
  const needed = [
    join(root, "packages", "core", "dist", "index.js"),
    join(root, "packages", "source-codex", "dist", "index.js"),
    join(root, "packages", "source-cursor", "dist", "index.js"),
  ];
  if (needed.every((p) => existsSync(p))) return;

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

for (const name of ["core", "source-codex", "source-cursor"]) {
  mkdirSync(join(destRoot, "packages", name), { recursive: true });
  cpSync(
    join(root, "packages", name, "dist"),
    join(destRoot, "packages", name, "dist"),
    { recursive: true },
  );
}

cpSync(
  join(root, "scripts", "refresh-once.mjs"),
  join(destRoot, "scripts", "refresh-once.mjs"),
);

console.log(`staged bridge resources → ${destRoot}`);
