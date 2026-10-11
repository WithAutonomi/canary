// Serve the page its data from the committed sample, whatever the build
// holds, and refuse every request that would leave the test server.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export { TEST_CLOCK, SERIES_ID } from "../../scripts/make-sample.mjs";

export function sample(variant = "") {
  const dir = join(root, "content/sample", variant);
  return {
    index: JSON.parse(readFileSync(join(dir, "index.json"), "utf8")),
    series: JSON.parse(readFileSync(join(dir, "prod-canary-04.json"), "utf8")),
  };
}

const json = value => ({ status: 200, contentType: "application/json", body: JSON.stringify(value) });

// No test touches the network: anything not on the local test server fails.
export async function offline(page) {
  await page.route(url => url.hostname !== "127.0.0.1" && url.hostname !== "localhost", route => route.abort());
}

// Serve data files by name: { "index.json": value, "prod-canary-04.json": value }.
// A null value is a 404.
export async function serveData(page, files) {
  await page.route("**/data/*.json", route => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    if (!(name in files) || files[name] === null) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill(json(files[name]));
  });
}

export async function serveSample(page, variant = "") {
  const { index, series } = sample(variant);
  await serveData(page, { "index.json": index, "prod-canary-04.json": series });
}
