/**
 * vision.ts — Vision Tool (Screenshot + LLM Analysis)
 * Andromeda v5.39 (SOTA upgrade)
 *
 * Gives the agent "eyes" — the ability to:
 *  1. Take screenshots of URLs or local HTML files
 *  2. Analyze images using vision-capable LLMs
 *  3. Compare before/after screenshots for UI verification
 *
 * Uses Playwright (already a dependency) for screenshots
 * and the OpenAI-compatible API for vision analysis.
 */

import { registerTool } from "./toolRegistry";
import type { ToolExecutionContext, ToolResult } from "./toolRegistry";
import { readFile,  mkdir } from "fs/promises";
import { join,  extname } from "path";
import { existsSync } from "fs";
import { randomUUID } from "crypto";

// ─── Screenshot Capture ────────────────────────────────────────────────────

interface ScreenshotOptions {
  url: string;
  fullPage?: boolean;
  width?: number;
  height?: number;
  waitMs?: number;
  selector?: string;
}

async function captureScreenshot(options: ScreenshotOptions): Promise<{ path: string; error?: string }> {
  const { url, fullPage = true, width = 1280, height = 800, waitMs = 2000, selector } = options;

  // Dynamic import to avoid breaking if playwright isn't installed
  let chromium: any;
  try {
    const pw = await import("playwright-core");
    chromium = pw.chromium;
  } catch {
    return { path: "", error: "Playwright not installed. Run: npm install playwright-core" };
  }

  // Find Chromium
  const possiblePaths = [
    process.env.CHROMIUM_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);

  let executablePath: string | undefined;
  for (const p of possiblePaths) {
    if (p && existsSync(p)) { executablePath = p; break; }
  }

  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });

    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2, // Retina quality
    });

    const page = await context.newPage();

    // Handle both URLs and local file paths
    const targetUrl = url.startsWith("http") ? url : `file://${url}`;
    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30000 }).catch(() =>
      page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
    );

    if (waitMs > 0) await page.waitForTimeout(waitMs);

    // Generate screenshot path
    const screenshotDir = join(process.cwd(), ".screenshots");
    await mkdir(screenshotDir, { recursive: true });
    const filename = `screenshot-${randomUUID().slice(0, 8)}.png`;
    const screenshotPath = join(screenshotDir, filename);

    if (selector) {
      const element = await page.$(selector);
      if (element) {
        await element.screenshot({ path: screenshotPath });
      } else {
        await page.screenshot({ path: screenshotPath, fullPage });
      }
    } else {
      await page.screenshot({ path: screenshotPath, fullPage });
    }

    await browser.close();
    return { path: screenshotPath };
  } catch (err) {
    if (browser) try { await browser.close(); } catch {}
    return { path: "", error: `Screenshot failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Vision Analysis via LLM ──────────────────────────────────────────────

async function analyzeImageWithVision(
  imagePath: string,
  prompt: string,
): Promise<{ analysis: string; error?: string }> {
  try {
    const imageBuffer = await readFile(imagePath);
    const base64Image = imageBuffer.toString("base64");
    const ext = extname(imagePath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";

    // Use OpenAI-compatible API with vision model
    const apiKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "";
    const baseUrl = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || "https://api.openai.com/v1";

    // Try vision-capable models in order of preference
    const visionModels = [
      "gpt-4.1-mini",      // OpenAI vision
      "gpt-4o-mini",       // OpenAI vision
      "gpt-4o",            // OpenAI vision
      "gemini-2.5-flash",  // Google vision via OpenAI-compatible
    ];

    const model = process.env.VISION_MODEL || visionModels[0];

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
        max_tokens: 4096,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      // If vision model fails, provide a fallback text description
      return {
        analysis: `[Vision analysis unavailable — model ${model} returned ${response.status}. Screenshot saved at: ${imagePath}]`,
        error: `Vision API error: ${response.status} — ${errBody.slice(0, 200)}`,
      };
    }

    const data = await response.json() as any;
    const analysis = data.choices?.[0]?.message?.content ?? "No analysis returned";
    return { analysis };
  } catch (err) {
    return {
      analysis: `[Vision analysis failed. Screenshot saved at: ${imagePath}]`,
      error: `Vision error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Tool: screenshot ──────────────────────────────────────────────────────

async function executeScreenshot(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const url = String(args.url ?? "");
  if (!url.trim()) {
    return { success: false, output: "", error: "url is required (can be a URL or local file path)" };
  }

  const result = await captureScreenshot({
    url,
    fullPage: args.fullPage !== false,
    width: Number(args.width) || 1280,
    height: Number(args.height) || 800,
    waitMs: Number(args.waitMs) || 2000,
    selector: args.selector ? String(args.selector) : undefined,
  });

  if (result.error) {
    return { success: false, output: "", error: result.error };
  }

  // If analysis prompt provided, also analyze the screenshot
  const analyzePrompt = args.analyze ? String(args.analyze) : null;
  if (analyzePrompt) {
    const analysis = await analyzeImageWithVision(result.path, analyzePrompt);
    return {
      success: true,
      output: `Screenshot saved: ${result.path}\n\n--- Vision Analysis ---\n${analysis.analysis}${analysis.error ? `\n\n[Warning: ${analysis.error}]` : ""}`,
    };
  }

  return { success: true, output: `Screenshot saved: ${result.path}` };
}

// ─── Tool: analyze_image ───────────────────────────────────────────────────

async function executeAnalyzeImage(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const imagePath = String(args.path ?? "");
  const prompt = String(args.prompt ?? "Describe this image in detail.");

  if (!imagePath.trim()) {
    return { success: false, output: "", error: "path is required (path to an image file)" };
  }

  if (!existsSync(imagePath)) {
    return { success: false, output: "", error: `Image file not found: ${imagePath}` };
  }

  const result = await analyzeImageWithVision(imagePath, prompt);
  return {
    success: !result.error || result.analysis.length > 0,
    output: result.analysis,
    error: result.error,
  };
}

// ─── Tool: visual_verify ──────────────────────────────────────────────────

async function executeVisualVerify(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const url = String(args.url ?? "");
  const expectations = String(args.expectations ?? "");

  if (!url.trim()) {
    return { success: false, output: "", error: "url is required" };
  }

  // Take screenshot
  const screenshot = await captureScreenshot({
    url,
    fullPage: args.fullPage !== false,
    width: Number(args.width) || 1280,
    height: Number(args.height) || 800,
    waitMs: Number(args.waitMs) || 3000,
  });

  if (screenshot.error) {
    return { success: false, output: "", error: screenshot.error };
  }

  // Analyze with expectations
  const verifyPrompt = `You are a QA engineer reviewing a web page screenshot. Verify the following expectations and report any issues:

EXPECTATIONS:
${expectations || "Check that the page renders correctly with no obvious visual bugs, broken layouts, or missing content."}

For each expectation, report:
- PASS: if the expectation is met
- FAIL: if the expectation is not met, with details
- WARN: if something looks off but isn't a clear failure

End with an overall VERDICT: PASS, FAIL, or NEEDS_ATTENTION.`;

  const analysis = await analyzeImageWithVision(screenshot.path, verifyPrompt);
  return {
    success: true,
    output: `Screenshot: ${screenshot.path}\n\n${analysis.analysis}${analysis.error ? `\n\n[Note: ${analysis.error}]` : ""}`,
  };
}

// ─── Register Tools ────────────────────────────────────────────────────────

registerTool({
  name: "screenshot",
  description: "Take a screenshot of a URL or local HTML file. Optionally analyze it with vision AI.",
  category: "vision",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "screenshot",
      description: "Take a screenshot of a web page or local HTML file. Returns the saved screenshot path. Optionally pass an 'analyze' prompt to also get AI vision analysis of the screenshot.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to screenshot (http/https) or local file path" },
          analyze: { type: "string", description: "Optional: prompt for AI vision analysis of the screenshot (e.g., 'Does this page have a navigation bar?')" },
          fullPage: { type: "boolean", description: "Capture the full page or just the viewport (default: true)" },
          width: { type: "number", description: "Viewport width in pixels (default: 1280)" },
          height: { type: "number", description: "Viewport height in pixels (default: 800)" },
          waitMs: { type: "number", description: "Wait time in ms after page load (default: 2000)" },
          selector: { type: "string", description: "CSS selector to screenshot a specific element" },
        },
        required: ["url"],
      },
    },
  },
  execute: executeScreenshot,
});

