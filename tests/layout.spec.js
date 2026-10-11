// Layout: fonts, no page-level horizontal scroll, and the calendar's own
// scrolling with its file column pinned.
import { test, expect } from "@playwright/test";
import { TEST_CLOCK, offline, serveSample } from "./ci/routes.js";

test.beforeEach(async ({ page }) => {
  await offline(page);
  await page.clock.setFixedTime(new Date(TEST_CLOCK));
  await serveSample(page);
});

test("layout at desktop and phone widths", async ({ page }) => {
  const blocked = [];
  page.on("console", message => {
    if (/Content[- ]Security[- ]Policy|CSP|Refused to/i.test(message.text())) blocked.push(message.text());
  });
  await page.goto("/");
  await expect(page.locator(".calendar")).toBeVisible();
  await page.evaluate(() => Promise.all(Array.from(document.fonts, font => font.load())));
  // Every self-hosted cut loads; browsers differ on quoting family names.
  expect(await page.evaluate(() => Array.from(document.fonts,
    font => `${font.family.replaceAll('"', "")} ${font.weight} ${font.status}`).sort()))
    .toEqual(["IBM Plex Mono 400 loaded", "IBM Plex Mono 500 loaded", "Inter 400 loaded", "Inter 700 loaded"]);

  for (const width of [1280, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 800 });
    // The page never scrolls sideways; only the calendar does.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `width ${width}`).toBeLessThanOrEqual(0);
    const scroll = page.locator(".calendar-scroll");
    expect(await scroll.evaluate(node => node.getBoundingClientRect().right <= document.documentElement.clientWidth)).toBe(true);
    if (width <= 375) {
      expect(await scroll.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
      // Phone day columns are 8px wide.
      expect(Math.round((await page.locator(".calendar .cell").first().boundingBox()).width)).toBe(8);
      // The file column stays put while the days scroll under it.
      const file = page.locator(".calendar .cal-body .file").first();
      const before = await file.boundingBox();
      await scroll.evaluate(node => { node.scrollLeft = 200; });
      const after = await file.boundingBox();
      expect(after.x).toBe(before.x);
      await scroll.evaluate(node => { node.scrollLeft = 0; });
    }
  }
  expect(blocked).toEqual([]);
});
