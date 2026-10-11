// Minimal static file server for local work. Production hosting is Cloudflare
// Pages; nothing here is part of the product.
//
//   npm run serve                 web/ on http://127.0.0.1:8080 with live data
//   npm run serve -- --sample     web/ with the committed sample data
//   ROOT=<dir> npm run serve      any built directory, as it is (e.g. dist/)
//
// Port 8080 matters: the data bucket's CORS allows http://localhost:8080, so a
// browser on localhost:8080 can load live data from it.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(process.env.ROOT ?? join(repo, "web"));
const port = Number(process.env.PORT ?? 8080);
const host = process.env.BIND ?? "127.0.0.1";
const sample = process.argv.includes("--sample");

// Serving web/ itself: supply the data source the packager would ship.
const overlay = process.env.ROOT ? {} : sample
  ? { "data-source.json": Buffer.from('{"index_url": "data/index.json"}\n'), "data/": join(repo, "content/sample") }
  : { "data-source.json": join(repo, "content/data-source.live.json") };

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function inside(base, path) {
  const file = resolve(join(base, path));
  return file === base || file.startsWith(base + sep) ? file : null;
}

async function locate(path) {
  if (typeof overlay[path] === "string") return { file: overlay[path] };
  if (Buffer.isBuffer(overlay[path])) return { body: overlay[path], file: path };
  if (overlay["data/"] && path.startsWith("data/")) return { file: inside(overlay["data/"], path.slice(5)) };
  let file = inside(root, path);
  if (file && (await stat(file).catch(() => null))?.isDirectory()) file = join(file, "index.html");
  return { file };
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    const { file, body } = await locate(path);
    if (!file) {
      response.writeHead(403).end();
      return;
    }
    const contents = body ?? await readFile(file);
    response.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    response.end(contents);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  }
}).listen(port, host, () => console.log(`serving ${root} on http://${host}:${port}${sample ? " with sample data" : ""}`));
