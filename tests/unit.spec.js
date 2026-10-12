// Pure functions and committed data, in Node: no browser, no network.
import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cellTitle, gapReasons, missingChunks, tryLink } from "../web/calendar.js";
import {
  filesCsv, formatBytes, formatChecks, formatDate, formatDateTime, formatMonthYear, formatRate,
  isStale, joinList, percentSucceeded, rateDecimals,
} from "../web/format.js";
import { SchemaError, seriesUrl, validateIndex, validateSeries } from "../web/schema.js";
import { TEST_CLOCK, sample } from "./ci/routes.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clone = value => structuredClone(value);

test.describe("schema", () => {
  for (const variant of ["", "stale"]) {
    test(`accepts the ${variant || "normal"} sample pair`, () => {
      const { index, series } = sample(variant);
      expect(() => validateIndex(index)).not.toThrow();
      expect(() => validateSeries(series, index.series[0].id)).not.toThrow();
      expect(index.series[0].summary).toEqual(series.summary);
    });
  }

  test("the sample has the states it promises", () => {
    const { series } = sample();
    expect(series.files).toHaveLength(378);
    expect(series.days).toHaveLength(49);
    expect(series.series.vantages.map(v => v.label)).toEqual(["London", "New York", "Singapore"]);
    expect(Math.min(...series.files.map(f => f.bytes))).toBeGreaterThanOrEqual(5_000_000);
    expect(Math.max(...series.files.map(f => f.bytes))).toBeLessThanOrEqual(485_255_912);
    const runs = series.files.flatMap(f => f.cells.match(/R+/g) ?? []).map(run => run.length);
    const recovered = series.files.filter(f => f.episodes?.some(e => e.to !== null));
    const ongoing = series.files.filter(f => f.episodes?.some(e => e.to === null));
    expect(recovered.map(f => f.cells.match(/R+/)[0].length).sort()).toEqual([2, 5]);
    expect(ongoing).toHaveLength(1);
    expect(ongoing[0].available_now).toBe(false);
    expect(runs).toHaveLength(3);
    const failed = series.files.filter(f => f.failed_checks);
    expect(failed).toHaveLength(4);
    for (const file of failed) {
      for (const day of Object.keys(file.failed_checks)) expect(file.cells[series.days.indexOf(day)]).toBe("G");
    }
    const secondDay = series.files.filter(f => f.uploaded_at.startsWith(series.series.uploaded_to));
    expect(secondDay.length).toBeGreaterThan(0);
    for (const file of secondDay) expect(file.cells.slice(0, 4)).toMatch(/^XXX[GR]$/);
    // A two-day gap in the checking: X for every file, and a reason for each
    // of the sample's grey days.
    expect(series.gaps.map(gap => [gap.from, gap.to]))
      .toEqual([["2026-08-23", "2026-08-24"], ["2026-09-29", "2026-09-30"]]);
    for (const day of ["2026-09-29", "2026-09-30"]) {
      const column = series.days.indexOf(day);
      expect(new Set(series.files.map(f => f.cells[column]))).toEqual(new Set(["X"]));
    }
    for (const file of series.files) {
      for (const [i, day] of series.days.entries()) {
        if (file.cells[i] !== "X") continue;
        const explained = day < file.uploaded_at.slice(0, 10)
          || gapReasons(series.gaps, day, series.series.vantages).length > 0;
        expect(explained, `${file.name} ${day}`).toBe(true);
      }
    }
    expect(series.rates.all.inconclusive).toBe(1);
    for (const key of ["all", "30d", "90d"]) expect(series.rates[key].rate).not.toBeNull();
  });

  test("the stale sample differs only where it says", () => {
    const normal = sample().series;
    const stale = sample("stale").series;
    expect(stale.stale).toBe(true);
    expect(stale.stale_reasons).toEqual(["no_recent_probes"]);
    expect(Date.parse(TEST_CLOCK) - Date.parse(stale.generated_at)).toBe(40 * 60 * 60 * 1000);
    const strip = value => ({ ...value, generated_at: null, stale: null, stale_reasons: null, series: { ...value.series, data_to: null } });
    expect(strip(stale)).toEqual(strip(normal));
  });

  test("refuses anything else", () => {
    const { index, series } = sample();
    const breaks = [
      [index, i => { i.schema_version = 2; }, validateIndex],
      [index, i => { i.series = []; }, validateIndex],
      [index, i => { i.series[0].path = "../secret.json"; }, validateIndex],
      [index, i => { i.series[0].path = "https://evil.example/x.json"; }, validateIndex],
      [index, i => { delete i.series[0].summary.files; }, validateIndex],
      [series, s => { s.schema_version = "1"; }, validateSeries],
      [series, s => { s.files[0].cells = s.files[0].cells.slice(1); }, validateSeries],
      [series, s => { s.files[0].cells = `Y${s.files[0].cells.slice(1)}`; }, validateSeries],
      [series, s => { s.files[0].address = "AB".repeat(32); }, validateSeries],
      [series, s => { s.files[0].source_url = "javascript:alert(1)"; }, validateSeries],
      [series, s => { s.files[0].failed_checks = {}; }, validateSeries],
      [series, s => { s.files[0].episodes = []; }, validateSeries],
      [series, s => { s.files.pop(); }, validateSeries],
      [series, s => { s.rates.all.rate = null; }, validateSeries],
      [series, s => { delete s.rates.by_vantage.nyc1; }, validateSeries],
      [series, s => { s.generated_at = "2026-10-09T09:31:02+01:00"; }, validateSeries],
      [series, s => { s.days[1] = s.days[0]; }, validateSeries],
      [series, s => { s.series.uploaded_from = "2026-02-30"; }, validateSeries],
      [series, s => { s.gaps = []; }, validateSeries],
      [series, s => { s.gaps[0].reason = ""; }, validateSeries],
      [series, s => { delete s.gaps[0].reason; }, validateSeries],
      [series, s => { s.gaps[0].to = "2026-08-22"; }, validateSeries],
      [series, s => { s.gaps[0].from = "2026-08-23T00:00:00Z"; }, validateSeries],
      [series, s => { s.gaps[0].vantages = []; }, validateSeries],
      [series, s => { s.gaps[0].vantages = ["mars1"]; }, validateSeries],
      [series, s => { s.gaps = {}; }, validateSeries],
    ];
    for (const [original, mutate, validate] of breaks) {
      const value = clone(original);
      mutate(value);
      expect(() => validate(value), mutate.toString()).toThrow(SchemaError);
    }
    expect(() => validateSeries(series, "prod-canary-05")).toThrow(SchemaError);
  });

  test("gaps are optional, and may name vantages", () => {
    const { series, index } = sample();
    const without = clone(series);
    delete without.gaps;
    expect(() => validateSeries(without, index.series[0].id)).not.toThrow();
    const scoped = clone(series);
    scoped.gaps[0].vantages = ["lon1", "nyc1"];
    expect(() => validateSeries(scoped, index.series[0].id)).not.toThrow();
  });

  test("resolves series files beside the index only", () => {
    expect(seriesUrl("https://bucket.example/v1/index.json", "prod-canary-04.json"))
      .toBe("https://bucket.example/v1/prod-canary-04.json");
    expect(() => seriesUrl("https://bucket.example/v1/index.json", "//evil.example/a.json")).toThrow(SchemaError);
  });
});

