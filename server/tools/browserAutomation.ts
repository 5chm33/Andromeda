/**
 * browserAutomation.ts — Full Browser Automation Tool
 * Andromeda v6.14
 *
 * Gives the agent full interactive browser control:
 *  - Navigate to URLs
 *  - Click elements by selector or text
 *  - Type into input fields
 *  - Scroll pages
 *  - Extract structured data (tables, lists, links)
 *  - Fill forms
 *  - Wait for elements
 *  - Execute JavaScript in page context
 *
 * Uses Playwright (already a dependency) with a persistent browser session.
 */

import { registerTool } from "./toolRegistry";
import type { ToolExecutionContext, ToolResult } from "./toolRegistry";
import { existsSync } from "fs";
// import { mkdir } from "fs/promises";
// import { join } from "path";
// import { randomUUID } from "crypto";

// ─── Persistent Browser Session ────────────────────────────────────────────

let browserInstance: any = null;
let browserContext: any = null;
let activePage: any = null;
let lastNavigatedUrl = "";

const BROWSER_TIMEOUT = 30_000;
const MAX_CONTENT_LENGTH = 200_000; // v5.43: Increased for full page reads

function getChromiumPath(): string | undefined {
  const paths = [
    process.env.CHROMIUM_PATH,
    // Windows: Chrome, Edge, Brave
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    // Linux
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/microsoft-edge",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

async function ensureBrowser(): Promise<{ page: any; error?: string }> {
  if (activePage) {
    try {
      await activePage.title(); // Verify page is still alive
      return { page: activePage };
    } catch {
      // Page died, recreate
      activePage = null;
    }
  }

  try {
    const pw = await import("playwright-core");

    if (!browserInstance) {
      const execPath = getChromiumPath();
      // v6.14: On Windows, if no executable found, try 'chrome' channel (Docker Desktop / installed Chrome)
      const launchOpts: Record<string, unknown> = {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          "--disable-extensions",
        ],
      };
      if (execPath) {
        launchOpts.executablePath = execPath;
      } else if (process.platform === "win32") {
        // Let Playwright find Chrome via its channel detection on Windows
        launchOpts.channel = "chrome";
      }
      browserInstance = await pw.chromium.launch(launchOpts);
    }

    if (!browserContext) {
      browserContext = await browserInstance.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
        javaScriptEnabled: true,
      });
    }

    activePage = await browserContext.newPage();
    return { page: activePage };
  } catch (err) {
    return { page: null, error: `Browser init failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Helper: Extract page content ──────────────────────────────────────────

async function extractPageContent(page: any): Promise<string> {
  try {
    const content = await page.evaluate(() => {
      const noise = document.querySelectorAll("script, style, noscript, svg, [aria-hidden='true']");
      noise.forEach((el: Element) => el.remove());
      const main = document.querySelector("main") || document.querySelector("article") || document.body;
      return main ? main.innerText : document.body.innerText;
    });
    let text = content.replace(/\s{3,}/g, "\n\n").replace(/\n{4,}/g, "\n\n\n").trim();
    if (text.length > MAX_CONTENT_LENGTH) {
      text = text.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated]";
    }
    return text;
  } catch {
    return "[Failed to extract page content]";
  }
}

// ─── Tool: browser_navigate ────────────────────────────────────────────────

async function executeBrowserNavigate(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const url = String(args.url ?? "");
  if (!url.trim()) return { success: false, output: "", error: "url is required" };

  const { page, error } = await ensureBrowser();
  if (error) return { success: false, output: "", error };

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: BROWSER_TIMEOUT });
    await page.waitForTimeout(Number(args.waitMs) || 1500);
    lastNavigatedUrl = url;

    const title = await page.title();
    const pageUrl = page.url();
    const content = await extractPageContent(page);

    return {
      success: true,
      output: `Navigated to: ${pageUrl}\nTitle: ${title}\n\n--- Page Content ---\n${content}`,
    };
  } catch (err) {
    return { success: false, output: "", error: `Navigation failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Tool: browser_click ───────────────────────────────────────────────────

async function executeBrowserClick(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const selector = String(args.selector ?? "");
  const text = args.text ? String(args.text) : null;

  if (!selector && !text) return { success: false, output: "", error: "Either 'selector' or 'text' is required" };

  const { page, error } = await ensureBrowser();
  if (error) return { success: false, output: "", error };

  try {
    if (text) {
      // Click by visible text
      await page.getByText(text, { exact: false }).first().click({ timeout: BROWSER_TIMEOUT });
    } else {
      await page.click(selector, { timeout: BROWSER_TIMEOUT });
    }
    await page.waitForTimeout(1000);

    const title = await page.title();
    const pageUrl = page.url();
    const content = await extractPageContent(page);

    return {
      success: true,
      output: `Clicked: ${text ? `text "${text}"` : selector}\nCurrent URL: ${pageUrl}\nTitle: ${title}\n\n--- Page Content ---\n${content.slice(0, 20000)}`,
    };
  } catch (err) {
    return { success: false, output: "", error: `Click failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Tool: browser_type ────────────────────────────────────────────────────

async function executeBrowserType(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const selector = String(args.selector ?? "");
  const value = String(args.value ?? "");
  const pressEnter = args.pressEnter === true;
  const clear = args.clear !== false;

  if (!selector) return { success: false, output: "", error: "selector is required" };

  const { page, error } = await ensureBrowser();
  if (error) return { success: false, output: "", error };

  try {
    if (clear) {
      await page.fill(selector, value, { timeout: BROWSER_TIMEOUT });
    } else {
      await page.type(selector, value, { timeout: BROWSER_TIMEOUT });
    }

    if (pressEnter) {
      await page.press(selector, "Enter");
      await page.waitForTimeout(1500);
    }

    return {
      success: true,
      output: `Typed "${value.slice(0, 100)}${value.length > 100 ? "..." : ""}" into ${selector}${pressEnter ? " (pressed Enter)" : ""}`,
    };
  } catch (err) {
    return { success: false, output: "", error: `Type failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Tool: browser_scroll ──────────────────────────────────────────────────

async function executeBrowserScroll(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const direction = String(args.direction ?? "down").toLowerCase();
  const amount = Number(args.amount) || 500;

  const { page, error } = await ensureBrowser();
  if (error) return { success: false, output: "", error };

  try {
    const deltaY = direction === "up" ? -amount : amount;
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(500);

    const content = await extractPageContent(page);
    return {
      success: true,
      output: `Scrolled ${direction} by ${amount}px\n\n--- Visible Content ---\n${content.slice(0, 20000)}`,
    };
  } catch (err) {
    return { success: false, output: "", error: `Scroll failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Tool: browser_extract ─────────────────────────────────────────────────

async function executeBrowserExtract(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const extractType = String(args.type ?? "text").toLowerCase();
  const selector = args.selector ? String(args.selector) : null;

  const { page, error } = await ensureBrowser();
  if (error) return { success: false, output: "", error };

  try {
    let result: string;

    switch (extractType) {
      case "links": {
        const links = await page.evaluate((sel: string | null) => {
          const container = sel ? document.querySelector(sel) : document;
          if (!container) return [];
          const anchors = container.querySelectorAll("a[href]");
          return Array.from(anchors).map((a: any) => ({
            text: a.innerText.trim().slice(0, 100),
            href: a.href,
          })).filter((l: any) => l.text && l.href);
        }, selector);
        result = `Found ${links.length} links:\n` + links.map((l: any) => `- [${l.text}](${l.href})`).join("\n");
        break;
      }

      case "tables": {
        const tables = await page.evaluate((sel: string | null) => {
          const container = sel ? document.querySelector(sel) : document;
          if (!container) return [];
          const tbls = container.querySelectorAll("table");
          return Array.from(tbls).map((table: any) => {
            const rows = Array.from(table.querySelectorAll("tr"));
            return rows.map((row: any) => {
              const cells = Array.from(row.querySelectorAll("th, td"));
              return cells.map((cell: any) => cell.innerText.trim());
            });
          });
        }, selector);
        result = tables.map((table: any, i: number) => {
          const header = table[0]?.join(" | ") ?? "";
          const sep = table[0]?.map(() => "---").join(" | ") ?? "";
          const rows = table.slice(1).map((r: any) => r.join(" | ")).join("\n");
          return `Table ${i + 1}:\n| ${header} |\n| ${sep} |\n${rows ? rows.split("\n").map((r: string) => `| ${r} |`).join("\n") : "(empty)"}`;
        }).join("\n\n");
        break;
      }

      case "forms": {
        const forms = await page.evaluate((sel: string | null) => {
          const container = sel ? document.querySelector(sel) : document;
          if (!container) return [];
          const inputs = container.querySelectorAll("input, textarea, select, button[type='submit']");
          return Array.from(inputs).map((el: any) => ({
            tag: el.tagName.toLowerCase(),
            type: el.type || "",
            name: el.name || "",
            id: el.id || "",
            placeholder: el.placeholder || "",
            value: el.value || "",
            label: el.labels?.[0]?.innerText?.trim() || "",
          }));
        }, selector);
        result = `Found ${forms.length} form elements:\n` + forms.map((f: any) =>
          `- <${f.tag}> type="${f.type}" name="${f.name}" id="${f.id}" placeholder="${f.placeholder}" label="${f.label}"`
        ).join("\n");
        break;
      }

      case "text":
      default: {
        const content = await extractPageContent(page);
        result = content;
      }
    }

    return { success: true, output: result.slice(0, MAX_CONTENT_LENGTH) };
  } catch (err) {
    return { success: false, output: "", error: `Extract failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Tool: browser_execute_js ──────────────────────────────────────────────

async function executeBrowserJs(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const script = String(args.script ?? "");
  if (!script.trim()) return { success: false, output: "", error: "script is required" };

  const { page, error } = await ensureBrowser();
  if (error) return { success: false, output: "", error };

  try {
    const result = await page.evaluate(script);
    const output = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result ?? "undefined");
    return { success: true, output: output.slice(0, MAX_CONTENT_LENGTH) };
  } catch (err) {
    return { success: false, output: "", error: `JS execution failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Tool: browser_wait ────────────────────────────────────────────────────

async function executeBrowserWait(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const selector = args.selector ? String(args.selector) : null;
  const ms = Number(args.ms) || 2000;

  const { page, error } = await ensureBrowser();
  if (error) return { success: false, output: "", error };

  try {
    if (selector) {
      await page.waitForSelector(selector, { timeout: BROWSER_TIMEOUT });
      return { success: true, output: `Element found: ${selector}` };
    } else {
      await page.waitForTimeout(ms);
      return { success: true, output: `Waited ${ms}ms` };
    }
  } catch (err) {
    return { success: false, output: "", error: `Wait failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}


// ─── Tool: browser_screenshot ──────────────────────────────────────────────
async function executeBrowserScreenshot(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const { page, error } = await ensureBrowser();
  if (error) return { success: false, output: "", error };
  try {
    const fullPage = args.fullPage === true;
    const screenshotBuf = await page.screenshot({ type: "png", fullPage });
    const base64 = screenshotBuf.toString("base64");
    const url = page.url();
    const title = await page.title().catch(() => "unknown");
    const sizeKB = Math.round(base64.length / 1024);
    const preview = base64.slice(0, 200);
    return {
      success: true,
      output: "Screenshot captured from: " + url + "\nTitle: " + title + "\n[IMAGE:data:image/png;base64," + preview + "... (" + sizeKB + "KB total)]",
      data: { base64, mimeType: "image/png", url, title },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error: "Screenshot failed: " + msg };
  }
}

// ─── Cleanup ───────────────────────────────────────────────────────────────

export async function closeBrowser(): Promise<void> {
  try {
    if (browserInstance) {
      await browserInstance.close();
      browserInstance = null;
      browserContext = null;
      activePage = null;
    }
  } catch {}
}

// ─── Register All Browser Tools ────────────────────────────────────────────

registerTool({
  name: "browser_navigate",
  description: "Navigate the browser to a URL and return the page content.",
  category: "browser",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "browser_navigate",
      description: "Navigate the browser to a URL. Returns the page title and text content. The browser session persists between calls, so you can navigate, then click, then extract data.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to navigate to" },
          waitMs: { type: "number", description: "Wait time after page load in ms (default: 1500)" },
        },
        required: ["url"],
      },
    },
  },
  execute: executeBrowserNavigate,
});

registerTool({
  name: "browser_click",
  description: "Click an element on the current page by CSS selector or visible text.",
  category: "browser",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "browser_click",
      description: "Click an element on the current browser page. Provide either a CSS selector or visible text to click. Returns the page content after clicking.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the element to click (e.g., 'button.submit', '#login-btn')" },
          text: { type: "string", description: "Visible text of the element to click (e.g., 'Sign In', 'Submit')" },
        },
      },
    },
  },
  execute: executeBrowserClick,
});

