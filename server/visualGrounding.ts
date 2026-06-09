/**
 * visualGrounding.ts — v1.0.0
 *
 * Playwright-based visual grounding system for Andromeda.
 * Provides annotated screenshots with numbered bounding boxes over all interactive
 * elements, full-page stitched screenshots, and element-position-aware extraction.
 *
 * This gives the LLM "eyes" — it can see the rendered page and reference elements
 * by number (e.g. "click element 7") rather than guessing CSS selectors.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createCanvas, loadImage } from "canvas";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VisualElement {
  index: number;
  tag: string;
  text: string;
  role: string;
  ariaLabel: string;
  placeholder: string;
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  isVisible: boolean;
  isInteractable: boolean;
}

export interface AnnotatedScreenshotResult {
  /** Base64-encoded PNG with numbered bounding boxes drawn */
  annotatedScreenshot: string;
  /** Plain screenshot without annotations */
  rawScreenshot: string;
  /** List of all interactive elements with positions */
  elements: VisualElement[];
  /** Viewport dimensions */
  viewport: { width: number; height: number };
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
}

export interface FullPageScreenshotResult {
  /** Base64-encoded full-page stitched PNG */
  fullPageScreenshot: string;
  /** Total page dimensions */
  pageSize: { width: number; height: number };
  url: string;
  title: string;
}

// ─── Internal browser management ─────────────────────────────────────────────

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
const _pages = new Map<string, Page>();

async function getPage(sessionId: string): Promise<Page> {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    _context = await _browser.newContext({ viewport: { width: 1280, height: 800 } });
  }
  if (!_pages.has(sessionId)) {
    const page = await _context!.newPage();
    _pages.set(sessionId, page);
  }
  return _pages.get(sessionId)!;
}

// ─── Element extraction ───────────────────────────────────────────────────────

/**
 * Extracts all visible interactive elements from the page with their bounding boxes.
 */
async function extractInteractableElements(page: Page): Promise<VisualElement[]> {
  const rawElements = await page.evaluate(() => {
    const selectors = [
      "a[href]", "button", "input", "select", "textarea",
      "[role='button']", "[role='link']", "[role='menuitem']",
      "[role='tab']", "[role='checkbox']", "[role='radio']",
      "[onclick]", "[tabindex]", "label",
    ];
    const seen = new Set<Element>();
    const results: Array<{
      tag: string; text: string; role: string; ariaLabel: string;
      placeholder: string; href: string;
      x: number; y: number; width: number; height: number;
    }> = [];

    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.top < -100 || rect.left < -100) continue;
        const htmlEl = el as HTMLElement;
        results.push({
          tag: el.tagName.toLowerCase(),
          text: (htmlEl.innerText || htmlEl.getAttribute("value") || "").trim().slice(0, 80),
          role: el.getAttribute("role") || "",
          ariaLabel: el.getAttribute("aria-label") || "",
          placeholder: el.getAttribute("placeholder") || "",
          href: el.getAttribute("href") || "",
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    }
    return results;
  });

  return rawElements.map((el, i) => ({
    index: i + 1,
    ...el,
    centerX: Math.round(el.x + el.width / 2),
    centerY: Math.round(el.y + el.height / 2),
    isVisible: true,
    isInteractable: true,
  }));
}

// ─── Annotation drawing ───────────────────────────────────────────────────────

/**
 * Draws numbered bounding boxes over a screenshot PNG.
 * Returns the annotated image as base64.
 */