test.describe("format", () => {
  test("bytes", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(999)).toBe("999 bytes");
    expect(formatBytes(5277908)).toBe("5.28 MB");
    expect(formatBytes(36299308)).toBe("36.3 MB");
    expect(formatBytes(485255912)).toBe("485 MB");
    expect(formatBytes(999_600_000)).toBe("1.00 GB");
    expect(formatBytes(32162403640)).toBe("32.2 GB");
  });

  test("percentages round down, and never count inconclusive checks", () => {
    expect(percentSucceeded({ ok: 0, failed: 0, inconclusive: 5 })).toBeNull();
    expect(formatRate({ ok: 0, failed: 0, inconclusive: 5 })).toBe("no checks yet");
    expect(formatRate({ ok: 10, failed: 0, inconclusive: 0 })).toBe("100.00%");
    expect(formatRate({ ok: 2, failed: 1, inconclusive: 100 })).toBe("66.66%");
    expect(formatRate({ ok: 0, failed: 3, inconclusive: 0 })).toBe("0.00%");
    expect(formatRate({ ok: 435559, failed: 2, inconclusive: 13 }, 4)).toBe("99.9995%");
    expect(formatRate({ ok: 0, failed: 3, inconclusive: 0 }, 4)).toBe("0.0000%");
    // Two decimals hid this entirely: it used to read 99.99%.
    expect(formatRate({ ok: 435559, failed: 2, inconclusive: 13 }, 2)).toBe("99.99%");
    // Only a record with no failures at all reaches 100.
    expect(formatRate({ ok: 999_999, failed: 1 }, 6)).toBe("99.999900%");
    expect(formatRate({ ok: 999_999, failed: 0 }, 6)).toBe("100.000000%");
    // An exact figure is not floored away by a floating-point hair.
    expect(percentSucceeded({ ok: 3, failed: 7 }, 4)).toBe("30.0000");
    expect(percentSucceeded({ ok: 1, failed: 4 }, 4)).toBe("20.0000");
    // Integer arithmetic past 2^53: ok * 100 * 10 ** 6 overflows a double.
    expect(percentSucceeded({ ok: 100_000_000, failed: 1 }, 6)).toBe("99.999999");
  });

  test("decimal places follow the smallest sample behind any rate shown", () => {
    // One check in N is worth 100/N percent; nothing finer is justified.
    expect(rateDecimals([])).toBe(2);
    expect(rateDecimals([{ ok: 0, failed: 0 }])).toBe(2);
    expect(rateDecimals([{ ok: 100, failed: 0 }])).toBe(2);
    expect(rateDecimals([{ ok: 9_000, failed: 1_000 }])).toBe(2);
    expect(rateDecimals([{ ok: 435_559, failed: 2 }])).toBe(4);
    expect(rateDecimals([{ ok: 1_000_000, failed: 0 }])).toBe(4);
    expect(rateDecimals([{ ok: 1_000_001, failed: 0 }])).toBe(5);
    // The smallest sample sets it; windows with no conclusive checks do not.
    expect(rateDecimals([{ ok: 20_000_000, failed: 0 }, { ok: 0, failed: 0 }, { ok: 435_559, failed: 2 }])).toBe(4);
    // Clamped: no amount of data earns a seventh decimal.
    expect(rateDecimals([{ ok: 10 ** 15, failed: 0 }])).toBe(6);
  });

  test("the counts behind a rate", () => {
    expect(formatChecks({ ok: 0, failed: 0, inconclusive: 5 })).toBeNull();
    expect(formatChecks({ ok: 435_559, failed: 2, inconclusive: 13 })).toBe("2 failed of 435,561 conclusive checks");
    expect(formatChecks({ ok: 1, failed: 0 })).toBe("0 failed of 1 conclusive check");
    expect(formatChecks({ ok: 0, failed: 1 })).toBe("1 failed of 1 conclusive check");
  });

  test("dates", () => {
    expect(formatDateTime("2026-10-09T09:31:02Z", "Europe/London")).toBe("9 Oct 2026, 10:31 BST");
    expect(formatDateTime("2026-10-09T09:31:02Z", "UTC")).toBe("9 Oct 2026, 09:31 UTC");
    expect(formatDate("2026-08-22")).toBe("22 August 2026");
    expect(formatMonthYear("2026-08-22")).toBe("August 2026");
  });

  test("lists", () => {
    expect(joinList(["London"])).toBe("London");
    expect(joinList(["London", "New York"])).toBe("London and New York");
    expect(joinList(["London", "New York", "Singapore"])).toBe("London, New York and Singapore");
  });

  test("staleness", () => {
    const now = Date.parse(TEST_CLOCK);
    expect(isStale(sample().series, now)).toBe(false);
    expect(isStale(sample("stale").series, now)).toBe(true);
    expect(isStale({ stale: false, generated_at: "2026-10-08T00:00:01Z" }, now)).toBe(false);
    expect(isStale({ stale: false, generated_at: "2026-10-07T23:59:59Z" }, now)).toBe(true);
  });
});

