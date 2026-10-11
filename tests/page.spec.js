// The page, against the sample build, with its data served from the
// committed sample by route. Nothing leaves the test server.
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { TEST_CLOCK, offline, sample, serveData, serveSample } from "./ci/routes.js";

const HOUR = 60 * 60 * 1000;

// Console errors and CSP reports, collected for every test.
let problems;

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on("console", message => {
    if (message.type() === "error" || /Content[- ]Security[- ]Policy|CSP/i.test(message.text())) {
      problems.push(message.text());
    }
  });
  page.on("pageerror", error => problems.push(error.message));
  await offline(page);
  await page.clock.setFixedTime(new Date(TEST_CLOCK));
});

async function open(page, variant = "") {
  await serveSample(page, variant);
  await page.goto("/");
  await expect(page.locator("#content")).not.toHaveAttribute("aria-busy", "true");
}

test("tiles, freshness and footer show the sample's numbers", async ({ page }) => {
  await open(page);
  const tiles = page.locator(".tile");
  await expect(tiles).toHaveCount(4);
  await expect(tiles.nth(0).locator(".tile-figure")).toHaveText("378 files uploaded");
  await expect(tiles.nth(0).locator(".tile-note")).toHaveText("5.28 MB to 485 MB, 43.8 GB in all, uploaded 22 August 2026 to 23 August 2026");
  await expect(tiles.nth(1).locator(".tile-figure")).toHaveText("49 days observed");
  await expect(tiles.nth(1).locator(".tile-note")).toHaveText("checked from London, New York and Singapore");
  await expect(tiles.nth(2).locator(".tile-figure")).toHaveText("375 of 378 files never unavailable");
  await expect(tiles.nth(2).locator(".unavailable-now")).toHaveText("1 currently unavailable");
  await expect(tiles.nth(2).locator(".unavailable-now")).toHaveCSS("color", "rgb(233, 19, 55)");
  await expect(tiles.nth(3).locator(".tile-figure")).toHaveText("99.95% of checks succeeded");
  await expect(tiles.nth(3).locator(".tile-note")).toHaveText("last 30 days: 99.92%, last 90 days: 99.95%");

  // The viewer's zone is Europe/London (playwright.config.js).
  await expect(page.locator(".freshness")).toHaveText("Updated 9 Oct 2026, 10:31 BST. Newest check: 9 Oct 2026, 09:03 BST.");
  await expect(page.locator(".stale-band")).toHaveCount(0);

  // One series: no series heading, and section headings are h2.
  await expect(page.locator(".series-title")).toHaveCount(0);
  await expect(page.locator(".series h2")).toHaveText(["What this is", "Checks by location", "Every file, every day", "Check for yourself", "How to read this"]);
  await expect(page.locator('[data-section="what"] p').first()).toHaveText(
    "In August 2026 we uploaded 378 ordinary public files to the Autonomi network and left them there. They are old broadcast recordings and similar material from the Internet Archive, between 5.28 MB and 485 MB each. Since then, computers in London, New York and Singapore have each tried to download every one of them, in full, once an hour. This page shows what happened. It is updated once a day.");

  const dataUrl = new URL("/data/index.json", page.url()).href;
  await expect(page.locator("#data-url")).toHaveAttribute("href", dataUrl);
  await expect(page.locator("#data-url")).toHaveText(dataUrl);
  await expect(page.locator("#schema-version")).toHaveText("1");
  await expect(page.locator(".site-footer a[href='https://github.com/WithAutonomi/canary']")).toBeVisible();
  await expect(page.locator("#error")).toBeHidden();
  expect(problems).toEqual([]);
});

