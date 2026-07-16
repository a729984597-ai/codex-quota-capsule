import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy the portable (no-installer) build to the repo root for double-click use:
 *   ./Quota Capsule Beta.exe
 *   ./resources/
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(
  root,
  "apps",
  "windows",
  "src-tauri",
  "target",
  "release",
);
const srcExe = join(releaseDir, "quota-capsule-windows.exe");
const srcResources = join(releaseDir, "resources");
const destExe = join(root, "Quota Capsule Beta.exe");
const destResources = join(root, "resources");

if (!existsSync(srcExe)) {
  console.error(`missing release exe: ${srcExe}`);
  process.exit(1);
}
if (!existsSync(srcResources)) {
  console.error(`missing release resources: ${srcResources}`);
  process.exit(1);
}

cpSync(srcExe, destExe);
rmSync(destResources, { recursive: true, force: true });
mkdirSync(destResources, { recursive: true });
cpSync(srcResources, destResources, { recursive: true });

console.log(`portable app → ${destExe}`);
console.log(`portable resources → ${destResources}`);
