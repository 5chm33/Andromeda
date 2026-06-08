/**
 * browser.ts — Playwright-based web browsing tool for Andromeda
 *
 * Provides headless Chromium browsing with full page text extraction.
 * Uses the system Chromium binary to avoid downloading a separate browser.
 * Designed to be called by the planner or directly via /api/browse endpoint.
 */

import * as fs from "fs";
import { chromium } from "playwright-core";

const BROWSE_TIMEOUT_MS = 20_000; // 20 second page load timeout
const MAX_CONTENT_LENGTH = 200_000; // v5.43: 200KB - CEO edition

export interface BrowseResult {
  url: string;
  title: string;
  content: string;      // cleaned readable text
  truncated: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Finds the system Chromium executable path.
 * Playwright-core requires an explicit executablePath when not using
 * the bundled browsers.
 */
function getChromiumPath(): string {
  const candidates = [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  // fs imported at module level
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  // Fallback — let Playwright try to find it
  return "/usr/bin/chromium-browser";
}

/**
 * Extracts clean, readable text from a web page.
 * Removes scripts, styles, nav, footer boilerplate.
 */
function cleanPageText(rawText: string): string {
  return rawText
    .replace(/\s{3,}/g, "\n\n")   // collapse excessive whitespace
    .replace(/\n{4,}/g, "\n\n\n") // max 3 blank lines
    .trim();
}

/**
 * Visits a URL with a headless Chromium browser and returns the full
 * readable text content of the page.
 *
 * @param url - The URL to visit
 * @returns BrowseResult with title, content, and metadata
 */
// v5.9: SSRF protection — block access to private/internal network addresses
const PRIVATE_IP_PATTERNS = [
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[01])\./,  // 172.16.0.0/12
  /^192\.168\./,                     // 192.168.0.0/16
  /^127\./,                          // loopback
  /^0\./,                            // 0.0.0.0/8
  /^169\.254\./,                     // link-local (AWS metadata)
  /^fc00:/i,                         // IPv6 unique local
  /^fe80:/i,                         // IPv6 link-local
  /^::1$/,                           // IPv6 loopback
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
]);

function isPrivateAddress(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;
  if (hostname.endsWith(".local")) return true;
  if (hostname.endsWith(".internal")) return true;
  return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(hostname));
}

/**
 * Validates that a URL is safe to browse (not a private/internal address).
 * Returns an error message if blocked, or null if allowed.
 */
function validateUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only HTTP/HTTPS URLs are supported";
  }
  if (isPrivateAddress(parsed.hostname)) {
    return "Access to internal network addresses is blocked (SSRF protection)";
  }
  return null;
}

