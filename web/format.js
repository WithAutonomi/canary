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

// Successful checks as a percentage of conclusive ones, to two decimals,
// rounded down: one failure in a million checks reads 99.99%, never 100.00%.
// Inconclusive checks are never in the denominator. Null when there were no
// conclusive checks.
export function percentSucceeded({ ok, failed }) {
  const total = ok + failed;
  if (total === 0) return null;
  return (Math.floor((ok * 10000) / total) / 100).toFixed(2);
}

export function formatRate(rates) {
  const percent = percentSucceeded(rates);
  return percent === null ? "no checks yet" : `${percent}%`;
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
