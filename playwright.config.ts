import { defineConfig, devices } from "@playwright/test";

/**
 * Andromeda v101.0.0 — Playwright E2E Configuration
 *
 * Test suites:
 *   - Dashboard pages (smoke tests for all 5 routes)
 *   - RSI cycle trigger and status
 *   - CLI command output (via child_process)
 *   - Health endpoint
 *   - Knowledge Graph, Module Browser, Debate Viewer, Metrics
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  timeout: 30000,
  expect: { timeout: 8000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    headless: true,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Start the dev server before running tests if not already running
  webServer: process.env.CI
    ? undefined
    : {
        command: "pnpm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 60000,
      },
});