registerTool({
  name: "browser_type",
  description: "Type text into an input field on the current page.",
  category: "browser",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "browser_type",
      description: "Type text into an input field on the current browser page. Can optionally press Enter after typing.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the input field (e.g., 'input[name=email]', '#search-box')" },
          value: { type: "string", description: "Text to type into the field" },
          pressEnter: { type: "boolean", description: "Press Enter after typing (default: false)" },
          clear: { type: "boolean", description: "Clear the field before typing (default: true)" },
        },
        required: ["selector", "value"],
      },
    },
  },
  execute: executeBrowserType,
});

registerTool({
  name: "browser_scroll",
  description: "Scroll the current page up or down.",
  category: "browser",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "browser_scroll",
      description: "Scroll the current browser page up or down. Returns the visible content after scrolling.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", description: "Scroll direction: 'up' or 'down' (default: 'down')", enum: ["up", "down"] },
          amount: { type: "number", description: "Scroll amount in pixels (default: 500)" },
        },
      },
    },
  },
  execute: executeBrowserScroll,
});

registerTool({
  name: "browser_extract",
  description: "Extract structured data from the current page: links, tables, forms, or text.",
  category: "browser",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "browser_extract",
      description: "Extract structured data from the current browser page. Can extract links, tables, form elements, or plain text. Optionally scope to a CSS selector.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "What to extract: 'text', 'links', 'tables', or 'forms'", enum: ["text", "links", "tables", "forms"] },
          selector: { type: "string", description: "Optional CSS selector to scope extraction to a specific element" },
        },
      },
    },
  },
  execute: executeBrowserExtract,
});

