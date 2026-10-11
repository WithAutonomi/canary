// Unit tests run in Node; page tests run in four browser projects against the
// sample build (npm run build:preview), served by tests/ci/serve-preview.mjs.
// Nothing here touches the network.
import { defineConfig, devices } from "@playwright/test";

const port = 35180;

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  // The calendar is a few thousand elements; with every browser project
  // running at once, a page can take several seconds to first paint.
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ["list"],
    ...(process.env.CI ? [["github"]] : []),
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "off",
    // The viewer's zone, so local times are checked as a visitor sees them.
    timezoneId: "Europe/London",
    locale: "en-GB",
  },
  webServer: {
    command: "node tests/ci/serve-preview.mjs",
    url: `http://127.0.0.1:${port}/index.html`,
    env: { PORT: String(port) },
    // Locally, reuse a server you already started. In CI always start this
    // checkout's own, so a stray server on the port can never be tested instead.
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "unit", testMatch: /unit\.spec\.js/ },
    { name: "chromium", testIgnore: /unit\.spec\.js/, use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", testIgnore: /unit\.spec\.js/, use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", testIgnore: /unit\.spec\.js/, use: { ...devices["Desktop Safari"] } },
    { name: "phone", testIgnore: /unit\.spec\.js/, use: { ...devices["Pixel 7"] } },
  ],
});
