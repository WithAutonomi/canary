# Git-connected Cloudflare Pages deployment

The host is Cloudflare Pages project `canary`, connected to
[WithAutonomi/canary](https://github.com/WithAutonomi/canary) and serving
`https://canary.autonomi.com/`. Production follows `main` with automatic
deployments on: **every merge to main publishes the site within minutes.**
Other branches get preview URLs at `<branch>.canary-dvl.pages.dev`. No
account, project, DNS record or deployment is created by these scripts or
local tests.

## What Cloudflare builds

```sh
npm run build:pages
```

This is the Pages build command. It needs Node 20+ and nothing else (`npm ci`
installs only the test runner), and builds `dist/` from committed files only:

| Input | What it is |
| --- | --- |
| `web/` (selected files) | The page, its scripts and styles, four fonts, the fonts' licences and host settings |
| `content/data-source.live.json` | Where the page reads its data: `https://autonomi-canary-data.s3.eu-west-2.amazonaws.com/v1/index.json` |

The packager checks that the data source is exactly `{"index_url": "https://…"}`
and writes it to `dist/data-source.json`. The dataset itself is not part of the
build: the page fetches it in the visitor's browser on every load, so a new
export shows without a deploy.

Existing `dist/` is never overwritten. For another local build use a fresh
directory, for example `npm run build:pages -- --out dist-review`. Do not commit
generated output.

## Sample-data preview

```sh
npm run build:preview
```

The same site, shipping `content/sample/` under `data/` and pointing
`data-source.json` at it, with a `noindex` meta tag and `X-Robots-Tag` header.
It is what the page tests run against, and is useful for reviewing the design
while the bucket is empty. It is not a production fallback.

## Data and CORS

The page reads `index.json` and the series files from the
`autonomi-canary-data` bucket in `eu-west-2`, written daily by
`saorsa-deploy prod canary export` (see the README's data contract). The
bucket's CORS allows `https://canary.autonomi.com`, `https://*.pages.dev` (S3
matches across subdomain labels, so branch previews load live data) and
`http://localhost:8080` for `npm run serve`. The page's meta Content Security
Policy allows `connect-src` to its own origin and that bucket only.

If the bucket is empty or unreachable, the page shows its error state: a grey
panel saying the data could not be loaded, with a link to the index. That is
the expected result on a preview built before the first export.

## Static serving

`web/_headers`, copied into the bundle root, adds anti-framing policy,
`X-Frame-Options: DENY`, `nosniff` and `Referrer-Policy: no-referrer`, and sets
the WOFF2 content type. The meta Content Security Policy in `index.html`
applies alongside it: scripts, styles, fonts and images from the page's own
origin only.

`404.html` prevents Pages' default single-page-app fallback from returning the
page for missing files. No Pages Functions or Cloudflare Workers are used. Keep
Pages' standard ETag/revalidation and compression; do not add cache rules that
leave the unversioned scripts stale after an update.

## Cloudflare settings

| Setting | Value |
| --- | --- |
| Project | `canary` (`canary-dvl.pages.dev`), Git integration with `WithAutonomi/canary` |
| Build command | `npm run build:pages` |
| Build output directory | `dist` |
| Root directory | Repository root; leave the override blank |
| Environment variable | `NODE_VERSION` = `22` |
| Production branch | `main`, automatic deployments on |
| Preview branches | All non-production branches |
| Custom domain | `canary.autonomi.com`, DNS record created by Pages in the `autonomi.com` zone |

Cloudflare features that inject scripts (Rocket Loader, Email Obfuscation, Web
Analytics, Zaraz) would be blocked by the page's Content Security Policy or
break it. Leave them off for this hostname, and do not enable Web Analytics on
the Pages project.

These are external host settings, not something this repository can enforce.
Use repository branch protection for review policy, since merging is publishing.

## Verify and retain rollback

After each production deployment:

```sh
curl -I https://canary.autonomi.com/
curl -s https://canary.autonomi.com/data-source.json
curl -I https://canary.autonomi.com/fonts/Inter-Regular.woff2
curl -I https://canary.autonomi.com/missing-asset-check.json
```

Expect HTTPS, anti-framing/nosniff headers, no `X-Robots-Tag`, the live index
URL in `data-source.json`, `font/woff2`, and a genuine 404 for the missing path.
Then load the page in a browser: the tiles should show the latest export, the
freshness line should name a time within the last day, and the console should
be free of errors.

Rollback: in Pages → `canary` → Deployments, roll back to the previous
production deployment, then revert the offending merge on `main` so the next
merge does not reintroduce it.
