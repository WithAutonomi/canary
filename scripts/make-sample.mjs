// Write the committed sample dataset in content/sample/, in the exact shape
// `saorsa-deploy prod canary export` publishes (schema version 1). The output
// depends on nothing but the fixed seed below: two runs are byte-identical.
//
//   npm run sample                      rewrite content/sample/
//   node scripts/make-sample.mjs --out <dir>
//
// What the sample contains, on purpose, so the page and tests see every state:
//   378 files, 5 MB to 485 MB, uploaded over two days; 49 days; 3 vantages.
//   Files uploaded on the second day have three X days at the start.
//   Two recovered episodes (R runs of 2 and 5 days) and one ongoing.
//   Four files with failed_checks on G days, and one inconclusive check.
// content/sample/stale/ is the same data marked stale, generated 40 hours
// before TEST_CLOCK.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The clock the page tests run at, a few hours after the sample's export.
export const TEST_CLOCK = "2026-10-09T12:00:00Z";
export const SERIES_ID = "prod-canary-04";
const SEED = 0xc0ffee04;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const FIRST_DAY = "2026-08-22";
const DAY_COUNT = 49;
const GENERATED_AT = "2026-10-09T09:31:02Z";
const DATA_TO = "2026-10-09T08:03:12Z";
const FIRST_PROBE_AT = "2026-08-22T22:00:03Z";
const STALE_GENERATED_AT = new Date(Date.parse(TEST_CLOCK) - 40 * HOUR).toISOString().replace(".000Z", "Z");
// A stale export's newest check is older still.
const STALE_DATA_TO = "2026-10-07T18:03:12Z";
const VANTAGES = [
  { id: "lon1", label: "London" },
  { id: "nyc1", label: "New York" },
  { id: "sgp1", label: "Singapore" },
];
const FILES = 378;
const FIRST_DAY_FILES = 252;
const SMALLEST = 5277908;
const LARGEST = 485255912;

// The deliberate events, by row.
const RECOVERED_SHORT = { row: 40, from: "2026-09-10T14:00:00Z", to: "2026-09-11T09:00:00Z" };
const RECOVERED_LONG = { row: 117, from: "2026-09-20T03:00:00Z", to: "2026-09-24T16:00:00Z" };
const ONGOING = { row: 301, from: "2026-10-06T11:00:00Z", to: null };
const FAILED_CHECKS = {
  12: { "2026-09-03": 1 },
  88: { "2026-09-15": 2 },
  205: { "2026-08-30": 1, "2026-10-02": 1 },
  340: { "2026-09-27": 1 },
};
const INCONCLUSIVE = { row: 150, day: "2026-09-18", vantage: "sgp1" };
const SMALLEST_ROW = 7;
const LARGEST_ROW = 222;

// mulberry32: small, fast and the same on every platform.
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = ms => new Date(ms).toISOString().replace(".000Z", "Z");
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);

