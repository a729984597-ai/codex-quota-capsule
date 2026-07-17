import { createWriteStream, existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";

/**
 * Download official Node.js Windows x64 zip and stage `node.exe` into the Tauri
 * resources tree so packaged builds do not require a system Node install.
 *
 * Override version with NODE_BUNDLE_VERSION (e.g. 22.16.0).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = process.env.NODE_BUNDLE_VERSION || "22.16.0";
const ARCHIVE = `node-v${VERSION}-win-x64`;
const URL = `https://nodejs.org/dist/v${VERSION}/${ARCHIVE}.zip`;

const cacheRoot = join(root, ".cache", "node-runtime", ARCHIVE);
const cacheZip = join(root, ".cache", "node-runtime", `${ARCHIVE}.zip`);
const cacheExe = join(cacheRoot, ARCHIVE, "node.exe");

const destRoot = join(
  root,
  "apps",
  "windows",
  "src-tauri",
  "resources",
  "runtime",
  "node",
);
const destExe = join(destRoot, "node.exe");

function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

async function downloadZip() {
  if (existsSync(cacheZip) && existsSync(cacheExe)) {
    return;
  }
  console.log(`downloading Node ${VERSION} win-x64…`);
  ensureParent(cacheZip);
  const res = await fetch(URL);
  if (!res.ok || !res.body) {
    throw new Error(`download failed: ${res.status} ${res.statusText} (${URL})`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(cacheZip));

  rmSync(cacheRoot, { recursive: true, force: true });
  mkdirSync(cacheRoot, { recursive: true });
  const expand = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath '${cacheZip.replace(/'/g, "''")}' -DestinationPath '${cacheRoot.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: "inherit" },
  );
  if (expand.status !== 0) {
    throw new Error("failed to expand Node zip");
  }
  if (!existsSync(cacheExe)) {
    throw new Error(`node.exe missing after extract: ${cacheExe}`);
  }
}

async function main() {
  await downloadZip();
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(destRoot, { recursive: true });
  cpSync(cacheExe, destExe);
  console.log(`bundled Node ${VERSION} → ${destExe}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