async function drawAnnotations(
  screenshotBuffer: Buffer,
  elements: VisualElement[]
): Promise<string> {
  try {
    const img = await loadImage(screenshotBuffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    for (const el of elements) {
      // Draw bounding box
      ctx.strokeStyle = "#FF3B30";
      ctx.lineWidth = 2;
      ctx.strokeRect(el.x, el.y, el.width, el.height);

      // Draw index badge
      const label = String(el.index);
      const badgeSize = Math.max(16, Math.min(22, el.height));
      const fontSize = Math.round(badgeSize * 0.65);
      ctx.fillStyle = "#FF3B30";
      ctx.fillRect(el.x, el.y - badgeSize, badgeSize + 4, badgeSize);
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.textBaseline = "middle";
      ctx.fillText(label, el.x + 2, el.y - badgeSize / 2);
    }

    return canvas.toBuffer("image/png").toString("base64");
  } catch {
    // If canvas fails (no display), return raw screenshot
    return screenshotBuffer.toString("base64");
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Takes an annotated screenshot of the current page in a browser session.
 * Returns the screenshot with numbered bounding boxes over all interactive elements,
 * plus the full element list with positions.
 *
 * @param url - URL to navigate to (optional if page is already loaded)
 * @param sessionId - Browser session identifier
 */
export async function annotatedScreenshot(
  url: string | null,
  sessionId = "default"
): Promise<AnnotatedScreenshotResult> {
  const page = await getPage(sessionId);

  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(800); // let JS render
  }

  const [rawBuf, elements, pageTitle, pageUrl, viewport] = await Promise.all([
    page.screenshot({ type: "png", fullPage: false }),
    extractInteractableElements(page),
    page.title(),
    page.url(),
    page.viewportSize(),
  ]);

  const annotated = await drawAnnotations(rawBuf, elements);

  return {
    annotatedScreenshot: annotated,
    rawScreenshot: rawBuf.toString("base64"),
    elements,
    viewport: viewport ?? { width: 1280, height: 800 },
    url: pageUrl,
    title: pageTitle,
  };
}

/**
 * Takes a full-page screenshot by scrolling and stitching viewport captures.
 * Returns a single tall PNG showing the entire page.
 *
 * @param url - URL to navigate to
 * @param sessionId - Browser session identifier
 */
export async function fullPageScreenshot(
  url: string,
  sessionId = "default"
): Promise<FullPageScreenshotResult> {
  const page = await getPage(sessionId);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

  const buf = await page.screenshot({ type: "png", fullPage: true });

  const pageSize = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));

  return {
    fullPageScreenshot: buf.toString("base64"),
    pageSize,
    url: page.url(),
    title: await page.title(),
  };
}

/**
 * Clicks an element by its index number from a previous annotatedScreenshot call.
 *
 * @param index - Element index (1-based) from the elements list
 * @param elements - Elements list from the previous annotatedScreenshot call
 * @param sessionId - Browser session identifier
 */
export async function clickByIndex(
  index: number,
  elements: VisualElement[],
  sessionId = "default"
): Promise<{ success: boolean; error?: string; url?: string }> {
  const el = elements.find((e) => e.index === index);
  if (!el) return { success: false, error: `Element ${index} not found in element list` };

  const page = await getPage(sessionId);
  try {
    await page.mouse.click(el.centerX, el.centerY);
    await page.waitForTimeout(500);
    return { success: true, url: page.url() };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Saves an annotated screenshot to a temp file and returns the path.
 * Useful for passing to vision models that need a file path.
 */
export async function saveAnnotatedScreenshot(
  url: string,
  sessionId = "default"
): Promise<{ filePath: string; elements: VisualElement[]; url: string; title: string }> {
  const result = await annotatedScreenshot(url, sessionId);
  const tmpPath = path.join(os.tmpdir(), `andromeda_screenshot_${Date.now()}.png`);
  fs.writeFileSync(tmpPath, Buffer.from(result.annotatedScreenshot, "base64"));
  return { filePath: tmpPath, elements: result.elements, url: result.url, title: result.title };
}

/**
 * Closes all visual grounding browser sessions.
 */
export async function closeVisualGroundingBrowser(): Promise<void> {
  _pages.clear();
  if (_context) { await _context.close().catch(() => {}); _context = null; }
  if (_browser) { await _browser.close().catch(() => {}); _browser = null; }
}