registerTool({
  name: "analyze_image",
  description: "Analyze an image file using AI vision. Can describe content, read text, identify UI elements, etc.",
  category: "vision",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "analyze_image",
      description: "Analyze an image file using AI vision. Pass a local image path and a prompt describing what you want to know. Can describe content, read text in images, identify UI elements, check layouts, etc.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the image file to analyze" },
          prompt: { type: "string", description: "What to analyze or look for in the image (default: 'Describe this image in detail.')" },
        },
        required: ["path"],
      },
    },
  },
  execute: executeAnalyzeImage,
});

registerTool({
  name: "visual_verify",
  description: "Take a screenshot and verify it meets visual expectations using AI vision (QA tool).",
  category: "vision",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "visual_verify",
      description: "QA tool: Take a screenshot of a URL and verify it meets visual expectations. The AI vision model acts as a QA engineer, checking each expectation and reporting PASS/FAIL/WARN. Use after building UI components to verify they render correctly.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL or local file path to verify" },
          expectations: { type: "string", description: "What to verify (e.g., 'Page has a header with logo, navigation menu with 3 items, and a hero section with a CTA button')" },
          fullPage: { type: "boolean", description: "Capture full page (default: true)" },
          width: { type: "number", description: "Viewport width (default: 1280)" },
          height: { type: "number", description: "Viewport height (default: 800)" },
          waitMs: { type: "number", description: "Wait time after load (default: 3000)" },
        },
        required: ["url"],
      },
    },
  },
  execute: executeVisualVerify,
});