test.describe("calendar", () => {
  const file = {
    failed_checks: { "2026-09-03": 1, "2026-09-04": 3 },
    episodes: [
      { from: "2026-09-10T14:00:00Z", to: "2026-09-11T09:00:00Z", chunk: "a".repeat(64) },
      { from: "2026-09-11T08:00:00Z", to: null, chunk: "b".repeat(64) },
    ],
  };

  test("cell titles for every state", () => {
    expect(cellTitle("G", "2026-09-02", file)).toBe("2026-09-02: every check succeeded");
    expect(cellTitle("G", "2026-09-03", file)).toBe("2026-09-03: 1 check failed; the file was retrieved again on the next check");
    expect(cellTitle("G", "2026-09-04", file)).toBe("2026-09-04: 3 checks failed; the file was retrieved again on the next check");
    expect(cellTitle("R", "2026-09-10", file)).toBe("2026-09-10: unavailable (1 chunk could not be found by two checks in a row)");
    expect(cellTitle("R", "2026-09-11", file)).toBe("2026-09-11: unavailable (2 chunks could not be found by two checks in a row)");
    expect(cellTitle("R", "2026-09-30", file)).toBe("2026-09-30: unavailable (1 chunk could not be found by two checks in a row)");
    expect(cellTitle("X", "2026-08-22", file)).toBe("2026-08-22: no checks");
    expect(cellTitle("G", "2026-08-22", {})).toBe("2026-08-22: every check succeeded");
    expect(missingChunks(file, "2026-09-09")).toBe(0);
    // A recovery at exactly midnight leaves the new day out.
    const midnight = { episodes: [{ from: "2026-09-10T14:00:00Z", to: "2026-09-11T00:00:00Z", chunk: "c".repeat(64) }] };
    expect(missingChunks(midnight, "2026-09-10")).toBe(1);
    expect(missingChunks(midnight, "2026-09-11")).toBe(0);
  });

  test("a grey day before the file's own upload says so", () => {
    const late = { uploaded_at: "2026-08-23T00:10:03Z" };
    expect(cellTitle("X", "2026-08-22", late))
      .toBe("2026-08-22: not yet uploaded (this file went up on 23 August 2026)");
    // The upload day itself is a gap in the checking, not a missing file.
    expect(cellTitle("X", "2026-08-23", late)).toBe("2026-08-23: no checks");
    expect(cellTitle("X", "2026-08-24", late)).toBe("2026-08-24: no checks");
    // A file with no uploaded_at is never claimed to be missing.
    expect(cellTitle("X", "2026-08-22", {})).toBe("2026-08-22: no checks");
  });

  test("a grey day carries the exporter's reason when there is one", () => {
    const vantages = [{ id: "lon1", label: "London" }, { id: "nyc1", label: "New York" }];
    const gaps = [
      { from: "2026-09-29", to: "2026-09-30", reason: "the checking computers were offline" },
      { from: "2026-09-30", to: "2026-09-30", reason: "a routing fault", vantages: ["lon1", "nyc1"] },
    ];
    const title = (day, context) => cellTitle("X", day, {}, context);
    expect(title("2026-09-29", { gaps, vantages }))
      .toBe("2026-09-29: no checks (the checking computers were offline)");
    // Two gaps over one day: both are reported, and one names its vantages.
    expect(title("2026-09-30", { gaps, vantages }))
      .toBe("2026-09-30: no checks (the checking computers were offline; London and New York: a routing fault)");
    // Outside every gap, and with no gaps at all, the bare statement.
    expect(title("2026-10-01", { gaps, vantages })).toBe("2026-10-01: no checks");
    expect(title("2026-09-29", {})).toBe("2026-09-29: no checks");
    // A vantage the series does not list falls back to its id.
    expect(gapReasons(gaps, "2026-09-30", [])).toEqual([
      "the checking computers were offline",
      "lon1 and nyc1: a routing fault",
    ]);
    expect(gapReasons(undefined, "2026-09-30", vantages)).toEqual([]);
  });

  test("try links", () => {
    expect(tryLink("ab".repeat(32))).toBe(`https://try.autonomi.com/#${"ab".repeat(32)}`);
  });
});

