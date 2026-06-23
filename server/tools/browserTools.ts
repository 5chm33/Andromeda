/**
 * browserTools.ts — v6.35
 *
 * Registers Playwright-based browser interaction tools with the agent tool registry.
 * Provides navigate, click, type, screenshot, and extract_data tools.
 *
 * v6.35: Vision-first click — browser_click now tries vision coordinate click first,
 * falls back to CSS selector. Added browser_navigate_and_click composite tool.
 */
import {
  browserNavigate, browserClick, browserType,
  browserScreenshot, browserExtractData, browserEval,
  closeBrowser, listBrowserSessions, browserClickVision,
} from "../browser.js";
// browserTools uses its own extended tool shape (name, description, category, safetyLevel, parameters, execute)
// This is different from the LLM-facing ToolDefinition (which is { type: "function", function: {...} })
interface BrowserToolDef {
  name: string;
  description: string;
  category: string;
  safetyLevel: string;
  parameters: Record<string, unknown>;
  execute: (...args: any[]) => Promise<any>;
}
export const browserToolDefinitions: BrowserToolDef[] = [
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
    description: "v6.35: Click an element on the current page. Vision-first: takes a screenshot and uses AI to identify the element by its description/selector, then clicks by pixel coordinates. Falls back to CSS selector if vision fails.",
    category: "browser",
    safetyLevel: "medium",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Natural language description OR CSS selector of the element to click, e.g. 'the blue Submit button' or '#submit-btn'" },
        session_id: { type: "string", description: "Browser session ID" },
      },
      required: ["selector", "session_id"],
    },
    execute: async (args: { selector: string; session_id: string }) => {
      // v6.35: Vision-first — try vision coordinate click first (works on React/Next.js dynamic class names)
      const visionResult = await browserClickVision(args.selector, args.session_id);
      if (visionResult.success) return { success: true, url: visionResult.url, method: "vision_primary" };
      // Vision failed — fall back to CSS selector
      const result = await browserClick(args.selector, args.session_id);
      if (result.success) return { success: true, url: result.url, method: "css_fallback" };
      return { error: `Vision click failed: ${visionResult.error}. CSS fallback also failed: ${result.error}` };
    },
  },
  {
    name: "browser_navigate_and_click",
    description: "v6.35: Composite tool — navigate to a URL then immediately click an element using vision. Useful for single-step form submissions and link following.",
    category: "browser",
    safetyLevel: "medium",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to navigate to" },
        element_description: { type: "string", description: "Natural language description of the element to click after navigation" },
        session_id: { type: "string", description: "Browser session ID (optional)" },
      },
      required: ["url", "element_description"],
    },
    execute: async (args: { url: string; element_description: string; session_id?: string }) => {
      const navResult = await browserNavigate(args.url, args.session_id);
      if (!navResult.success) return { error: `Navigation failed: ${navResult.error}` };
      // Wait briefly for page to settle
      await new Promise(r => setTimeout(r, 800));
      const clickResult = await browserClickVision(args.element_description, navResult.sessionId!);
      if (clickResult.success) return { success: true, navigated_to: navResult.url, clicked: args.element_description, final_url: clickResult.url, method: "vision" };
      // Vision failed — try CSS
      const cssResult = await browserClick(args.element_description, navResult.sessionId!);
      if (cssResult.success) return { success: true, navigated_to: navResult.url, clicked: args.element_description, final_url: cssResult.url, method: "css_fallback" };
      return { error: `Navigated to ${navResult.url} but click failed. Vision: ${clickResult.error}. CSS: ${cssResult.error}` };
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
    description: "Click an element using AI vision — takes a screenshot, identifies the element by natural language description, and clicks its pixel coordinates. Preferred over browser_click for React/Next.js apps with dynamic class names.",
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
