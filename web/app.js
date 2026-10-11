// Load the canary dataset and render it. Everything is fetched and validated
// before anything is drawn: the page shows every number or none of them.
import { renderCalendar } from "./calendar.js";
import {
  filesCsv, formatBytes, formatCount, formatDate, formatDateTime, formatMonthYear, formatRate,
  isStale, joinList,
} from "./format.js";
import { SCHEMA_VERSION, SchemaError, seriesUrl, validateIndex, validateSeries } from "./schema.js";

const main = document.getElementById("content");

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function indexUrlFrom(source) {
  if (source === null || typeof source !== "object" || typeof source.index_url !== "string") {
    throw new SchemaError("data-source.json: expected an index_url");
  }
  const url = new URL(source.index_url, location.href);
  if (url.protocol !== "https:" && url.origin !== location.origin) {
    throw new SchemaError("data-source.json: index_url must be https or on this site");
  }
  return url.href;
}

async function load() {
  const indexUrl = indexUrlFrom(await getJson("data-source.json"));
  // Known from here on, so an error can point at the data itself.
  showErrorUrl(indexUrl);
  const index = validateIndex(await getJson(indexUrl));
  const series = await Promise.all(index.series.map(async entry =>
    validateSeries(await getJson(seriesUrl(indexUrl, entry.path)), entry.id)));
  return { indexUrl, index, series };
}

function showErrorUrl(url) {
  const link = document.getElementById("error-url");
  link.href = url;
  link.textContent = url;
}

function fill(root, slot, text) {
  for (const node of root.querySelectorAll(`[data-slot="${slot}"]`)) node.textContent = text;
}

function shellQuote(text) {
  return /^[A-Za-z0-9._\/-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function downloadCsv(files) {
  const url = URL.createObjectURL(new Blob([filesCsv(files)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "canary-files.csv";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// A heading one level up, for a page with a single series and so no h2 above.
function promote(heading) {
  const replacement = document.createElement("h2");
  for (const { name, value } of heading.attributes) replacement.setAttribute(name, value);
  replacement.append(...heading.childNodes);
  heading.replaceWith(replacement);
  return replacement;
}

function renderSeries(data, position, single) {
  const fragment = document.getElementById("series-template").content.cloneNode(true);
  const root = fragment.querySelector(".series");
  const { series, summary, rates } = data;
  const vantageLabels = joinList(series.vantages.map(vantage => vantage.label));
  const id = `s${position}`;

  const title = root.querySelector('[data-slot="title"]');
  if (single) {
    title.remove();
    for (const heading of root.querySelectorAll("h3")) promote(heading);
  } else {
    title.textContent = series.title;
    title.id = `${id}-title`;
    title.hidden = false;
    root.setAttribute("aria-labelledby", title.id);
  }

  fill(root, "files", formatCount(summary.files));
  fill(root, "smallest", formatBytes(summary.smallest_bytes));
  fill(root, "largest", formatBytes(summary.largest_bytes));
  fill(root, "bytes", formatBytes(summary.bytes));
  fill(root, "uploaded-from", formatDate(series.uploaded_from));
  fill(root, "uploaded-to", formatDate(series.uploaded_to));
  fill(root, "uploaded-month", formatMonthYear(series.uploaded_from));
  fill(root, "days-observed", formatCount(summary.days_observed));
  fill(root, "vantages", vantageLabels);
  fill(root, "never-unavailable", formatCount(summary.files_never_unavailable));
  const unavailable = root.querySelector('[data-slot="unavailable-now"]');
  if (summary.files_unavailable_now > 0) {
    unavailable.textContent = `${formatCount(summary.files_unavailable_now)} currently unavailable`;
    unavailable.hidden = false;
  }
  const all = formatRate(rates.all);
  fill(root, "rate-all", rates.all.ok + rates.all.failed === 0 ? all : `${all} of checks succeeded`);
  fill(root, "rate-30d", formatRate(rates["30d"]));
  fill(root, "rate-90d", formatRate(rates["90d"]));

  const updated = formatDateTime(data.generated_at);
  const newest = formatDateTime(series.data_to);
  fill(root, "updated", updated);
  fill(root, "newest", newest);
  for (const node of root.querySelectorAll('time[data-slot="updated"]')) node.dateTime = data.generated_at;
  for (const node of root.querySelectorAll('time[data-slot="newest"]')) node.dateTime = series.data_to;
  if (isStale(data)) {
    root.querySelector('[data-slot="freshness"]').remove();
    root.querySelector('[data-slot="stale"]').hidden = false;
  } else {
    root.querySelector('[data-slot="stale"]').remove();
  }

  const rows = root.querySelector('[data-slot="vantage-rows"]');
  for (const vantage of series.vantages) {
    const windows = rates.by_vantage[vantage.id];
    const row = document.createElement("tr");
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = vantage.label;
    row.append(label);
    for (const text of [formatCount(windows.all.ok), formatCount(windows.all.failed),
      formatRate(windows.all), formatRate(windows["30d"]), formatRate(windows["90d"])]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    rows.append(row);
  }

  const calendarHeading = root.querySelector('[data-slot="calendar-heading"]');
  calendarHeading.id = `${id}-calendar`;
  root.querySelector('[data-slot="calendar"]').replaceWith(renderCalendar(document, data, calendarHeading.id));

  root.querySelector('[data-slot="csv"]').addEventListener("click", () => downloadCsv(data.files));
  const first = data.files[0];
  fill(root, "command", first
    ? `ant file download ${first.address} ${shellQuote(first.name)}`
    : "ant file download <address> <output path>");

  return fragment;
}

function render({ indexUrl, series }) {
  const single = series.length === 1;
  const fragment = document.createDocumentFragment();
  series.forEach((data, i) => fragment.append(renderSeries(data, i, single)));
  document.getElementById("loading").remove();
  main.append(fragment);

  const link = document.getElementById("data-url");
  link.href = indexUrl;
  link.textContent = indexUrl;
  document.getElementById("schema-version").textContent = String(SCHEMA_VERSION);
  document.getElementById("footer").hidden = false;
}

function showError(error) {
  console.warn("canary data not loaded:", error);
  document.getElementById("loading")?.remove();
  for (const node of main.querySelectorAll(".series")) node.remove();
  document.getElementById("footer").hidden = true;
  document.getElementById("error").hidden = false;
}

try {
  render(await load());
} catch (error) {
  showError(error);
} finally {
  main.removeAttribute("aria-busy");
}