test("the vantage table has a row per location", async ({ page }) => {
  await open(page);
  const rows = page.locator(".vantage-table tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.locator("th")).toHaveText(["London", "New York", "Singapore"]);
  await expect(rows.nth(0).locator("td")).toHaveText(["423,791", "199", "99.95%", "99.92%", "99.95%"]);
});

test("the calendar has a row per file and a column per day", async ({ page }) => {
  await open(page);
  const { series } = sample();
  const shape = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".calendar .cal-body .cal-row"));
    return {
      rows: rows.length,
      columns: [...new Set(rows.map(row => row.querySelectorAll(".cell").length))],
      headers: document.querySelectorAll(".calendar .cal-head .day").length,
      colours: [...new Set(Array.from(document.querySelectorAll(".calendar .cell"), cell => cell.className))].sort(),
    };
  });
  expect(shape).toEqual({ rows: 378, columns: [49], headers: 49, colours: ["cell g", "cell r", "cell x"] });

  const cell = (row, day) => page.locator(".calendar .cal-body .cal-row").nth(row).locator(".cell").nth(series.days.indexOf(day));
  const expectCell = async (row, day, state, title) => {
    await expect(cell(row, day)).toHaveClass(`cell ${state}`);
    await expect(cell(row, day)).toHaveAttribute("title", title);
    await expect(cell(row, day)).toHaveAttribute("aria-label", title);
  };
  // Recovered after 2 days, recovered after 5, and still unavailable.
  await expectCell(40, "2026-09-10", "r", "2026-09-10: unavailable (1 chunk could not be found by two checks in a row)");
  await expectCell(40, "2026-09-12", "g", "2026-09-12: every check succeeded");
  await expectCell(117, "2026-09-24", "r", "2026-09-24: unavailable (1 chunk could not be found by two checks in a row)");
  await expectCell(301, "2026-10-09", "r", "2026-10-09: unavailable (1 chunk could not be found by two checks in a row)");
  // A second-day upload's first days.
  await expectCell(252, "2026-08-22", "x", "2026-08-22: no checks");
  await expectCell(252, "2026-08-24", "x", "2026-08-24: no checks");
  // Failed checks leave the day green.
  await expectCell(12, "2026-09-03", "g", "2026-09-03: 1 check failed; the file was retrieved again on the next check");
  await expectCell(88, "2026-09-15", "g", "2026-09-15: 2 checks failed; the file was retrieved again on the next check");

  // Red cells carry a hatch as well as the colour.
  expect(await cell(40, "2026-09-10").evaluate(node => getComputedStyle(node).backgroundImage)).toContain("repeating-linear-gradient");
  expect(await cell(40, "2026-09-12").evaluate(node => getComputedStyle(node).backgroundImage)).toBe("none");

  await expect(page.locator(".legend-items li")).toHaveText(["retrieved on every check", "confirmed unavailable", "no checks that day"]);
  await expect(page.locator(".legend-note")).toHaveText("A single failed check does not colour a day; it is shown in the day's details.");
});

test("every file row links to try.autonomi.com and its source", async ({ page }) => {
  await open(page);
  const { series } = sample();
  const links = await page.evaluate(() => Array.from(document.querySelectorAll(".calendar .cal-body .file"), th => ({
    name: th.querySelector(".file-name").textContent,
    title: th.querySelector(".file-name").title,
    try: th.querySelector("a.try-link").href,
    tryText: th.querySelector("a.try-link").textContent,
    source: th.querySelector("a.source-link").href,
  })));
  expect(links).toEqual(series.files.map(file => ({
    name: file.name,
    title: file.name,
    try: `https://try.autonomi.com/#${file.address}`,
    tryText: "open in your browser",
    source: file.source_url,
  })));
});

test("check for yourself: the file list and a command", async ({ page }) => {
  await open(page);
  const { series } = sample();
  const first = series.files[0];
  await expect(page.locator('[data-slot="command"]')).toHaveText(`ant file download ${first.address} '${first.name}'`);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download the file list" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("canary-files.csv");
  const lines = (await readFile(await download.path(), "utf8")).split("\r\n");
  expect(lines[0]).toBe("name,bytes,address,source_url,uploaded_at,available_now");
  expect(lines).toHaveLength(380);
  expect(lines[1]).toBe(`${first.name},${first.bytes},${first.address},${first.source_url},${first.uploaded_at},true`);
  expect(problems).toEqual([]);
});

