/**
 * toolMcpRoutes.ts — Tool registry and MCP server management endpoints
 *                    (extracted from streamRouter.ts v9.12.0)
 *
 * Routes:
 *   GET  /api/tools               — List all registered tools
 *   GET  /api/tools/definitions   — Get OpenAI-format tool definitions
 *   GET  /api/mcp/servers         — List MCP server configs and connection status
 *   POST /api/mcp/servers         — Add a new MCP server config
 *   DELETE /api/mcp/servers/:id   — Remove an MCP server config
 *   POST /api/mcp/connect/:id     — Connect to an MCP server
 *   POST /api/mcp/disconnect/:id  — Disconnect from an MCP server
 *   POST /api/mcp/connect-all     — Connect all enabled MCP servers
 *   GET  /api/llm/providers       — List LLM providers and active provider
 *   POST /api/llm/provider        — Set the active LLM provider
 */
import type { Express, Request, Response } from "express";
import { getToolDefinitions, getAllTools } from "../tools/toolRegistry.js";
import type { RegisteredTool } from "../tools/toolRegistry.js";
import { addServerConfig, removeServerConfig, getServerConfigs, getConnectionStatus, connectServer, disconnectServer, connectAllEnabled } from "../mcpClient.js";
import type { MCPServerConfig } from "../mcpClient.js";
import { getActiveProvider, setActiveProvider, listProviders } from "../llmProvider.js";

// ── Route registration ─────────────────────────────────────────────────────────

/**
 * Registers tool registry and MCP server management routes onto the Express app.
 * @param app Express application instance
 */
export function registerToolMcpRoutes(app: Express): void {

  // ── GET /api/llm/providers ─────────────────────────────────────────────────
  app.get("/api/llm/providers", (_req: Request, res: Response) => {
    res.json({ providers: listProviders(), active: getActiveProvider() });
  });

  // ── POST /api/llm/provider ─────────────────────────────────────────────────
  app.post("/api/llm/provider", (req: Request, res: Response) => {
    const config = req.body;
    if (!config?.id) { res.status(400).json({ error: "id is required" }); return; }
    setActiveProvider(config);
    res.json({ success: true, active: getActiveProvider() });
  });

  // ── GET /api/tools ─────────────────────────────────────────────────────────
  app.get("/api/tools", (_req: Request, res: Response) => {
    const tools = getAllTools().map((t: RegisteredTool) => ({
      name: t.name,
      description: t.description,
      category: t.category ?? "general",
      safety: t.safety ?? "safe",
    }));
    res.json({ tools });
  });

  // ── GET /api/tools/definitions ─────────────────────────────────────────────
  app.get("/api/tools/definitions", (_req: Request, res: Response) => {
    res.json({ definitions: getToolDefinitions() });
  });

  // ── GET /api/mcp/servers ───────────────────────────────────────────────────
  app.get("/api/mcp/servers", (_req: Request, res: Response) => {
    res.json({ servers: getServerConfigs(), connections: getConnectionStatus() });
  });

  // ── POST /api/mcp/servers ──────────────────────────────────────────────────
  app.post("/api/mcp/servers", (req: Request, res: Response) => {
    const config = req.body as MCPServerConfig;
    if (!config?.id || !config?.name) { res.status(400).json({ error: "id and name required" }); return; }
    addServerConfig(config);
    res.json({ success: true });
  });

  // ── DELETE /api/mcp/servers/:id ────────────────────────────────────────────
  app.delete("/api/mcp/servers/:id", (req: Request, res: Response) => {
    removeServerConfig(req.params.id);
    res.json({ success: true });
  });

  // ── POST /api/mcp/connect/:id ──────────────────────────────────────────────
  app.post("/api/mcp/connect/:id", async (req: Request, res: Response) => {
    try {
      const result = await connectServer(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── POST /api/mcp/disconnect/:id ───────────────────────────────────────────
  app.post("/api/mcp/disconnect/:id", (req: Request, res: Response) => {
    disconnectServer(req.params.id);
    res.json({ success: true });
  });

  // ── POST /api/mcp/connect-all ──────────────────────────────────────────────
  app.post("/api/mcp/connect-all", async (_req: Request, res: Response) => {
    try {
      await connectAllEnabled();
      res.json({ success: true, connections: getConnectionStatus() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}
