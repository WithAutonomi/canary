// The calendar: one row per file, one column per UTC day, coloured only by
// the day's state in the data (G, R or X).
import { formatBytes, formatDate, plural } from "./format.js";

export const TRY_URL = "https://try.autonomi.com/";
const DAY_MS = 24 * 60 * 60 * 1000;
const STATE_CLASS = { G: "g", R: "r", X: "x" };

export function tryLink(address) {
  return `${TRY_URL}#${address}`;
}

// How many distinct chunks were missing, in the file's confirmed episodes
// that were open at some point during the given UTC day. A recovered episode
// is [from, to): its "to" is the check that succeeded, so a recovery at
// midnight does not reach into the new day. An ongoing one is open still.
export function missingChunks(file, day) {
  const start = Date.parse(`${day}T00:00:00Z`);
  const end = start + DAY_MS;
  const chunks = new Set();
  for (const episode of file.episodes ?? []) {
    const from = Date.parse(episode.from);
    const to = episode.to === null ? Infinity : Date.parse(episode.to);
    if (from < end && to > start) chunks.add(episode.chunk);
  }
  return chunks.size;
}

// The text a cell's title and aria-label carry.
export function cellTitle(state, day, file) {
  if (state === "G") {
    const failed = file.failed_checks?.[day];
    return failed
      ? `${day}: ${plural(failed, "check", "checks")} failed; the file was retrieved again on the next check`
      : `${day}: every check succeeded`;
  }
  if (state === "R") {
    // An R day always has an episode behind it; never claim fewer than one chunk.
    const chunks = Math.max(1, missingChunks(file, day));
    return `${day}: unavailable (${plural(chunks, "chunk", "chunks")} could not be found by two checks in a row)`;
  }
  return `${day}: no checks`;
}

function element(document, tag, attributes = {}, text) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function legend(document) {
  const wrap = element(document, "div", { class: "calendar-legend" });
  const list = element(document, "ul", { class: "legend-items" });
  for (const [state, label] of [["g", "retrieved on every check"], ["r", "confirmed unavailable"], ["x", "no checks that day"]]) {
    const item = element(document, "li");
    item.append(element(document, "span", { class: `swatch ${state}`, "aria-hidden": "true" }), label);
    list.append(item);
  }
  wrap.append(list, element(document, "p", { class: "legend-note" },
    "A single failed check does not colour a day; it is shown in the day's details."));
  return wrap;
}

function fileHeader(document, file) {
  const header = element(document, "div", { role: "rowheader", class: "file" });
  header.append(element(document, "span", { class: "file-name", title: file.name }, file.name));
  const meta = element(document, "span", { class: "file-meta" });
  meta.append(
    element(document, "span", { class: "file-size" }, formatBytes(file.bytes)),
    element(document, "a", { href: tryLink(file.address), class: "try-link", target: "_blank", rel: "noopener noreferrer" }, "open in your browser"),
    element(document, "a", { href: file.source_url, class: "source-link", target: "_blank", rel: "noopener noreferrer" }, "source"),
  );
  header.append(meta);
  return header;
}

// Divs with table roles rather than a <table>: each row can then skip layout
// while it is off screen (content-visibility in styles.css). Firefox can take
// seconds to lay out a table of this many cells.
export function renderCalendar(document, data, headingId) {
  const { days, files } = data;
  const section = element(document, "div", { class: "calendar-block" });
  section.append(legend(document));

  const captionId = `${headingId}-caption`;
  const caption = element(document, "p", { id: captionId, class: "visually-hidden" },
    `${plural(files.length, "file", "files")} by day, ${formatDate(days[0])} to ${formatDate(days.at(-1))}, UTC.`);
  const scroll = element(document, "div", { class: "calendar-scroll", tabindex: "0" });
  const table = element(document, "div", {
    class: "calendar",
    role: "table",
    "aria-labelledby": headingId,
    "aria-describedby": captionId,
    "aria-rowcount": String(files.length + 1),
    "aria-colcount": String(days.length + 1),
  });
  // Sets the grid's width; CSSOM, so the page's style-src policy allows it.
  table.style.setProperty("--days", String(days.length));

  const head = element(document, "div", { role: "rowgroup", class: "cal-head" });
  const headRow = element(document, "div", { role: "row", class: "cal-row" });
  headRow.append(element(document, "div", { role: "columnheader", class: "file-col" }, "File"));
  days.forEach((day, i) => {
    const header = element(document, "div", { role: "columnheader", class: "day" });
    // A month label where a month starts, and on the first column.
    if (i === 0 || day.endsWith("-01")) {
      header.append(element(document, "span", { class: "month", "aria-hidden": "true" },
        new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))));
    }
    header.append(element(document, "span", { class: "visually-hidden" }, day));
    headRow.append(header);
  });
  head.append(headRow);

  const body = element(document, "div", { role: "rowgroup", class: "cal-body" });
  for (const file of files) {
    const row = element(document, "div", { role: "row", class: "cal-row" });
    row.append(fileHeader(document, file));
    for (let i = 0; i < days.length; i += 1) {
      const state = file.cells[i];
      const title = cellTitle(state, days[i], file);
      row.append(element(document, "span", { role: "cell", class: `cell ${STATE_CLASS[state]}`, title, "aria-label": title }));
    }
    body.append(row);
  }
  table.append(head, body);
  scroll.append(table);
  section.append(caption, scroll);
  return section;
}