test("the stale sample shows the warning band instead of the freshness line", async ({ page }) => {
  await open(page, "stale");
  const band = page.locator(".stale-band");
  await expect(band).toBeVisible();
  await expect(band).toHaveText("This page is out of date. Its newest check is from 7 Oct 2026, 19:03 BST and it was last updated 7 Oct 2026, 21:00 BST. The files may be fine; the checker is not reporting.");
  await expect(page.locator(".freshness")).toHaveCount(0);
  // Amber, and the only amber.
  const amber = await band.evaluate(node => getComputedStyle(node).backgroundColor);
  const others = await page.evaluate(colour => Array.from(document.querySelectorAll("body *"))
    .filter(node => !node.classList.contains("stale-band"))
    .filter(node => [getComputedStyle(node).backgroundColor, getComputedStyle(node).color].includes(colour)).length, amber);
  expect(others).toBe(0);
  await expect(page.locator(".tile")).toHaveCount(4);
});

test("an export older than 36 hours is out of date even when not marked stale", async ({ page }) => {
  await page.clock.setFixedTime(new Date(Date.parse(sample().series.generated_at) + 36 * HOUR + 60_000));
  await open(page);
  await expect(page.locator(".stale-band")).toBeVisible();
  await expect(page.locator(".freshness")).toHaveCount(0);
});

test.describe("error state", () => {
  const expectError = async page => {
    await page.goto("/");
    await expect(page.locator("#error")).toBeVisible();
    await expect(page.locator("#error")).toContainText("The canary data could not be loaded. The files may be fine; this page could not reach its data. Try again later, or fetch the data directly:");
    await expect(page.locator(".tile")).toHaveCount(0);
    await expect(page.locator(".series")).toHaveCount(0);
    await expect(page.locator("#footer")).toBeHidden();
    await expect(page.locator("#loading")).toHaveCount(0);
    await expect(page.locator(".site-name")).toHaveText("Autonomi canary");
  };

  test("when the data source cannot be fetched", async ({ page }) => {
    await page.route("**/data-source.json", route => route.abort());
    await expectError(page);
  });

  test("when the index cannot be fetched, naming the index", async ({ page }) => {
    await page.route("**/data/index.json", route => route.abort());
    await expectError(page);
    const url = new URL("/data/index.json", page.url()).href;
    await expect(page.locator("#error-url")).toHaveAttribute("href", url);
    await expect(page.locator("#error-url")).toHaveText(url);
  });

  test("when a series file is missing", async ({ page }) => {
    await serveData(page, { "index.json": sample().index, "prod-canary-04.json": null });
    await expectError(page);
  });

  test("when the schema version is not 1", async ({ page }) => {
    const { index, series } = sample();
    await serveData(page, { "index.json": { ...index, schema_version: 2 }, "prod-canary-04.json": series });
    await expectError(page);
  });

  test("when the series file's schema version is not 1", async ({ page }) => {
    const { index, series } = sample();
    await serveData(page, { "index.json": index, "prod-canary-04.json": { ...series, schema_version: 2 } });
    await expectError(page);
  });
});

test("more than one series repeats the sections under each title", async ({ page }) => {
  const { index, series } = sample();
  const second = structuredClone(series);
  second.series.id = "prod-canary-05";
  second.series.title = "Canary 5";
  const entry = { ...index.series[0], id: "prod-canary-05", title: "Canary 5", path: "prod-canary-05.json" };
  await serveData(page, {
    "index.json": { ...index, series: [index.series[0], entry] },
    "prod-canary-04.json": series,
    "prod-canary-05.json": second,
  });
  await page.goto("/");
  await expect(page.locator(".series-title")).toHaveText(["Canary 4", "Canary 5"]);
  await expect(page.locator(".series")).toHaveCount(2);
  await expect(page.locator(".tile")).toHaveCount(8);
  await expect(page.locator(".series h3")).toHaveCount(10);
  await expect(page.locator(".calendar")).toHaveCount(2);
  await expect(page.locator("#footer")).toHaveCount(1);
});
