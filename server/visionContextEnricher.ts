/**
 * visionContextEnricher.ts — v12.11.0
 *
 * Multi-Modal Context Awareness for RSI Proposals.
 *
 * For proposals that touch UI files (React components, CSS, Tailwind), this module:
 *
 *   1. Takes a screenshot of the current UI state (if the dev server is running)
 *   2. Passes the screenshot to the vision model to extract:
 *      - Currently visible UI components and their layout
 *      - Any visible error states or broken layouts
 *      - Text content visible on screen
 *   3. Injects this visual context into the Actor-Critic review prompt so the
 *      Critic can evaluate whether the proposed change would break the UI
 *   4. After apply, takes a second screenshot and computes a semantic description
 *      of what changed (not just pixel diff — actual component-level diff)
 *
 * Falls back gracefully when:
 *   - Playwright is not installed
 *   - Dev server is not running
 *   - Vision API is not configured
 *   - The file is not a UI file
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createLogger } from "./logger.js";

const log = createLogger("visionContextEnricher");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VisionEnrichmentResult {
  enriched: boolean;
  screenshotPath?: string;
  uiDescription?: string;
  visibleComponents?: string[];
  visibleErrors?: string[];
  contextSnippet: string;   // Ready-to-inject LLM context string
  skipped: boolean;
  skippedReason?: string;
}

export interface VisionDiffResult {
  changed: boolean;
  beforeDescription?: string;
  afterDescription?: string;
  semanticDiff?: string;
  regressionDetected: boolean;
  regressionDetails?: string;
}

// ─── UI File Detection ────────────────────────────────────────────────────────

const UI_FILE_PATTERNS = [
  /\.tsx$/,
  /\.jsx$/,
  /\.css$/,
  /\.scss$/,
  /\.module\.css$/,
  /components\//,
  /pages\//,
  /views\//,
  /layouts\//,
  /ui\//,
];

export function isUIFile(targetFile: string): boolean {
  return UI_FILE_PATTERNS.some(p => p.test(targetFile));
}

// ─── Screenshot Capture ───────────────────────────────────────────────────────

/**
 * Try to take a screenshot of the running dev server using Playwright.
 * Returns the screenshot path or null if Playwright is not available.
 */
async function captureScreenshot(
  url: string,
  outputPath: string
): Promise<boolean> {
  try {
    // Dynamic import — Playwright may not be installed
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    try {
      await page.goto(url, { timeout: 8000, waitUntil: "networkidle" });
      await page.screenshot({ path: outputPath, fullPage: false });
      return true;
    } finally {
      await browser.close();
    }
  } catch (err) {
    // Playwright not installed or server not running — fall back to DOM extraction
    return false;
  }
}

/**
 * Check if the dev server is running on the expected port.
 */
async function isDevServerRunning(port = 3000): Promise<boolean> {
  try {
    const { default: http } = await import("http");
    return new Promise(resolve => {
      const req = http.get(`http://localhost:${port}/health`, res => {
        resolve(res.statusCode === 200);
        res.resume();
      });
      req.on("error", () => resolve(false));
      req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
  } catch {
    return false;
  }
}

// ─── Vision Analysis ──────────────────────────────────────────────────────────

/**
 * Analyze a screenshot using the existing visionModule.
 */
async function analyzeScreenshot(screenshotPath: string): Promise<{
  description: string;
  components: string[];
  errors: string[];
} | null> {
  try {
    const { analyzeUIScreenshot } = await import("./visionModule.js");
    const result = await analyzeUIScreenshot(screenshotPath, {
      maxTokens: 800,
    });
    if ("error" in result) return null;

    // Parse the structured response
    const description = result.description || "";
    const text = result.text || [];

    // Extract component mentions from description
    const componentPatterns = /\b(button|input|modal|dialog|form|table|card|header|nav|sidebar|footer|dropdown|menu|tab|accordion|tooltip|badge|alert|spinner|loader|icon|image|chart|graph)\b/gi;
    const components: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = componentPatterns.exec(description)) !== null) {
      const comp = match[1].toLowerCase();
      if (!components.includes(comp)) components.push(comp);
    }

    // Extract visible errors
    const errors: string[] = text.filter(t =>
      /error|warning|failed|invalid|required|undefined|null|NaN/i.test(t)
    );

    return { description, components, errors };
  } catch {
    return null;
  }
}

// ─── Main Enrichment Function ─────────────────────────────────────────────────

/**
 * Enrich a UI proposal with visual context from the running dev server.
 * Returns a context snippet ready for injection into the Critic review prompt.
 */
