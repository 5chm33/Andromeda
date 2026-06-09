/**
 * visualGroundingTool.ts — v1.0.0
 *
 * Registers visual grounding tools with the agent tool registry.
 * Gives the LLM "eyes" — it can see annotated screenshots with numbered
 * bounding boxes over all interactive elements and reference them by index.
 *
 * Tools registered:
 *   - visual_screenshot: Take an annotated screenshot with numbered elements
 *   - visual_full_page: Take a full-page stitched screenshot
 *   - visual_click_index: Click an element by its index number
 *   - visual_save_screenshot: Save annotated screenshot to a file path
 */

import { registerTool } from "./toolRegistry.js";
import type { ToolResult } from "./toolRegistry.js";
import {
  annotatedScreenshot,
  fullPageScreenshot,
  clickByIndex,
  saveAnnotatedScreenshot,
  type VisualElement,
} from "../visualGrounding.js";

// Session-scoped element cache so visual_click_index can reference the last screenshot
const _elementCache = new Map<string, VisualElement[]>();

/**
 * Registers all visual grounding tools with the agent tool registry.
 */
export function registerVisualGroundingTools(): void {
  // visual_screenshot
  registerTool({
    name: "visual_screenshot",
    description: "Takes an annotated screenshot with numbered bounding boxes over interactive elements.",
    category: "browser",
    safety: "safe",
    definition: {
      type: "function",
      function: {
        name: "visual_screenshot",
        description: "Takes an annotated screenshot of a web page with numbered bounding boxes drawn over every interactive element (buttons, links, inputs, etc.). Returns base64 PNG + element list. Use visual_click_index to click by index.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to navigate to. Omit to screenshot the current page." },
            session_id: { type: "string", description: "Visual grounding session ID (optional, defaults to 'default')" },
          },
          required: [],
        },
      },
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const url = typeof args.url === "string" ? args.url : null;
      const sessionId = typeof args.session_id === "string" ? args.session_id : "default";
      const result = await annotatedScreenshot(url, sessionId);
      _elementCache.set(sessionId, result.elements);
      const elementList = result.elements.slice(0, 50).map(
        (el) => `[${el.index}] ${el.tag}${el.role ? `[role=${el.role}]` : ""}: "${el.text || el.ariaLabel || el.placeholder || el.href || "(no text)"}" at (${el.centerX}, ${el.centerY})`
      ).join("\n");
      return {
        success: true,
        output: `Captured ${result.elements.length} interactive elements on ${result.url}\n\n${elementList}`,
        data: {
          screenshot_base64: result.annotatedScreenshot,
          url: result.url,
          title: result.title,
          viewport: result.viewport,
          element_count: result.elements.length,
          note: "Use visual_click_index to click any element by its [index] number shown above.",
        },
      };
    },
  });

  // visual_full_page
  registerTool({
    name: "visual_full_page",
    description: "Takes a full-page screenshot of the entire scrollable page.",
    category: "browser",
    safety: "safe",
    definition: {
      type: "function",
      function: {
        name: "visual_full_page",
        description: "Takes a full-page screenshot by capturing the entire scrollable page (not just the viewport). Returns a single tall PNG showing everything.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to navigate to and capture" },
            session_id: { type: "string", description: "Visual grounding session ID (optional)" },
          },
          required: ["url"],
        },
      },
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const url = String(args.url ?? "");
      const sessionId = typeof args.session_id === "string" ? args.session_id : "default";
      const result = await fullPageScreenshot(url, sessionId);
      return {
        success: true,
        output: `Full-page screenshot captured: ${result.url} (${result.pageSize.width}x${result.pageSize.height}px)`,
        data: {
          screenshot_base64: result.fullPageScreenshot,
          page_size: result.pageSize,
          url: result.url,
          title: result.title,
        },
      };
    },
  });

  // visual_click_index
  registerTool({
    name: "visual_click_index",
    description: "Clicks an element by its index number from the most recent visual_screenshot call.",
    category: "browser",
    safety: "moderate",
    definition: {
      type: "function",
      function: {
        name: "visual_click_index",
        description: "Clicks an element by its index number from the most recent visual_screenshot call. Always call visual_screenshot first.",
        parameters: {
          type: "object",
          properties: {
            index: { type: "number", description: "Element index number from the visual_screenshot element list (1-based)" },
            session_id: { type: "string", description: "Visual grounding session ID (must match the session used in visual_screenshot)" },
          },
          required: ["index"],
        },
      },
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const index = Number(args.index ?? 0);
      const sessionId = typeof args.session_id === "string" ? args.session_id : "default";
      const elements = _elementCache.get(sessionId);
      if (!elements || elements.length === 0) {
        return { success: false, output: "No element cache found for this session.", error: "Call visual_screenshot first." };
      }
      const clickResult = await clickByIndex(index, elements, sessionId);
      return {
        success: clickResult.success,
        output: clickResult.success ? `Clicked element [${index}]` : `Failed to click element [${index}]: ${clickResult.error ?? "unknown error"}`,
        error: clickResult.success ? undefined : (clickResult.error ?? "click failed"),
        data: clickResult as unknown as Record<string, unknown>,
      };
    },
  });

  // visual_save_screenshot
  registerTool({
    name: "visual_save_screenshot",
    description: "Takes an annotated screenshot and saves it to a temp file.",
    category: "browser",
    safety: "safe",
    definition: {
      type: "function",
      function: {
        name: "visual_save_screenshot",
        description: "Takes an annotated screenshot and saves it to a temp file. Returns the file path.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to navigate to and screenshot" },
            session_id: { type: "string", description: "Visual grounding session ID (optional)" },
          },
          required: ["url"],
        },
      },
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const url = String(args.url ?? "");
      const sessionId = typeof args.session_id === "string" ? args.session_id : "default";
      const result = await saveAnnotatedScreenshot(url, sessionId);
      return {
        success: true,
        output: `Screenshot saved to ${result.filePath} (${result.elements.length} elements annotated)`,
        data: { file_path: result.filePath, element_count: result.elements.length, url: result.url, title: result.title },
        artifacts: [{ name: "annotated_screenshot.png", path: result.filePath, type: "image/png" }],
      };
    },
  });
}