function build() {
  const random = prng(SEED);
  const int = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const pick = list => list[Math.floor(random() * list.length)];
  const hex = n => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(random() * 16)]).join("");
  const uuid = () => {
    const h = hex(32);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${"89ab"[int(0, 3)]}${h.slice(17, 20)}-${h.slice(20)}`;
  };

  const start = Date.parse(`${FIRST_DAY}T00:00:00Z`);
  const days = Array.from({ length: DAY_COUNT }, (_, i) => dayOf(start + i * DAY));
  const dataTo = Date.parse(DATA_TO);
  const firstProbe = Date.parse(FIRST_PROBE_AT);

  // Old broadcast recordings, named the way the Internet Archive's station
  // collections name their reels.
  const stations = [
    ["NBC", "Atlanta"], ["CBS", "Chicago"], ["ABC", "Denver"], ["WGBH", "Boston"], ["KQED", "SanFrancisco"],
    ["WTOP", "Washington"], ["KTLA", "LosAngeles"], ["WCCO", "Minneapolis"], ["KHOU", "Houston"],
  ];
  const extensions = ["mp4", "mp4", "mp4", "avi", "avi", "mpg", "mkv"];
  const names = new Set();
  const files = [];
  const logMin = Math.log(SMALLEST);
  const logMax = Math.log(LARGEST);
  for (let row = 0; row < FILES; row += 1) {
    const [network, city] = pick(stations);
    let name;
    do {
      name = `${network} ${city}${int(1, 4)} ${String(int(1, 99)).padStart(2, "0")}.${pick(extensions)}`;
    } while (names.has(name));
    names.add(name);
    const collection = `sample-${network}${city}-reels`;
    let bytes = Math.round(Math.exp(logMin + (logMax - logMin) * (0.02 + 0.96 * random())));
    if (row === SMALLEST_ROW) bytes = SMALLEST;
    if (row === LARGEST_ROW) bytes = LARGEST;
    const firstDay = row < FIRST_DAY_FILES;
    // Day one's uploads run from midday to just before the first probe; day
    // two's through the following day.
    const uploaded = firstDay
      ? Date.parse("2026-08-22T12:00:00Z") + Math.floor((row / FIRST_DAY_FILES) * 9.9 * HOUR) + int(0, 59) * 1000
      : Date.parse("2026-08-23T00:10:00Z") + Math.floor(((row - FIRST_DAY_FILES) / (FILES - FIRST_DAY_FILES)) * 19.8 * HOUR) + int(0, 59) * 1000;
    files.push({
      id: uuid(),
      name,
      bytes,
      chunks: Math.ceil(bytes / 3_600_000) + 2,
      address: hex(64),
      source_url: `https://archive.org/download/${collection}/${encodeURIComponent(name)}`,
      uploaded_at: iso(uploaded),
      firstDay,
    });
  }

  const episodes = new Map();
  for (const event of [RECOVERED_SHORT, RECOVERED_LONG, ONGOING]) {
    episodes.set(event.row, [{ from: event.from, to: event.to, chunk: hex(64) }]);
  }

  // Every hourly check of every file from every vantage, tallied per vantage
  // and day as ok, failed or inconclusive.
  const tally = new Map(VANTAGES.map(v => [v.id, days.map(() => ({ ok: 0, failed: 0, inconclusive: 0 }))]));
  const vantageOrder = VANTAGES.map(v => v.id);
  const output = files.map((file, row) => {
    const fileEpisodes = episodes.get(row);
    const failedChecks = FAILED_CHECKS[row];
    let cells = "";
    days.forEach((day, d) => {
      // Day-two uploads were first probed on the fourth day.
      if (!file.firstDay && d < 3) {
        cells += "X";
        return;
      }
      const dayStart = start + d * DAY;
      let open = false;
      let failedHere = 0;
      const toFail = failedChecks?.[day] ?? 0;
      for (let h = 0; h < 24; h += 1) {
        const at = dayStart + h * HOUR;
        if (at < firstProbe || at > dataTo) continue;
        const inEpisode = fileEpisodes?.some(e => at >= Date.parse(e.from) && (e.to === null || at < Date.parse(e.to)));
        if (inEpisode) open = true;
        VANTAGES.forEach(({ id }) => {
          const counts = tally.get(id)[d];
          if (inEpisode) {
            counts.failed += 1;
          } else if (failedHere < toFail && h === 6 + failedHere * 5 && vantageOrder[(row + failedHere) % 3] === id) {
            counts.failed += 1;
            failedHere += 1;
          } else if (row === INCONCLUSIVE.row && day === INCONCLUSIVE.day && id === INCONCLUSIVE.vantage && h === 13) {
            counts.inconclusive += 1;
          } else {
            counts.ok += 1;
          }
        });
      }
      // An episode opened before this day and still open covers it too.
      if (fileEpisodes?.some(e => Date.parse(e.from) < dayStart + DAY && (e.to === null ? dataTo : Date.parse(e.to)) >= dayStart)) open = true;
      cells += open ? "R" : "G";
    });
    if (failedChecks) {
      for (const day of Object.keys(failedChecks)) {
        if (cells[days.indexOf(day)] !== "G") throw new Error(`failed_checks on a non-G day: row ${row} ${day}`);
      }
    }
    const entry = {
      id: file.id,
      name: file.name,
      bytes: file.bytes,
      chunks: file.chunks,
      address: file.address,
      source_url: file.source_url,
      uploaded_at: file.uploaded_at,
      available_now: !fileEpisodes?.some(e => e.to === null),
      cells,
    };
    if (failedChecks) entry.failed_checks = failedChecks;
    if (fileEpisodes) entry.episodes = fileEpisodes;
    return entry;
  });

  const sum = (rows, from = 0) => rows.slice(from).reduce((acc, c) => ({
    ok: acc.ok + c.ok, failed: acc.failed + c.failed, inconclusive: acc.inconclusive + c.inconclusive,
  }), { ok: 0, failed: 0, inconclusive: 0 });
  const withRate = c => ({ ...c, rate: c.ok + c.failed === 0 ? null : Math.round((c.ok / (c.ok + c.failed)) * 1e6) / 1e6 });
  const add = (a, b) => ({ ok: a.ok + b.ok, failed: a.failed + b.failed, inconclusive: a.inconclusive + b.inconclusive });
  const last30 = DAY_COUNT - 30;
  // The series is younger than 90 days, so its 90-day window is all of it.
  const windows = rows => ({ all: withRate(sum(rows)), "30d": withRate(sum(rows, last30)), "90d": withRate(sum(rows)) });
  const byVantage = Object.fromEntries(VANTAGES.map(({ id }) => [id, windows(tally.get(id))]));
  const allRows = days.map((_, d) => VANTAGES.reduce((acc, { id }) => add(acc, tally.get(id)[d]), { ok: 0, failed: 0, inconclusive: 0 }));
  const rates = { ...windows(allRows), by_vantage: byVantage };

  const ongoing = output.filter(f => !f.available_now).length;
  const withEpisodes = output.filter(f => f.episodes);
  const summary = {
    files: output.length,
    bytes: output.reduce((n, f) => n + f.bytes, 0),
    chunks: output.reduce((n, f) => n + f.chunks, 0),
    initial_verification_ok: output.length,
    days_observed: days.length,
    files_never_unavailable: output.length - withEpisodes.length,
    files_available_now: output.length - ongoing,
    files_unavailable_now: ongoing,
    episodes: {
      total: withEpisodes.reduce((n, f) => n + f.episodes.length, 0),
      recovered: withEpisodes.reduce((n, f) => n + f.episodes.filter(e => e.to !== null).length, 0),
      ongoing: withEpisodes.reduce((n, f) => n + f.episodes.filter(e => e.to === null).length, 0),
    },
    smallest_bytes: Math.min(...output.map(f => f.bytes)),
    largest_bytes: Math.max(...output.map(f => f.bytes)),
  };

  return { days, files: output, rates, summary };
}