export async function enrichWithVisionContext(opts: {
  targetFile: string;
  proposedSnippet: string;
  devServerPort?: number;
}): Promise<VisionEnrichmentResult> {
  const { targetFile, devServerPort = 3000 } = opts;

  // Only process UI files
  if (!isUIFile(targetFile)) {
    return {
      enriched: false, contextSnippet: "",
      skipped: true, skippedReason: "not a UI file",
    };
  }

  // Check if dev server is running
  const serverRunning = await isDevServerRunning(devServerPort);
  if (!serverRunning) {
    return {
      enriched: false, contextSnippet: "",
      skipped: true, skippedReason: "dev server not running",
    };
  }

  try {
    // Take screenshot
    const screenshotDir = path.join(os.tmpdir(), "andromeda_vision");
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `before_${Date.now()}.png`);

    const captured = await captureScreenshot(
      `http://localhost:${devServerPort}`,
      screenshotPath
    );

    if (!captured) {
      return {
        enriched: false, contextSnippet: "",
        skipped: true, skippedReason: "Playwright not available",
      };
    }

    // Analyze the screenshot
    const analysis = await analyzeScreenshot(screenshotPath);
    if (!analysis) {
      return {
        enriched: false, contextSnippet: "",
        skipped: true, skippedReason: "Vision analysis failed",
      };
    }

    // Build context snippet for LLM injection
    const lines: string[] = [
      "## Current UI State (Visual Context)",
      `Description: ${analysis.description.slice(0, 400)}`,
    ];
    if (analysis.components.length > 0) {
      lines.push(`Visible components: ${analysis.components.join(", ")}`);
    }
    if (analysis.errors.length > 0) {
      lines.push(`⚠️  Visible errors/warnings: ${analysis.errors.slice(0, 3).join("; ")}`);
    }
    lines.push("Your proposed change must not break any of the above visible components.");

    const contextSnippet = lines.join("\n");

    log.info(`[VisionEnricher] Captured UI context for ${targetFile}: ${analysis.components.length} components, ${analysis.errors.length} errors`);

    return {
      enriched: true,
      screenshotPath,
      uiDescription: analysis.description,
      visibleComponents: analysis.components,
      visibleErrors: analysis.errors,
      contextSnippet,
      skipped: false,
    };
  } catch (err) {
    log.warn(`[VisionEnricher] Failed for ${targetFile}: ${(err as Error).message?.slice(0, 100)}`);
    return {
      enriched: false, contextSnippet: "",
      skipped: true, skippedReason: `error: ${(err as Error).message?.slice(0, 80)}`,
    };
  }
}

/**
 * Compare before/after screenshots to detect visual regressions.
 * Returns a semantic description of what changed.
 */
export async function detectVisualRegression(opts: {
  beforeScreenshotPath: string;
  afterScreenshotPath: string;
}): Promise<VisionDiffResult> {
  const { beforeScreenshotPath, afterScreenshotPath } = opts;

  if (!fs.existsSync(beforeScreenshotPath) || !fs.existsSync(afterScreenshotPath)) {
    return { changed: false, regressionDetected: false };
  }

  try {
    const [before, after] = await Promise.all([
      analyzeScreenshot(beforeScreenshotPath),
      analyzeScreenshot(afterScreenshotPath),
    ]);

    if (!before || !after) {
      return { changed: false, regressionDetected: false };
    }

    // Detect regressions: errors appeared after the change
    const newErrors = after.errors.filter(e => !before.errors.includes(e));
    const lostComponents = before.components.filter(c => !after.components.includes(c));

    const regressionDetected = newErrors.length > 0 || lostComponents.length > 0;

    let regressionDetails: string | undefined;
    if (regressionDetected) {
      const parts: string[] = [];
      if (newErrors.length > 0) parts.push(`New errors: ${newErrors.join("; ")}`);
      if (lostComponents.length > 0) parts.push(`Missing components: ${lostComponents.join(", ")}`);
      regressionDetails = parts.join(" | ");
    }

    const semanticDiff = before.description !== after.description
      ? `Before: ${before.description.slice(0, 200)} | After: ${after.description.slice(0, 200)}`
      : "No semantic change detected";

    return {
      changed: before.description !== after.description,
      beforeDescription: before.description,
      afterDescription: after.description,
      semanticDiff,
      regressionDetected,
      regressionDetails,
    };
  } catch {
    return { changed: false, regressionDetected: false };
  }
}

/**
 * Prune old vision screenshots to prevent disk bloat.
 * Keeps only the most recent 50 screenshots.
 */
export function pruneOldVisionScreenshots(): void {
  try {
    const screenshotDir = path.join(os.tmpdir(), "andromeda_vision");
    if (!fs.existsSync(screenshotDir)) return;
    const files = fs.readdirSync(screenshotDir)
      .filter(f => f.endsWith(".png"))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(screenshotDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const f of files.slice(50)) {
      try { fs.unlinkSync(path.join(screenshotDir, f.name)); } catch { /* non-fatal */ }
    }
  } catch { /* non-fatal */ }
}
