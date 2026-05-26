/**
 * browserTools.ts — v6.18
 *
 * Registers Playwright-based browser interaction tools with the agent tool registry.
 * Provides navigate, click, type, screenshot, and extract_data tools.
 */
import {
  browserNavigate, browserClick, browserType,
  browserScreenshot, browserExtractData, browserEval,
  closeBrowser, listBrowserSessions,
} from "../browser.js";
import type { ToolDefinition } from "../toolRegistry.js";

export const browserToolDefinitions: ToolDefinition[] = [
  {
    name: "browser_navigate",
    description: "Navigate a browser session to a URL. Returns page title and URL. Use this before clicking or extracting data.",
    category: "browser",
    safetyLevel: "medium",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to navigate to (must be http:// or https://)" },
        session_id: { type: "string", description: "Browser session ID (optional, creates new session if omitted)" },
      },
      required: ["url"],
    },
    execute: async (args: { url: string; session_id?: string }) => {
      const result = await browserNavigate(args.url, args.session_id);
      if (!result.success) return { error: result.error };
      return { session_id: result.sessionId, url: result.url, title: result.title };
    },
  },
  {
    name: "browser_click",
    description: "Click an element on the current page using a CSS selector or visible text.",
    category: "browser",
    safetyLevel: "medium",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector or visible text to click" },
        session_id: { type: "string", description: "Browser session ID" },
      },
      required: ["selector", "session_id"],
    },
    execute: async (args: { selector: string; session_id: string }) => {
      // v6.23: Try CSS selector first; if it fails, fall back to vision-based coordinate click
      const result = await browserClick(args.selector, args.session_id);
      if (result.success) return { success: true, url: result.url };
      // CSS selector failed — try vision fallback
      const visionResult = await browserClickVision(args.selector, args.session_id);
      if (visionResult.success) return { success: true, url: visionResult.url, method: "vision_fallback" };
      return { error: `CSS selector failed: ${result.error}. Vision fallback failed: ${visionResult.error}` };
    },
  },
  {
    name: "browser_type",
    description: "Type text into an input field on the current page.",
    category: "browser",
    safetyLevel: "medium",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector, label, or placeholder of the input field" },
        text: { type: "string", description: "Text to type into the field" },
        session_id: { type: "string", description: "Browser session ID" },
      },
      required: ["selector", "text", "session_id"],
    },
    execute: async (args: { selector: string; text: string; session_id: string }) => {
      const result = await browserType(args.selector, args.text, args.session_id);
      if (!result.success) return { error: result.error };
      return { success: true };
    },
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of the current browser page. Returns base64-encoded PNG.",
    category: "browser",
    safetyLevel: "low",
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Browser session ID" },
      },
      required: ["session_id"],
    },
    execute: async (args: { session_id: string }) => {
      const result = await browserScreenshot(args.session_id);
      if (!result.success) return { error: result.error };
      return { session_id: result.sessionId, screenshot_base64: result.screenshot };
    },
  },
  {
    name: "browser_click_vision",
    description: "v6.23: Click an element using AI vision — takes a screenshot, identifies the element by description, and clicks its pixel coordinates. Use this when browser_click fails due to dynamic CSS class names (React/Next.js apps).",
    category: "browser",
    safetyLevel: "medium",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "Natural language description of the element to click, e.g. 'the blue Submit button' or 'the search icon in the top right'" },
        session_id: { type: "string", description: "Browser session ID" },
      },
      required: ["description", "session_id"],
    },
    execute: async (args: { description: string; session_id: string }) => {
      const result = await browserClickVision(args.description, args.session_id);
      if (!result.success) return { error: result.error };
      return { success: true, url: result.url };
    },
  },
  {
    name: "browser_extract_data",
    description: "Extract text content, links, and form inputs from the current page.",
    category: "browser",
    safetyLevel: "low",
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Browser session ID" },
      },
      required: ["session_id"],
    },
    execute: async (args: { session_id: string }) => {
      const result = await browserExtractData(args.session_id);
      if (!result.success) return { error: result.error };
      return {
        url: result.url,
        title: result.title,
        content: result.content?.slice(0, 10000),
        links: result.links?.slice(0, 50),
        inputs: result.inputs,
      };
    },
  },
  {
    name: "browser_eval",
    description: "Execute JavaScript in the current page context. Use for DOM manipulation or data extraction.",
    category: "browser",
    safetyLevel: "high",
    parameters: {
      type: "object",
      properties: {
        javascript: { type: "string", description: "JavaScript code to execute in the page context" },
        session_id: { type: "string", description: "Browser session ID" },
      },
      required: ["javascript", "session_id"],
    },
    execute: async (args: { javascript: string; session_id: string }) => {
      const result = await browserEval(args.javascript, args.session_id);
      if (!result.success) return { error: result.error };
      return { result: result.result };
    },
  },
  {
    name: "browser_close",
    description: "Close a browser session to free resources.",
    category: "browser",
    safetyLevel: "low",
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Browser session ID to close (omit to close all)" },
      },
    },
    execute: async (args: { session_id?: string }) => {
      await closeBrowser(args.session_id);
      return { success: true };
    },
  },
  {
    name: "browser_list_sessions",
    description: "List all active browser sessions.",
    category: "browser",
    safetyLevel: "low",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ sessions: listBrowserSessions() }),
  },
];
