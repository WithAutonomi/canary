// Validation of the canary dataset, schema version 1, as written by
// `saorsa-deploy prod canary export`. The page renders only data that passes
// these checks in full: anything else is the error state, never a partial page.
//
// Both validators throw a SchemaError naming the first problem. Fields this
// version does not know are ignored; a change in meaning comes with a new
// schema_version, which is refused.

export const SCHEMA_VERSION = 1;

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const HEX64 = /^[0-9a-f]{64}$/;
const CELLS = /^[GRX]*$/;
// A series path is a plain file name next to the index: no directories, no
// scheme, nothing that could point the page somewhere else.
const SERIES_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

function fail(where, what) {
  throw new SchemaError(`${where}: ${what}`);
}

function object(value, where) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(where, "expected an object");
  return value;
}

function array(value, where) {
  if (!Array.isArray(value)) fail(where, "expected an array");
  return value;
}

function string(value, where) {
  if (typeof value !== "string" || value.length === 0) fail(where, "expected a non-empty string");
  return value;
}

function count(value, where) {
  if (!Number.isSafeInteger(value) || value < 0) fail(where, "expected a non-negative integer");
  return value;
}

function boolean(value, where) {
  if (typeof value !== "boolean") fail(where, "expected true or false");
  return value;
}

function validDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function date(value, where) {
  if (typeof value !== "string" || !DATE.test(value) || !validDate(value)) fail(where, "expected a YYYY-MM-DD date");
  return value;
}

function timestamp(value, where) {
  if (typeof value !== "string" || !TIMESTAMP.test(value) || !validDate(value.slice(0, 10))
      || Number.isNaN(Date.parse(value))) {
    fail(where, "expected a UTC timestamp ending in Z");
  }
  return value;
}

function hex64(value, where) {
  if (typeof value !== "string" || !HEX64.test(value)) fail(where, "expected 64 lowercase hex characters");
  return value;
}

