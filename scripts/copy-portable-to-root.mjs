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
const fallbackExe = join(root, "Quota Capsule Beta-0.1.0.exe");

if (!existsSync(srcExe)) {
  console.error(`missing release exe: ${srcExe}`);
  process.exit(1);
}
if (!existsSync(srcResources)) {
  console.error(`missing release resources: ${srcResources}`);
  process.exit(1);
}

let portableExe = destExe;
try {
  cpSync(srcExe, destExe);
} catch (error) {
  // A running portable build keeps its image locked on Windows. Keep the
  // build useful by writing a versioned sibling instead of leaving old
  // bridge resources beside a freshly built executable.
  cpSync(srcExe, fallbackExe);
  portableExe = fallbackExe;
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`could not replace running portable app; wrote ${fallbackExe}: ${reason}`);
}
try {
  rmSync(destResources, { recursive: true, force: true });
  mkdirSync(destResources, { recursive: true });
} catch (error) {
  // The running portable app can keep its resource directory open. Merging
  // still safely refreshes every packaged bridge/runtime file in place.
  mkdirSync(destResources, { recursive: true });
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`could not replace running resource directory; merging files: ${reason}`);
}
cpSync(srcResources, destResources, { recursive: true });

console.log(`portable app → ${portableExe}`);
console.log(`portable resources → ${destResources}`);
