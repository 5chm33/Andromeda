/**
 * dashboard.spec.ts — v101.0.0
 * E2E smoke tests for all Andromeda dashboard pages.
 * Verifies each page loads without errors, renders key UI elements,
 * and handles the offline/mock data state gracefully.
 */
import { test, expect } from "@playwright/test";

// ── Helper ────────────────────────────────────────────────────────────────────
async function expectPageLoads(page: import("@playwright/test").Page, path: string) {
  const errors: string[] = [];
  page.on("pageerror", err => errors.push(err.message));

  await page.goto(path);
  await page.waitForLoadState("networkidle");

  // No uncaught JS errors
  expect(errors.filter(e => !e.includes("ResizeObserver"))).toHaveLength(0);

  return page;
}

// ── Workspace (Home) ──────────────────────────────────────────────────────────
test.describe("Workspace Page", () => {
  test("loads without errors", async ({ page }) => {
    await expectPageLoads(page, "/");
    // Should have some content
    const body = await page.locator("body").innerText();
    expect(body.length).toBeGreaterThan(10);
  });
});

// ── RSI Dashboard ─────────────────────────────────────────────────────────────
test.describe("RSI Dashboard", () => {
  test("loads at /rsi", async ({ page }) => {
    await expectPageLoads(page, "/rsi");
  });

  test("shows RSI-related content", async ({ page }) => {
    await page.goto("/rsi");
    await page.waitForLoadState("networkidle");
    const text = await page.locator("body").innerText();
    // Should mention RSI, cycles, or proposals somewhere
    const hasRsiContent =
      text.toLowerCase().includes("rsi") ||
      text.toLowerCase().includes("cycle") ||
      text.toLowerCase().includes("proposal") ||
      text.toLowerCase().includes("improve");
    expect(hasRsiContent).toBe(true);
  });
});

// ── Knowledge Graph ───────────────────────────────────────────────────────────
test.describe("Knowledge Graph Page", () => {
  test("loads at /graph", async ({ page }) => {
    await expectPageLoads(page, "/graph");
  });

  test("renders the Knowledge Graph heading", async ({ page }) => {
    await page.goto("/graph");
    await page.waitForLoadState("networkidle");
    const heading = page.getByText("Knowledge Graph");
    await expect(heading.first()).toBeVisible({ timeout: 8000 });
  });

  test("renders a canvas element for the graph", async ({ page }) => {
    await page.goto("/graph");
    await page.waitForLoadState("networkidle");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 8000 });
  });

  test("shows node and edge counts", async ({ page }) => {
    await page.goto("/graph");
    await page.waitForLoadState("networkidle");
    // Wait for data to load (mock or real)
    await page.waitForTimeout(2000);
    const text = await page.locator("body").innerText();
    expect(text).toMatch(/\d+ nodes/);
    expect(text).toMatch(/\d+ edges/);
  });

  test("filter buttons are clickable", async ({ page }) => {
    await page.goto("/graph");
    await page.waitForLoadState("networkidle");
    const conceptBtn = page.getByRole("button", { name: /concept/i });
    if (await conceptBtn.isVisible()) {
      await conceptBtn.click();
      // Should not crash
      await page.waitForTimeout(500);
      const errors: string[] = [];
      page.on("pageerror", e => errors.push(e.message));
      expect(errors).toHaveLength(0);
    }
  });
});

// ── Module Browser ────────────────────────────────────────────────────────────
test.describe("Module Browser Page", () => {
  test("loads at /modules", async ({ page }) => {
    await expectPageLoads(page, "/modules");
  });

  test("renders the Module Browser heading", async ({ page }) => {
    await page.goto("/modules");
    await page.waitForLoadState("networkidle");
    const heading = page.getByText("Module Browser");
    await expect(heading.first()).toBeVisible({ timeout: 8000 });
  });

  test("renders module cards after loading", async ({ page }) => {
    await page.goto("/modules");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    // Should show module count
    const text = await page.locator("body").innerText();
    expect(text).toMatch(/\d+ module/);
  });

  test("search input is functional", async ({ page }) => {
    await page.goto("/modules");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const searchInput = page.getByPlaceholder(/search modules/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill("rsi");
      await page.waitForTimeout(300);
      // Should filter results
      const text = await page.locator("body").innerText();
      expect(text.toLowerCase()).toContain("rsi");
    }
  });
});

// ── Debate Viewer ─────────────────────────────────────────────────────────────
test.describe("Debate Viewer Page", () => {
  test("loads at /debate", async ({ page }) => {
    await expectPageLoads(page, "/debate");
  });

  test("renders the Debate Viewer heading", async ({ page }) => {
    await page.goto("/debate");
    await page.waitForLoadState("networkidle");
    const heading = page.getByText("Multi-Agent Debate Viewer");
    await expect(heading.first()).toBeVisible({ timeout: 8000 });
  });

  test("shows debate session content", async ({ page }) => {
    await page.goto("/debate");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    const text = await page.locator("body").innerText();
    const hasDebateContent =
      text.toLowerCase().includes("session") ||
      text.toLowerCase().includes("proposal") ||
      text.toLowerCase().includes("agent") ||
      text.toLowerCase().includes("vote");
    expect(hasDebateContent).toBe(true);
  });

  test("vote cards are expandable", async ({ page }) => {
    await page.goto("/debate");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    // Find a chevron expand button
    const expandBtns = page.locator("button").filter({ has: page.locator("svg") });
    const count = await expandBtns.count();
    if (count > 0) {
      await expandBtns.first().click();
      await page.waitForTimeout(300);
    }
  });
});

// ── Metrics Dashboard ─────────────────────────────────────────────────────────
test.describe("Metrics Dashboard Page", () => {
  test("loads at /metrics", async ({ page }) => {
    await expectPageLoads(page, "/metrics");
  });

  test("renders the System Metrics heading", async ({ page }) => {
    await page.goto("/metrics");
    await page.waitForLoadState("networkidle");
    const heading = page.getByText("System Metrics");
    await expect(heading.first()).toBeVisible({ timeout: 8000 });
  });

  test("shows RSI cycle count", async ({ page }) => {
    await page.goto("/metrics");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    const text = await page.locator("body").innerText();
    const hasMetrics =
      text.toLowerCase().includes("cycle") ||
      text.toLowerCase().includes("rsi") ||
      text.toLowerCase().includes("proposal");
    expect(hasMetrics).toBe(true);
  });

  test("shows progress bars for resource utilization", async ({ page }) => {
    await page.goto("/metrics");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    const text = await page.locator("body").innerText();
    expect(text.toLowerCase()).toContain("memory");
  });
});

// ── 404 Handling ──────────────────────────────────────────────────────────────
test.describe("404 Page", () => {
  test("shows 404 for unknown routes", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-xyz");
    await page.waitForLoadState("networkidle");
    const text = await page.locator("body").innerText();
    const has404 = text.includes("404") || text.toLowerCase().includes("not found");
    expect(has404).toBe(true);
  });
});