function webUrl(value, where) {
  let url;
  try {
    url = new URL(string(value, where));
  } catch {
    fail(where, "expected an absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") fail(where, "expected an http or https URL");
  return value;
}

function schemaVersion(value, where) {
  if (value !== SCHEMA_VERSION) fail(where, `unsupported schema_version ${JSON.stringify(value)}`);
}

function summary(value, where) {
  object(value, where);
  for (const key of ["files", "bytes", "chunks", "initial_verification_ok", "days_observed",
    "files_never_unavailable", "files_available_now", "files_unavailable_now", "smallest_bytes", "largest_bytes"]) {
    count(value[key], `${where}.${key}`);
  }
  object(value.episodes, `${where}.episodes`);
  for (const key of ["total", "recovered", "ongoing"]) count(value.episodes[key], `${where}.episodes.${key}`);
  if (value.files_never_unavailable > value.files) fail(where, "files_never_unavailable exceeds files");
  if (value.files_unavailable_now > value.files) fail(where, "files_unavailable_now exceeds files");
  if (value.smallest_bytes > value.largest_bytes) fail(where, "smallest_bytes exceeds largest_bytes");
  return value;
}

function rate(value, where) {
  object(value, where);
  const ok = count(value.ok, `${where}.ok`);
  const failed = count(value.failed, `${where}.failed`);
  count(value.inconclusive, `${where}.inconclusive`);
  if (ok + failed === 0) {
    if (value.rate !== null) fail(`${where}.rate`, "expected null when there are no conclusive checks");
  } else if (typeof value.rate !== "number" || !(value.rate >= 0 && value.rate <= 1)) {
    fail(`${where}.rate`, "expected a number from 0 to 1");
  }
  return value;
}

function windows(value, where) {
  object(value, where);
  for (const key of ["all", "30d", "90d"]) rate(value[key], `${where}.${key}`);
  return value;
}

export function validateIndex(value) {
  object(value, "index");
  schemaVersion(value.schema_version, "index.schema_version");
  timestamp(value.generated_at, "index.generated_at");
  const series = array(value.series, "index.series");
  if (series.length === 0) fail("index.series", "expected at least one series");
  const ids = new Set();
  series.forEach((entry, i) => {
    const where = `index.series[${i}]`;
    object(entry, where);
    const id = string(entry.id, `${where}.id`);
    if (ids.has(id)) fail(`${where}.id`, `duplicate id ${id}`);
    ids.add(id);
    string(entry.kind, `${where}.kind`);
    string(entry.title, `${where}.title`);
    const path = string(entry.path, `${where}.path`);
    if (!SERIES_PATH.test(path)) fail(`${where}.path`, "expected a plain .json file name");
    timestamp(entry.generated_at, `${where}.generated_at`);
    timestamp(entry.data_to, `${where}.data_to`);
    boolean(entry.stale, `${where}.stale`);
    summary(entry.summary, `${where}.summary`);
  });
  return value;
}

export function validateSeries(value, expectedId) {
  object(value, "series file");
  schemaVersion(value.schema_version, "schema_version");
  timestamp(value.generated_at, "generated_at");

  const series = object(value.series, "series");
  string(series.id, "series.id");
  if (expectedId !== undefined && series.id !== expectedId) {
    fail("series.id", `expected ${expectedId}, found ${series.id}`);
  }
  string(series.kind, "series.kind");
  string(series.title, "series.title");
  date(series.uploaded_from, "series.uploaded_from");
  date(series.uploaded_to, "series.uploaded_to");
  timestamp(series.first_probe_at, "series.first_probe_at");
  timestamp(series.data_to, "series.data_to");
  if (typeof series.probe_interval_hours !== "number" || !(series.probe_interval_hours > 0)) {
    fail("series.probe_interval_hours", "expected a positive number");
  }
  const vantages = array(series.vantages, "series.vantages");
  if (vantages.length === 0) fail("series.vantages", "expected at least one vantage");
  const vantageIds = new Set();
  vantages.forEach((vantage, i) => {
    object(vantage, `series.vantages[${i}]`);
    const id = string(vantage.id, `series.vantages[${i}].id`);
    if (vantageIds.has(id)) fail(`series.vantages[${i}].id`, `duplicate id ${id}`);
    vantageIds.add(id);
    string(vantage.label, `series.vantages[${i}].label`);
  });

  boolean(value.stale, "stale");
  array(value.stale_reasons, "stale_reasons").forEach((reason, i) => string(reason, `stale_reasons[${i}]`));
  const totals = summary(value.summary, "summary");

  const rates = object(value.rates, "rates");
  for (const key of ["all", "30d", "90d"]) rate(rates[key], `rates.${key}`);
  object(rates.by_vantage, "rates.by_vantage");
  for (const id of vantageIds) windows(rates.by_vantage[id], `rates.by_vantage.${id}`);

  const days = array(value.days, "days");
  days.forEach((day, i) => {
    date(day, `days[${i}]`);
    if (i > 0 && day <= days[i - 1]) fail(`days[${i}]`, "days must be in increasing order");
  });
  const daySet = new Set(days);

  const files = array(value.files, "files");
  if (files.length !== totals.files) fail("files", `expected ${totals.files} files, found ${files.length}`);
  files.forEach((file, i) => {
    const where = `files[${i}]`;
    object(file, where);
    string(file.id, `${where}.id`);
    string(file.name, `${where}.name`);
    count(file.bytes, `${where}.bytes`);
    count(file.chunks, `${where}.chunks`);
    hex64(file.address, `${where}.address`);
    webUrl(file.source_url, `${where}.source_url`);
    timestamp(file.uploaded_at, `${where}.uploaded_at`);
    boolean(file.available_now, `${where}.available_now`);
    if (typeof file.cells !== "string" || !CELLS.test(file.cells)) fail(`${where}.cells`, "expected a string of G, R and X");
    if (file.cells.length !== days.length) {
      fail(`${where}.cells`, `expected ${days.length} cells, found ${file.cells.length}`);
    }
    if (file.failed_checks !== undefined) {
      const failed = object(file.failed_checks, `${where}.failed_checks`);
      if (Object.keys(failed).length === 0) fail(`${where}.failed_checks`, "expected absent when empty");
      for (const [day, n] of Object.entries(failed)) {
        date(day, `${where}.failed_checks key`);
        if (!daySet.has(day)) fail(`${where}.failed_checks.${day}`, "not one of days");
        count(n, `${where}.failed_checks.${day}`);
      }
    }
    if (file.episodes !== undefined) {
      const episodes = array(file.episodes, `${where}.episodes`);
      if (episodes.length === 0) fail(`${where}.episodes`, "expected absent when empty");
      episodes.forEach((episode, j) => {
        const at = `${where}.episodes[${j}]`;
        object(episode, at);
        timestamp(episode.from, `${at}.from`);
        if (episode.to !== null) {
          timestamp(episode.to, `${at}.to`);
          if (Date.parse(episode.to) < Date.parse(episode.from)) fail(`${at}.to`, "ends before it starts");
        }
        hex64(episode.chunk, `${at}.chunk`);
      });
    }
  });
  return value;
}

// The series file's URL, resolved against the index's own. The index may only
// name files beside itself.
export function seriesUrl(indexUrl, path) {
  if (!SERIES_PATH.test(path)) throw new SchemaError(`series path ${JSON.stringify(path)} is not a plain file name`);
  return new URL(path, indexUrl).href;
}