registerTool({
  name: "browser_execute_js",
  description: "Execute JavaScript in the current page context and return the result.",
  category: "browser",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "browser_execute_js",
      description: "Execute JavaScript code in the current browser page context. Returns the result. Use for DOM manipulation, data extraction, or page interaction that isn't covered by other browser tools.",
      parameters: {
        type: "object",
        properties: {
          script: { type: "string", description: "JavaScript code to execute in the page context" },
        },
        required: ["script"],
      },
    },
  },
  execute: executeBrowserJs,
});

registerTool({
  name: "browser_wait",
  description: "Wait for an element to appear or a fixed time delay.",
  category: "browser",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "browser_wait",
      description: "Wait for a CSS selector to appear on the page, or wait a fixed number of milliseconds. Use when pages need time to load dynamic content.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector to wait for (e.g., '.results-loaded', '#data-table')" },
          ms: { type: "number", description: "Milliseconds to wait (used if no selector provided, default: 2000)" },
        },
      },
    },
  },
  execute: executeBrowserWait,
});
registerTool({
  name: "browser_screenshot",
  description: "Capture a screenshot of the current browser page as a base64 PNG image. Use to visually inspect page state or pass to vision model.",
  category: "browser",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "browser_screenshot",
      description: "Capture a screenshot of the current browser page. Returns base64-encoded PNG image data. Use when you need to visually inspect the page or pass the screenshot to a vision-capable model for analysis.",
      parameters: {
        type: "object",
        properties: {
          fullPage: { type: "boolean", description: "Capture the full scrollable page (default: false, captures viewport only)" },
        },
      },
    },
  },
  execute: executeBrowserScreenshot,
});
