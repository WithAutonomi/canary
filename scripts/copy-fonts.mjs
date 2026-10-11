// Self-host the brand typefaces so the page never calls a font CDN.
//
// The fonts come from the Autonomi brand repository, which is the source of
// truth for them; they are not fetched from npm, and the values in
// web/styles.css follow that repository's tokens.
//
//   BRAND_DIR  checkout of github.com/WithAutonomi/brand (default: ../brand)
//
// Optional refresh of the four WOFF2 files committed here. This repository is
// public, so it carries only the open-licence cuts: Inter and IBM Plex Mono,
// both OFL. The brand's Method and FK Roman are commercial fonts that must not
// be published in a public repository, so this script never copies them.
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brand = resolve(process.env.BRAND_DIR ?? join(root, "../brand"));

// Only the cuts the page actually uses, as the brand repository asks.
const fonts = [
  "inter/Inter-Regular.woff2",
  "inter/Inter-Bold.woff2",
  "ibm-plex-mono/IBMPlexMono-Regular.woff2",
  "ibm-plex-mono/IBMPlexMono-Medium.woff2",
];

if (!(await stat(join(brand, "fonts")).catch(() => null))) {
  console.error(`No brand fonts at ${brand}/fonts.`);
  console.error("Clone github.com/WithAutonomi/brand next to this repository, or set BRAND_DIR.");
  process.exit(1);
}

await mkdir(join(root, "web/fonts"), { recursive: true });
for (const source of fonts) {
  const name = source.split("/").pop();
  await copyFile(join(brand, "fonts", source), join(root, "web/fonts", name));
  console.log(`web/fonts/${name}`);
}