export async function browseUrl(url: string): Promise<BrowseResult> {
  const start = Date.now();

  // Validate URL and SSRF check
  const validationError = validateUrl(url);
  if (validationError) {
    return { url, title: "", content: "", truncated: false, durationMs: 0, error: validationError };
  }
  const parsedUrl = new URL(url);

  let browser;
  try {
    browser = await chromium.launch({
      executablePath: getChromiumPath(),
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-extensions",
      ],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      javaScriptEnabled: true,
    });

    const page = await context.newPage();

    // Block images, fonts, and media to speed up loading
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "font", "media", "stylesheet"].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.goto(parsedUrl.href, {
      waitUntil: "domcontentloaded",
      timeout: BROWSE_TIMEOUT_MS,
    });

    // Wait a moment for any JS-rendered content
    await page.waitForTimeout(1500);

    const title = await page.title();

    // v6.19: Use @mozilla/readability for high-quality article extraction.
    // This dramatically improves content quality vs manual DOM extraction —
    // readability strips ads, nav, sidebars, and returns the main article text.
    let content = "";
    let readabilityUsed = false;
    try {
      const pageHtml = await page.content();
      const { JSDOM } = await import("jsdom");
      const { Readability } = await import("@mozilla/readability");
      const dom = new JSDOM(pageHtml, { url: parsedUrl.href });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (article?.textContent && article.textContent.length > 200) {
        content = cleanPageText(article.textContent);
        readabilityUsed = true;
      }
    } catch { /* fall through to manual extraction */ }

    if (!readabilityUsed) {
      // Fallback: manual DOM extraction (works for SPAs and non-article pages)
      const rawText = await page.evaluate(() => {
        const noise = document.querySelectorAll(
          "script, style, noscript, nav, footer, header, aside, [role='navigation'], [role='banner'], [aria-hidden='true'], .cookie-banner, .ad, .advertisement"
        );
        noise.forEach((el) => el.remove());
        const main =
          document.querySelector("main") ||
          document.querySelector("article") ||
          document.querySelector('[role="main"]') ||
          document.querySelector(".content") ||
          document.querySelector("#content") ||
          document.body;
        return main ? main.innerText : document.body.innerText;
      });
      content = cleanPageText(rawText);
    }

    const truncated = content.length > MAX_CONTENT_LENGTH;
    if (truncated) {
      content = content.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated — page is very long]";
    }

    await browser.close();

    return {
      url: parsedUrl.href,
      title,
      content,
      truncated,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    return {
      url,
      title: "",
      content: "",
      truncated: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Browse failed",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// v6.18: Full Playwright Interaction API
// Adds navigate, click, type, screenshot, extractData, and session management.
// This replaces the stub that only exported closeBrowser().
// ─────────────────────────────────────────────────────────────────────────────
import { Browser, BrowserContext, Page } from "playwright-core";

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  url: string;
  createdAt: number;
}

const sessions = new Map<string, BrowserSession>();
let sessionCounter = 0;

async function getOrCreateSession(sessionId?: string): Promise<{ session: BrowserSession; id: string }> {
  if (sessionId && sessions.has(sessionId)) {
    return { session: sessions.get(sessionId)!, id: sessionId };
  }
  const browser = await chromium.launch({
    executablePath: getChromiumPath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const id = sessionId ?? `session-${++sessionCounter}`;
  const session: BrowserSession = { browser, context, page, url: "about:blank", createdAt: Date.now() };
  sessions.set(id, session);
  return { session, id };
}

export interface BrowserActionResult {
  success: boolean;
  sessionId: string;
  url?: string;
  title?: string;
  content?: string;
  screenshot?: string; // base64 PNG
  error?: string;
}

/**
 * Navigate to a URL in a browser session.
 */
export async function browserNavigate(url: string, sessionId?: string): Promise<BrowserActionResult> {
  // SSRF protection
  try {
    const parsed = new URL(url);
    if (isPrivateAddress(parsed.hostname)) {
      return { success: false, sessionId: sessionId ?? "none", error: `SSRF blocked: ${parsed.hostname}` };
    }
  } catch {
    return { success: false, sessionId: sessionId ?? "none", error: `Invalid URL: ${url}` };
  }
  try {
    const { session, id } = await getOrCreateSession(sessionId);
    await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    session.url = session.page.url();
    const title = await session.page.title();
    return { success: true, sessionId: id, url: session.url, title };
  } catch (err) {
    return { success: false, sessionId: sessionId ?? "none", error: String(err) };
  }
}

/**
 * Click an element matching a CSS selector or text.
 */
export async function browserClick(selector: string, sessionId: string): Promise<BrowserActionResult> {
  const session = sessions.get(sessionId);
  if (!session) return { success: false, sessionId, error: `No session: ${sessionId}` };
  try {
    // Try CSS selector first, then text content
    const el = await session.page.$(selector).catch(() => null)
      ?? await session.page.getByText(selector, { exact: false }).first().elementHandle().catch(() => null);
    if (!el) return { success: false, sessionId, error: `Element not found: ${selector}` };
    await el.click({ timeout: 5000 });
    await session.page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
    return { success: true, sessionId, url: session.page.url() };
  } catch (err) {
    return { success: false, sessionId, error: String(err) };
  }
}

/**
 * v6.23: Vision-based coordinate click — fallback for when CSS selector fails.
 * Takes a screenshot, asks the LLM to identify the bounding box of the target,
 * and clicks via pixel coordinates. Works on React/Next.js apps with dynamic class names.
 */
export async function browserClickVision(
  description: string,
  sessionId: string,
): Promise<BrowserActionResult> {
  const session = sessions.get(sessionId);
  if (!session) return { success: false, sessionId, error: `No session: ${sessionId}` };
  try {
    // Step 1: Take a screenshot
    const buf = await session.page.screenshot({ type: "png", fullPage: false });
    const base64 = buf.toString("base64");
    const viewport = session.page.viewportSize() ?? { width: 1280, height: 720 };

    // Step 2: Ask the LLM to identify the element's center coordinates
    const apiKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "";
    const baseUrl = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
    const model = process.env.VISION_MODEL || "gpt-4.1-mini";
    const prompt = `The image is a browser screenshot (${viewport.width}x${viewport.height} pixels).\nFind the element described as: "${description}"\nReturn ONLY a JSON object with the center pixel coordinates: {"x": <number>, "y": <number>}\nIf the element is not visible, return {"x": -1, "y": -1}.\nNo explanation, no markdown, just the JSON.`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64}`, detail: "high" } },
          ],
        }],
        max_tokens: 100,
        temperature: 0,
      }),
    });
    if (!response.ok) return { success: false, sessionId, error: `Vision API error: ${response.status}` };
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const coords = JSON.parse(cleaned) as { x: number; y: number };

    if (coords.x < 0 || coords.y < 0) {
      return { success: false, sessionId, error: `Vision: element "${description}" not found in screenshot` };
    }

    // Step 3: Click the identified coordinates
    await session.page.mouse.click(coords.x, coords.y);
    await session.page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
    return { success: true, sessionId, url: session.page.url() };
  } catch (err) {
    return { success: false, sessionId, error: `Vision click failed: ${String(err)}` };
  }
}

/**
 * Type text into an input field matching a CSS selector.
 */
export async function browserType(selector: string, text: string, sessionId: string): Promise<BrowserActionResult> {
  const session = sessions.get(sessionId);
  if (!session) return { success: false, sessionId, error: `No session: ${sessionId}` };
  try {
    await session.page.fill(selector, text, { timeout: 5000 });
    return { success: true, sessionId };
  } catch (err) {
    // Try locating by label or placeholder
    try {
      await session.page.getByLabel(selector).fill(text, { timeout: 3000 });
      return { success: true, sessionId };
    } catch {
      return { success: false, sessionId, error: String(err) };
    }
  }
}

/**
 * Take a screenshot of the current page.
 * Returns base64-encoded PNG.
 */
export async function browserScreenshot(sessionId: string): Promise<BrowserActionResult> {
  const session = sessions.get(sessionId);
  if (!session) return { success: false, sessionId, error: `No session: ${sessionId}` };
  try {
    const buf = await session.page.screenshot({ type: "png", fullPage: false });
    return { success: true, sessionId, screenshot: buf.toString("base64") };
  } catch (err) {
    return { success: false, sessionId, error: String(err) };
  }
}

/**
 * Extract structured data from the current page.
 * Returns cleaned text content, all links, and all visible form inputs.
 */
export async function browserExtractData(sessionId: string): Promise<BrowserActionResult & {
  links?: Array<{ text: string; href: string }>;
  inputs?: Array<{ type: string; name: string; value: string }>;
}> {
  const session = sessions.get(sessionId);
  if (!session) return { success: false, sessionId, error: `No session: ${sessionId}` };
  try {
    const [content, links, inputs] = await Promise.all([
      session.page.evaluate(() => document.body?.innerText?.slice(0, 50000) ?? ""),
      session.page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]")).slice(0, 100).map(a => ({
          text: (a as HTMLAnchorElement).innerText?.trim().slice(0, 100) ?? "",
          href: (a as HTMLAnchorElement).href,
        }))
      ),
      session.page.evaluate(() =>
        Array.from(document.querySelectorAll("input, textarea, select")).slice(0, 50).map(el => ({
          type: (el as HTMLInputElement).type ?? el.tagName.toLowerCase(),
          name: (el as HTMLInputElement).name ?? (el as HTMLInputElement).id ?? "",
          value: (el as HTMLInputElement).value ?? "",
        }))
      ),
    ]);
    return {
      success: true,
      sessionId,
      url: session.page.url(),
      title: await session.page.title(),
      content,
      links,
      inputs,
    };
  } catch (err) {
    return { success: false, sessionId, error: String(err) };
  }
}

/**
 * Execute JavaScript in the page context.
 */
export async function browserEval(js: string, sessionId: string): Promise<BrowserActionResult & { result?: unknown }> {
  const session = sessions.get(sessionId);
  if (!session) return { success: false, sessionId, error: `No session: ${sessionId}` };
  try {
    const result = await session.page.evaluate(js);
    return { success: true, sessionId, result };
  } catch (err) {
    return { success: false, sessionId, error: String(err) };
  }
}

/**
 * Close a specific browser session (or all sessions if no ID given).
 */
export async function closeBrowser(sessionId?: string): Promise<void> {
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
      await session.browser.close().catch(() => {});
      sessions.delete(sessionId);
    }
  } else {
    for (const [id, session] of sessions) {
      await session.browser.close().catch(() => {});
      sessions.delete(id);
    }
  }
}

/**
 * List all active browser sessions.
 */
export function listBrowserSessions(): Array<{ id: string; url: string; age: number }> {
  return Array.from(sessions.entries()).map(([id, s]) => ({
    id,
    url: s.url,
    age: Date.now() - s.createdAt,
  }));
}