function documents({ days, files, rates, summary }, { generatedAt, dataTo, stale }) {
  const seriesFile = {
    schema_version: 1,
    generated_at: generatedAt,
    series: {
      id: SERIES_ID,
      kind: "prod-canary",
      title: "Canary 4",
      uploaded_from: "2026-08-22",
      uploaded_to: "2026-08-23",
      first_probe_at: FIRST_PROBE_AT,
      data_to: dataTo,
      probe_interval_hours: 1,
      vantages: VANTAGES,
    },
    stale,
    stale_reasons: stale ? ["no_recent_probes"] : [],
    summary,
    rates,
    days,
    files,
  };
  const index = {
    schema_version: 1,
    generated_at: generatedAt,
    series: [{
      id: SERIES_ID,
      kind: "prod-canary",
      title: "Canary 4",
      path: `${SERIES_ID}.json`,
      generated_at: generatedAt,
      data_to: dataTo,
      stale,
      summary,
    }],
  };
  return { index, seriesFile };
}

export async function writeSample(out) {
  const data = build();
  const json = value => `${JSON.stringify(value, null, 2)}\n`;
  for (const [dir, options] of [
    [out, { generatedAt: GENERATED_AT, dataTo: DATA_TO, stale: false }],
    [join(out, "stale"), { generatedAt: STALE_GENERATED_AT, dataTo: STALE_DATA_TO, stale: true }],
  ]) {
    const { index, seriesFile } = documents(data, options);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.json"), json(index));
    await writeFile(join(dir, `${SERIES_ID}.json`), json(seriesFile));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { out: { type: "string", default: join(root, "content/sample") } } });
  await writeSample(resolve(values.out));
  console.log(`Wrote sample data to ${resolve(values.out)}`);
}
