import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * This environment cannot traverse Windows junctions created by npm workspaces
 * (reparse points resolve as empty). Copy workspace packages into node_modules
 * so Node/tsc can resolve @quota-capsule/*.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destRoot = join(root, "node_modules", "@quota-capsule");
const packages = ["core", "source-codex", "source-cursor"];

mkdirSync(destRoot, { recursive: true });

for (const name of packages) {
  const src = join(root, "packages", name);
  const dest = join(destRoot, name);
  if (!existsSync(src)) continue;
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, {
    recursive: true,
    filter: (path) => !path.includes(`${name}\\node_modules`) && !path.includes(`${name}/node_modules`),
  });
  console.log(`synced @quota-capsule/${name}`);
}
