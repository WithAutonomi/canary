// The site the page tests run against: npm run build:preview, packaged into a
// fresh temporary directory, then served as built. Started by Playwright's
// webServer (playwright.config.js); the directory is removed on exit.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = mkdtempSync(join(tmpdir(), "canary-preview-"));
const out = join(dir, "dist");
const build = spawnSync(process.execPath, [join(root, "scripts/package-site.mjs"), "--sample", "--out", out], { encoding: "utf8" });
if (build.status !== 0) {
  console.error(build.stderr || build.stdout);
  process.exit(1);
}
const cleanup = () => rmSync(dir, { recursive: true, force: true });
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));

process.env.ROOT = out;
process.env.PORT ??= "35180";
await import("../../scripts/serve.mjs");
