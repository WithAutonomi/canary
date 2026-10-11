// Packaging, from committed files only: no deployment, no network.
import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = [
  "404.html", "_headers", "app.js", "calendar.js", "data-source.json", "favicon.png", "format.js", "index.html",
  "schema.js", "styles.css",
  "fonts/IBMPlexMono-Medium.woff2", "fonts/IBMPlexMono-Regular.woff2", "fonts/Inter-Bold.woff2", "fonts/Inter-Regular.woff2",
  "licenses/IBMPlexMono-LICENSE.txt", "licenses/Inter-LICENSE.txt", "licenses/README.txt",
];
let dir;

function run(args) {
  return spawnSync(process.execPath, [join(root, "scripts/package-site.mjs"), ...args], { cwd: dir, encoding: "utf8" });
}

function listing(out) {
  const walk = path => readdirSync(path, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? walk(join(path, entry.name)) : [relative(out, join(path, entry.name))]);
  return walk(out).sort();
}

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "canary-package-"));
});

test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("build:pages ships the live data source and nothing else", () => {
  const result = run(["--data-source", join(root, "content/data-source.live.json"), "--out", "dist"]);
  expect(result.status, result.stderr).toBe(0);
  const out = join(dir, "dist");
  expect(listing(out)).toEqual([...site].sort());
  expect(JSON.parse(readFileSync(join(out, "data-source.json"), "utf8")))
    .toEqual({ index_url: "https://autonomi-canary-data.s3.eu-west-2.amazonaws.com/v1/index.json" });
  expect(readFileSync(join(out, "index.html"), "utf8")).not.toContain("noindex");
  expect(readFileSync(join(out, "_headers"), "utf8")).not.toContain("X-Robots-Tag");
});

test("build:preview ships the sample data, marked noindex", () => {
  const result = run(["--sample", "--out", "dist"]);
  expect(result.status, result.stderr).toBe(0);
  const out = join(dir, "dist");
  expect(listing(out)).toEqual([...site, "data/index.json", "data/prod-canary-04.json"].sort());
  expect(JSON.parse(readFileSync(join(out, "data-source.json"), "utf8"))).toEqual({ index_url: "data/index.json" });
  expect(readFileSync(join(out, "data/prod-canary-04.json")).equals(readFileSync(join(root, "content/sample/prod-canary-04.json")))).toBe(true);
  expect(readFileSync(join(out, "index.html"), "utf8")).toContain('<meta name="robots" content="noindex, nofollow">');
  expect(readFileSync(join(out, "_headers"), "utf8")).toMatch(/^\/\*\n {2}X-Robots-Tag: noindex, nofollow\n/);
});

test("the page's CSP allows only this site and the data bucket", () => {
  const html = readFileSync(join(root, "web/index.html"), "utf8");
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  expect(csp).toContain("connect-src 'self' https://autonomi-canary-data.s3.eu-west-2.amazonaws.com;");
  expect(csp).toContain("img-src 'self';");
  expect(csp).toContain("script-src 'self';");
  expect(csp).not.toContain("blob:");
  expect(csp).not.toContain("wasm-unsafe-eval");
});

test("requires exactly one data input", () => {
  for (const args of [[], ["--sample", "--data-source", join(root, "content/data-source.live.json")]]) {
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
  }
  expect(existsSync(join(dir, "dist"))).toBe(false);
});

test("refuses an invalid data source without creating output", () => {
  for (const source of [
    { index_url: "http://example.com/index.json" },
    { index_url: "data/index.json" },
    { index_url: "https://example.com/index.json", extra: true },
    { url: "https://example.com/index.json" },
  ]) {
    writeFileSync(join(dir, "source.json"), JSON.stringify(source));
    const result = run(["--data-source", "source.json"]);
    expect(result.status, JSON.stringify(source)).toBe(1);
    expect(result.stderr).toContain("Invalid data source");
  }
  expect(existsSync(join(dir, "dist"))).toBe(false);
});

test("never overwrites an existing output directory", () => {
  mkdirSync(join(dir, "dist"));
  writeFileSync(join(dir, "dist/keep"), "keep");
  const result = run(["--sample"]);
  expect(result.status).toBe(1);
  expect(readdirSync(join(dir, "dist"))).toEqual(["keep"]);
});

test("npm run build:pages is the documented command", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  expect(pkg.scripts["build:pages"]).toBe("node scripts/package-site.mjs --data-source content/data-source.live.json");
  expect(Object.keys(pkg.devDependencies)).toEqual(["@playwright/test"]);
  expect(pkg.dependencies).toBeUndefined();
});
