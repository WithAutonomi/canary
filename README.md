# Autonomi canary

The site at [canary.autonomi.com](https://canary.autonomi.com/). In August 2026
we uploaded 378 ordinary public files to the Autonomi network and left them
there; since then computers in London, New York and Singapore have tried to
download every one of them, in full, once an hour. This page shows that record
to anyone, refreshed daily, with every file independently checkable.

The page is static files. It reads one public dataset at load time, validates
it in full, and draws it: headline numbers, a per-location table, and a
calendar with one row per file and one column per day. If the data cannot be
loaded or does not match the schema, it says so and shows no numbers at all.
It makes no other network requests: no analytics, no third-party scripts, no
font CDN.

**Merging to `main` publishes the site.** Cloudflare Pages deploys `main` to
canary.autonomi.com automatically; other branches get preview URLs on
`<branch>.canary-dvl.pages.dev`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Build and run

Node 22 (20 or later works). Nothing but `@playwright/test`, for tests.

```sh
npm ci
npm run serve                # web/ on http://127.0.0.1:8080, reading live data
npm run serve -- --sample    # the same, reading the committed sample data
npm run build:pages          # dist/ for Cloudflare Pages, reading live data
npm run build:preview        # dist/ against the sample data, marked noindex
npm test                     # unit tests, then the page in four browsers
```

Port 8080 matters for `npm run serve`: the data bucket's CORS allows
`http://localhost:8080`, so open **http://localhost:8080/** (not 127.0.0.1) to
see live data locally.

`build:pages` and `build:preview` refuse to write into an existing directory;
pass `-- --out <new-dir>` for a second build.

## Layout

```
web/                      the site, as served
  index.html              the page; its fixed copy lives here
  app.js                  load, validate, render
  schema.js               schema version 1 validation
  calendar.js             the calendar and its cell titles
  format.js               numbers, dates, percentages, CSV
  styles.css, fonts/, licenses/, _headers, 404.html, favicon.png
content/
  data-source.live.json   where the live site reads its data
  sample/                 sample dataset, and a stale copy, for tests and review
scripts/
  package-site.mjs        builds dist/ from committed files only
  make-sample.mjs         regenerates content/sample/ (npm run sample)
  serve.mjs               local static server
  copy-fonts.mjs          refreshes web/fonts/ from the brand repository
tests/                    Playwright: *-unit.spec.js and unit.spec.js run in
                          Node; the rest run in Chromium, Firefox, WebKit and a
                          phone profile against the sample build
```

## The data contract

The dataset is written by `saorsa-deploy prod canary export`, documented in
[`deploy/README.md` → Publishing the public dataset](https://github.com/jacderida/saorsa-testnet-registry/blob/main/deploy/README.md#publishing-the-public-dataset-prod-canary-export)
in `saorsa-testnet-registry` (a private repository). That schema, version 1,
is the only contract between the exporter and this site.

**Where the page looks.** The build ships `data-source.json`:

```json
{"index_url": "https://autonomi-canary-data.s3.eu-west-2.amazonaws.com/v1/index.json"}
```

The page fetches that, then the index, then every series file the index names
(each a plain file name next to the index). Every fetch uses
`cache: "no-store"`. The page's Content Security Policy allows connections only
to its own origin and that bucket.

**`index.json`** lists the series:

```json
{
  "schema_version": 1,
  "generated_at": "2026-10-09T09:31:02Z",
  "series": [
    {
      "id": "prod-canary-04", "kind": "prod-canary", "title": "Canary 4",
      "path": "prod-canary-04.json",
      "generated_at": "2026-10-09T09:31:02Z", "data_to": "2026-10-09T08:03:12Z",
      "stale": false,
      "summary": { "...": "identical to the series file's summary object" }
    }
  ]
}
```

**`<series id>.json`** carries everything the page draws:

```json
{
  "schema_version": 1,
  "generated_at": "2026-10-09T09:31:02Z",
  "series": {
    "id": "prod-canary-04", "kind": "prod-canary", "title": "Canary 4",
    "uploaded_from": "2026-08-22", "uploaded_to": "2026-08-23",
    "first_probe_at": "2026-08-22T22:00:03Z", "data_to": "2026-10-09T08:03:12Z",
    "probe_interval_hours": 1,
    "vantages": [{ "id": "lon1", "label": "London" }, { "id": "nyc1", "label": "New York" }, { "id": "sgp1", "label": "Singapore" }]
  },
  "stale": false,
  "stale_reasons": [],
  "summary": {
    "files": 378, "bytes": 32162403640, "chunks": 9280, "initial_verification_ok": 378,
    "days_observed": 49, "files_never_unavailable": 378, "files_available_now": 378,
    "files_unavailable_now": 0, "episodes": { "total": 0, "recovered": 0, "ongoing": 0 },
    "smallest_bytes": 5277908, "largest_bytes": 485255912
  },
  "rates": {
    "all": { "ok": 0, "failed": 0, "inconclusive": 0, "rate": null },
    "30d": { "...": "same shape" }, "90d": { "...": "same shape" },
    "by_vantage": { "lon1": { "all": {}, "30d": {}, "90d": {} } }
  },
  "days": ["2026-08-22", "2026-08-23"],
  "files": [
    {
      "id": "6336b4b0-…", "name": "example.avi", "bytes": 36299308, "chunks": 13,
      "address": "<64 hex chars>", "source_url": "https://archive.org/download/…",
      "uploaded_at": "2026-08-22T21:38:59Z", "available_now": true,
      "cells": "GG",
      "failed_checks": { "2026-08-23": 1 },
      "episodes": [{ "from": "2026-09-01T12:00:00Z", "to": null, "chunk": "<64 hex chars>" }]
    }
  ]
}
```

**Rules the page relies on, and checks** (`web/schema.js`):

* `schema_version` is exactly `1` in both documents. Anything else is the error
  state, as is a missing series file or any malformed field. The page never
  shows partial numbers.
* `cells` has one character per entry of `days`: `G` (every conclusive check
  that day succeeded), `R` (a confirmed unavailability episode was open at
  some point that day) or `X` (no conclusive checks that day).
* `rate` is `ok / (ok + failed)`, or `null` when that is zero; `inconclusive`
  is never in a denominator. Every `by_vantage` entry, one per vantage, has the
  shape of `rates.all`.
* `failed_checks` and `episodes` are absent when empty. An episode's `to` is
  `null` while it is ongoing.
* Timestamps are UTC ending in `Z`; dates are `YYYY-MM-DD`; addresses are 64
  lowercase hex characters; `source_url` is http or https.
* Fields the page does not know are ignored. A change in meaning comes with a
  new `schema_version`, which this page refuses until it is updated.

**How the page presents it.** Percentages are shown to two decimals, rounded
down, from `ok` and `failed`: one failure in a million checks reads 99.99%,
never 100.00%. The page is "out of date" (the amber band) when the series says
`stale`, or its `generated_at` is more than 36 hours before the viewer's clock.
Times are shown in the viewer's zone; days are UTC, as in the data.

## Sample data

`content/sample/` is generated by `npm run sample` from a fixed seed, so two
runs are byte-identical (a unit test checks the committed copy is current). It
has 378 files of 5 MB to 485 MB over 49 days from three vantages, and on
purpose: two recovered episodes (red runs of 2 and 5 days), one ongoing, four
files with failed checks on green days, three grey days at the start for files
uploaded on the second day, and one inconclusive check. `content/sample/stale/`
is the same data marked stale, generated 40 hours before the tests' fixed
clock. The names and source links are invented and do not resolve.

## Fonts

Only Inter and IBM Plex Mono are self-hosted, under the SIL Open Font License
(`web/licenses/`). The brand's Method and FK Roman faces are licensed for use,
not redistribution, and must not be published in a public repository, so this
one does not carry them.