test.describe("csv", () => {
  test("lists every file with the documented columns", () => {
    const { series } = sample();
    const csv = filesCsv(series.files);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("name,bytes,address,source_url,uploaded_at,available_now");
    expect(lines).toHaveLength(series.files.length + 2);
    expect(lines.at(-1)).toBe("");
    const first = series.files[0];
    expect(lines[1]).toBe([first.name, first.bytes, first.address, first.source_url, first.uploaded_at, first.available_now].join(","));
  });

  test("quotes fields that need it", () => {
    const csv = filesCsv([{ name: 'a, "b"\nc', bytes: 1, address: "x", source_url: "https://e.example/", uploaded_at: "t", available_now: false }]);
    expect(csv).toBe('name,bytes,address,source_url,uploaded_at,available_now\r\n"a, ""b""\nc",1,x,https://e.example/,t,false\r\n');
  });
});

test.describe("sample generator", () => {
  test("is deterministic and matches what is committed", () => {
    const dirs = [0, 1].map(() => mkdtempSync(join(tmpdir(), "canary-sample-")));
    try {
      for (const dir of dirs) {
        const run = spawnSync(process.execPath, [join(root, "scripts/make-sample.mjs"), "--out", dir], { encoding: "utf8" });
        expect(run.status, run.stderr).toBe(0);
      }
      for (const name of ["index.json", "prod-canary-04.json", "stale/index.json", "stale/prod-canary-04.json"]) {
        const [a, b] = dirs.map(dir => readFileSync(join(dir, name)));
        expect(a.equals(b), name).toBe(true);
        expect(a.equals(readFileSync(join(root, "content/sample", name))), `${name} is out of date: npm run sample`).toBe(true);
      }
      expect(readdirSync(dirs[0]).sort()).toEqual(["index.json", "prod-canary-04.json", "stale"]);
    } finally {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    }
  });
});
