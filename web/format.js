// Formatting for every number, date and list the page shows. Pure functions,
// shared by the page and the unit tests.

const LOCALE = "en-GB";
const UNITS = ["kB", "MB", "GB", "TB", "PB"];

export function formatCount(n) {
  return n.toLocaleString(LOCALE);
}

// Decimal units, three significant figures: 5.28 MB, 36.3 MB, 485 MB, 32.2 GB.
export function formatBytes(n) {
  if (n < 1000) return `${n} ${n === 1 ? "byte" : "bytes"}`;
  let value = n;
  let unit = -1;
  // Move up a unit whenever the rounded figure would read 1000 or more.
  do {
    value /= 1000;
    unit += 1;
  } while (unit < UNITS.length - 1 && Number(value.toPrecision(3)) >= 1000);
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

// How precise a success rate is allowed to look. A percentage can only carry
// as many digits as its sample supports: with N conclusive checks, one check
// is worth 100/N percent, so anything finer than that is invention. Six
// decimals is the ceiling, which a billion checks would earn.
//
// Four is the floor, and it is a commitment rather than a derivation: two
// decimals report a clean 100% for any shortfall under 0.01%, which is how a
// record with real failures in it came to read 100.00%. The canary's windows
// run to hundreds of thousands of checks, where four decimals is earned
// several times over; the counts shown beside the headline disclose the
// sample either way, so a reader can see what the figure rests on.
export const MIN_RATE_DECIMALS = 4;
export const MAX_RATE_DECIMALS = 6;

// One width for every percentage in a series, set by the smallest number of
// conclusive checks behind any of them: no figure claims more precision than
// its own sample supports, and a column of rates stays aligned. Windows with
// no conclusive checks show no percentage, so they do not constrain it.
export function rateDecimals(windows) {
  const totals = windows.map(({ ok, failed }) => ok + failed).filter(total => total > 0);
  if (totals.length === 0) return MIN_RATE_DECIMALS;
  const needed = Math.ceil(Math.log10(Math.min(...totals)) - 2);
  return Math.min(MAX_RATE_DECIMALS, Math.max(MIN_RATE_DECIMALS, needed));
}

// Successful checks as a percentage of conclusive ones, rounded down: two
// failures in half a million checks read 99.9995%, never 100.0000%. Only a
// record with no failures at all reaches 100. Inconclusive checks are never
// in the denominator. Null when there were no conclusive checks.
export function percentSucceeded({ ok, failed }, decimals = MIN_RATE_DECIMALS) {
  const total = ok + failed;
  if (total === 0) return null;
  // Integer arithmetic throughout. Floating-point division can land a hair
  // below an exact figure, and flooring that turns 30.0000% into 29.9999%.
  const scale = 10n ** BigInt(decimals);
  const scaled = (BigInt(ok) * 100n * scale) / BigInt(total);
  return `${scaled / scale}.${String(scaled % scale).padStart(decimals, "0")}`;
}

export function formatRate(rates, decimals = MIN_RATE_DECIMALS) {
  const percent = percentSucceeded(rates, decimals);
  return percent === null ? "no checks yet" : `${percent}%`;
}

// The figures under a rate, so the reader can check it rather than trust it:
// "2 failed of 435,561 conclusive checks". Null when there are none to count.
export function formatChecks({ ok, failed }) {
  const total = ok + failed;
  if (total === 0) return null;
  return `${formatCount(failed)} failed of ${formatCount(total)} conclusive ${total === 1 ? "check" : "checks"}`;
}

// A moment, in the viewer's own time zone unless one is given:
// "9 Oct 2026, 10:31 BST".
export function formatDateTime(iso, timeZone) {
  return new Intl.DateTimeFormat(LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

// A calendar date from the data (always UTC): "22 August 2026".
export function formatDate(day) {
  return new Intl.DateTimeFormat(LOCALE, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${day}T00:00:00Z`));
}

// "August 2026".
export function formatMonthYear(day) {
  return new Intl.DateTimeFormat(LOCALE, { year: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${day}T00:00:00Z`));
}

// "London", "London and New York", "London, New York and Singapore".
export function joinList(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function plural(n, one, many) {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

// True when the page should say it is out of date: the exporter says so, or
// its newest export is more than 36 hours older than the viewer's clock.
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export function isStale(series, now = Date.now()) {
  return series.stale === true || now - Date.parse(series.generated_at) > STALE_AFTER_MS;
}

// The file list a visitor can download, as RFC 4180 CSV.
export const CSV_COLUMNS = ["name", "bytes", "address", "source_url", "uploaded_at", "available_now"];

function csvField(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function filesCsv(files) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const file of files) lines.push(CSV_COLUMNS.map(column => csvField(file[column])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
