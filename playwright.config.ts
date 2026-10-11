import { defineConfig, devices } from "@playwright/test"

import { TIME_ZONE } from "./e2e/fixtures/constants"

const CI = !!process.env.CI
// Locally, use the installed Google Chrome (no browser download). CI installs Chromium.
const channel = process.env.PW_CHANNEL ?? (CI ? undefined : "chrome")

const common = {
  channel,
  timezoneId: TIME_ZONE,
  locale: "en-US",
  colorScheme: "light" as const,
  permissions: ["clipboard-read", "clipboard-write"],
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS ?? (CI ? 2 : 4)),
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 30_000,
  // A full run takes ~5 minutes. Stop a run that stalls (e.g. the computer slept) instead of
  // letting it drag on and report dozens of confusing timeouts.
  globalTimeout: CI ? 45 * 60_000 : 20 * 60_000,
  expect: { timeout: 7_500 },
  reporter: CI
    ? [["github"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    ...common,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "api", testMatch: "api/**/*.spec.ts" },
    { name: "desktop", testIgnore: ["api/**", "**/*.mobile.spec.ts"] },
    {
      name: "mobile",
      testMatch: "**/*.mobile.spec.ts",
      use: { ...devices["Pixel 7"], ...common },
    },
  ],
})
