// Assemble the site from committed files only; never upload or deploy.
//
//   --data-source <file>   ship that file as data-source.json: the page reads
//                          its data from the index_url it names (build:pages)
//   --sample               ship the committed sample data under data/ and point
//                          data-source.json at it, marked noindex (build:preview)
//   --out <dir>            a new output directory (default: dist)
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { validateIndex, validateSeries } from "../web/schema.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "web");
const licenceFiles = ["licenses/README.txt", "licenses/Inter-LICENSE.txt", "licenses/IBMPlexMono-LICENSE.txt"];
const publicFiles = [
  "index.html", "styles.css", "app.js", "calendar.js", "format.js", "schema.js", "favicon.png",
  "_headers", "404.html",
  "fonts/Inter-Regular.woff2", "fonts/Inter-Bold.woff2",
  "fonts/IBMPlexMono-Regular.woff2", "fonts/IBMPlexMono-Medium.woff2", ...licenceFiles,
];
const sampleDir = join(root, "content/sample");

function replaceExpected(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(`Source changed: expected exactly one ${before}`);
  return text.replace(before, after);
}

// The data source must be exactly { "index_url": "https://…" }.
function validateDataSource(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== 1 || typeof value.index_url !== "string") {
    throw new Error('Invalid data source: expected exactly {"index_url": "https://…"}.');
  }
  let url;
  try {
    url = new URL(value.index_url);
  } catch {
    throw new Error("Invalid data source: index_url is not an absolute URL.");
  }
  if (url.protocol !== "https:") throw new Error("Invalid data source: index_url must be https.");
  return { index_url: url.href };
}

try {
  const { values } = parseArgs({
    options: {
      "data-source": { type: "string" },
      sample: { type: "boolean", default: false },
      out: { type: "string", default: "dist" },
    },
  });
  if (values.sample === (values["data-source"] !== undefined) || !values.out) {
    throw new Error("Usage: node scripts/package-site.mjs (--data-source <data-source.json> | --sample) [--out <new-output-dir>]");
  }

  // Read and check every input before creating any output.
  const files = [];
  if (values.sample) {
    const index = validateIndex(JSON.parse(await readFile(join(sampleDir, "index.json"), "utf8")));
    files.push(["data/index.json", await readFile(join(sampleDir, "index.json"))]);
    for (const entry of index.series) {
      const contents = await readFile(join(sampleDir, entry.path));
      validateSeries(JSON.parse(contents), entry.id);
      files.push([`data/${entry.path}`, contents]);
    }
    files.push(["data-source.json", `${JSON.stringify({ index_url: "data/index.json" }, null, 2)}\n`]);
  } else {
    const source = validateDataSource(JSON.parse(await readFile(resolve(values["data-source"]), "utf8")));
    files.push(["data-source.json", `${JSON.stringify(source, null, 2)}\n`]);
  }

  for (const name of publicFiles) {
    const source = join(web, name);
    const info = await stat(source);
    if (!info.isFile()) throw new Error(`Not a file: ${source}`);
    if (name.startsWith("licenses/") && info.size === 0) throw new Error(`Empty licence or notice file: ${source}`);
    let contents = await readFile(source);
    // The sample build is for review and tests: keep it out of search results.
    if (values.sample && name === "index.html") {
      contents = replaceExpected(contents.toString(), "<title>Autonomi canary</title>",
        '<title>Sample data — Autonomi canary</title>\n  <meta name="robots" content="noindex, nofollow">');
    }
    if (values.sample && name === "_headers") {
      contents = replaceExpected(contents.toString(), "/*\n", "/*\n  X-Robots-Tag: noindex, nofollow\n");
    }
    files.push([name, contents]);
  }

  const out = resolve(values.out);
  // Non-recursive mkdir refuses any existing destination, including symlinks.
  await mkdir(out);
  for (const dir of ["fonts", "licenses", ...(values.sample ? ["data"] : [])]) await mkdir(join(out, dir));
  for (const [name, contents] of files) await writeFile(join(out, name), contents, { flag: "wx" });
  console.log(`Packaged ${files.length} files in ${out}. No deployment performed.`);
} catch (error) {
  console.error(`Packaging failed: ${error.message}`);
  process.exitCode = 1;
}
