/**
 * webBrowse.ts — Web Browse / URL Fetch Tool
 * Andromeda v5.5
 */

import { registerTool } from "./toolRegistry";
import type { ToolExecutionContext, ToolResult } from "./toolRegistry";

async function executeWebBrowse(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const url = String(args.url ?? "");
  if (!url.trim()) {
    return { success: false, output: "", error: "url is required" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Andromeda/5.5 (AI Agent)",
        Accept: "text/html,application/xhtml+xml,text/plain,application/json",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    const contentType = resp.headers.get("content-type") ?? "";
    let body: string;

    if (contentType.includes("application/json")) {
      const json = await resp.json();
      body = JSON.stringify(json, null, 2);
    } else {
      body = await resp.text();
    }

    // Strip HTML tags for readability if it's HTML
    if (contentType.includes("text/html")) {
      // Remove scripts and styles
      body = body.replace(/<script[\s\S]*?<\/script>/gi, "");
      body = body.replace(/<style[\s\S]*?<\/style>/gi, "");
      body = body.replace(/<nav[\s\S]*?<\/nav>/gi, "");
      body = body.replace(/<footer[\s\S]*?<\/footer>/gi, "");
      // Convert common elements
      body = body.replace(/<br\s*\/?>/gi, "\n");
      body = body.replace(/<\/p>/gi, "\n\n");
      body = body.replace(/<\/h[1-6]>/gi, "\n\n");
      body = body.replace(/<\/li>/gi, "\n");
      body = body.replace(/<li[^>]*>/gi, "• ");
      // Strip remaining tags
      body = body.replace(/<[^>]+>/g, " ");
      // Clean whitespace
      body = body.replace(/[ \t]+/g, " ");
      body = body.replace(/\n{3,}/g, "\n\n");
      body = body.trim();
    }

    // Truncate if very long
    const maxLen = 80_000;
    if (body.length > maxLen) {
      body = body.slice(0, maxLen) + `\n\n... [truncated — ${body.length} chars total]`;
    }

    return {
      success: true,
      output: `URL: ${url}\nStatus: ${resp.status}\nContent-Type: ${contentType}\n\n${body}`,
    };
  } catch (err) {
    return { success: false, output: "", error: `Browse failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

registerTool({
  name: "web_browse",
  description: "Fetch and read the contents of a URL. Returns the page text with HTML tags stripped.",
  category: "browser",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "web_browse",
      description: "Fetch a URL and return its contents as readable text. HTML tags are stripped. Use for reading articles, documentation, API responses, and web pages.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to fetch" },
        },
        required: ["url"],
      },
    },
  },
  execute: executeWebBrowse,
});
