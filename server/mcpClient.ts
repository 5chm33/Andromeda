/**
 * mcpClient.ts — Model Context Protocol (MCP) Client
 * Andromeda v5.5
 *
 * Connects to external MCP servers (SSE or stdio) and dynamically
 * registers their tools into the Andromeda tool registry.
 *
 * Supports:
 *  - SSE transport (remote HTTP servers)
 *  - stdio transport (local command-line servers)
 *  - Dynamic tool discovery and registration
 *  - Connection lifecycle management
 */

import { spawn, type ChildProcess } from "child_process";
import { registerTool } from "./tools/toolRegistry";
import type { ToolExecutionContext, ToolResult } from "./tools/toolRegistry";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: "sse" | "stdio";
  url?: string;           // For SSE transport
  command?: string;        // For stdio transport
  args?: string[];         // For stdio transport
  env?: Record<string, string>;
  enabled: boolean;
}

interface MCPToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface MCPConnection {
  config: MCPServerConfig;
  tools: MCPToolSchema[];
  status: "connected" | "disconnected" | "error";
  error?: string;
  process?: ChildProcess;
  sseAbort?: AbortController;
  // For stdio: pending JSON-RPC requests
  pendingRequests: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  nextRequestId: number;
  stdioBuf: string;
}

// ─── State ──────────────────────────────────────────────────────────────────

const connections = new Map<string, MCPConnection>();
const serverConfigs: MCPServerConfig[] = [];

// ─── Public API ─────────────────────────────────────────────────────────────

export function addServerConfig(config: MCPServerConfig): void {
  const existing = serverConfigs.findIndex(c => c.id === config.id);
  if (existing >= 0) {
    serverConfigs[existing] = config;
  } else {
    serverConfigs.push(config);
  }
}

export function removeServerConfig(id: string): void {
  const idx = serverConfigs.findIndex(c => c.id === id);
  if (idx >= 0) serverConfigs.splice(idx, 1);
  disconnectServer(id);
}

export function getServerConfigs(): MCPServerConfig[] {
  return [...serverConfigs];
}

export function getConnectionStatus(): Array<{ id: string; name: string; status: string; tools: string[]; error?: string }> {
  return serverConfigs.map(c => {
    const conn = connections.get(c.id);
    return {
      id: c.id,
      name: c.name,
      status: conn?.status ?? "disconnected",
      tools: conn?.tools.map(t => t.name) ?? [],
      error: conn?.error,
    };
  });
}

// ─── Connect ────────────────────────────────────────────────────────────────

export async function connectServer(id: string): Promise<{ success: boolean; tools: string[]; error?: string }> {
  const config = serverConfigs.find(c => c.id === id);
  if (!config) return { success: false, tools: [], error: `Server "${id}" not found` };
  if (!config.enabled) return { success: false, tools: [], error: `Server "${id}" is disabled` };

  // Disconnect existing connection
  disconnectServer(id);

  const conn: MCPConnection = {
    config,
    tools: [],
    status: "disconnected",
    pendingRequests: new Map(),
    nextRequestId: 1,
    stdioBuf: "",
  };
  connections.set(id, conn);

  try {
    if (config.transport === "stdio" && config.command) {
      await connectStdio(conn);
    } else if (config.transport === "sse" && config.url) {
      await connectSSE(conn);
    } else {
      throw new Error(`Invalid transport config for "${id}"`);
    }

    conn.status = "connected";

    // Discover and register tools
    const tools = await discoverTools(conn);
    conn.tools = tools;

    for (const tool of tools) {
      registerMCPTool(conn, tool);
    }

    return { success: true, tools: tools.map(t => t.name) };
  } catch (err) {
    conn.status = "error";
    conn.error = err instanceof Error ? err.message : String(err);
    return { success: false, tools: [], error: conn.error };
  }
}

export function disconnectServer(id: string): void {
  const conn = connections.get(id);
  if (!conn) return;

  if (conn.process) {
    conn.process.kill("SIGTERM");
    conn.process = undefined;
  }
  if (conn.sseAbort) {
    conn.sseAbort.abort();
    conn.sseAbort = undefined;
  }

  // Reject pending requests
  for (const [, pending] of Array.from(conn.pendingRequests)) {
    pending.reject(new Error("Connection closed"));
  }
  conn.pendingRequests.clear();
  conn.status = "disconnected";
  connections.delete(id);
}

export async function connectAllEnabled(): Promise<void> {
  for (const config of serverConfigs) {
    if (config.enabled) {
      await connectServer(config.id).catch(err => {
        console.error(`[MCP] Failed to connect to ${config.id}:`, err);
      });
    }
  }
}

export function disconnectAll(): void {
  for (const id of Array.from(connections.keys())) {
    disconnectServer(id);
  }
}

// ─── stdio Transport ────────────────────────────────────────────────────────

async function connectStdio(conn: MCPConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(conn.config.command!, conn.config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...conn.config.env },
    });

    conn.process = proc;

    proc.on("error", (err) => {
      conn.status = "error";
      conn.error = err.message;
      reject(err);
    });

    proc.on("exit", (code) => {
      if (conn.status === "connected") {
        conn.status = "disconnected";
      }
    });

    // Parse JSON-RPC responses from stdout
    proc.stdout!.on("data", (data: Buffer) => {
      conn.stdioBuf += data.toString();
      processStdioBuffer(conn);
    });

    proc.stderr!.on("data", (data: Buffer) => {
      // Log stderr but don't fail
      console.error(`[MCP:${conn.config.id}] stderr:`, data.toString().trim());
    });

    // Send initialize request
    setTimeout(async () => {
      try {
        await sendJsonRpc(conn, "initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "Andromeda", version: "5.5" },
        });
        resolve();
      } catch (err) {
        reject(err);
      }
    }, 500);
  });
}

function processStdioBuffer(conn: MCPConnection): void {
  const lines = conn.stdioBuf.split("\n");
  conn.stdioBuf = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      if (msg.id !== undefined && conn.pendingRequests.has(msg.id)) {
        const pending = conn.pendingRequests.get(msg.id)!;
        conn.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
        } else {
          pending.resolve(msg.result);
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  }
}

function sendJsonRpc(conn: MCPConnection, method: string, params: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!conn.process?.stdin?.writable) {
      reject(new Error("stdio not writable"));
      return;
    }

    const id = conn.nextRequestId++;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    conn.pendingRequests.set(id, { resolve, reject });
    conn.process.stdin.write(msg + "\n");

    // Timeout after 30s
    setTimeout(() => {
      if (conn.pendingRequests.has(id)) {
        conn.pendingRequests.delete(id);
        reject(new Error(`JSON-RPC timeout for method "${method}"`));
      }
    }, 30_000);
  });
}

// ─── SSE Transport ──────────────────────────────────────────────────────────

async function connectSSE(conn: MCPConnection): Promise<void> {
  // MCP SSE transport: maintain persistent event stream for server notifications
  // and use HTTP POST for outbound requests (tool calls)
  const abort = new AbortController();
  conn.sseAbort = abort;

  const startStream = async (retryCount = 0): Promise<void> => {
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = Math.min(1000 * Math.pow(2, retryCount), 30_000) * (0.5 + Math.random() * 0.5); // v6.20: jitter prevents thundering herd

    try {
      const resp = await fetch(conn.config.url!, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        signal: abort.signal,
      });

      if (!resp.ok) {
        throw new Error(`SSE connection failed: ${resp.status} ${resp.statusText}`);
      }

      if (!resp.body) {
        throw new Error("SSE response has no body stream");
      }

      conn.status = "connected";
      console.log(`[MCP] SSE stream connected to ${conn.config.id}`);

      // Process the event stream
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        let eventType = "message";
        let eventData = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            eventData += (eventData ? "\n" : "") + line.slice(6);
          } else if (line === "" && eventData) {
            // End of event — dispatch
            handleSSEEvent(conn, eventType, eventData);
            eventType = "message";
            eventData = "";
          }
        }
      }

      // Stream ended normally — attempt reconnect unless aborted
      if (!abort.signal.aborted && retryCount < MAX_RETRIES) {
        console.log(`[MCP] SSE stream ended for ${conn.config.id}, reconnecting in ${RETRY_DELAY_MS}ms...`);
        conn.status = "disconnected";
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        return startStream(retryCount + 1);
      }
    } catch (err: any) {
      if (abort.signal.aborted) return; // Intentional disconnect

      console.warn(`[MCP] SSE error for ${conn.config.id}:`, err.message);
      conn.status = "error";
      conn.error = err.message;

      // Reconnect with backoff
      if (retryCount < MAX_RETRIES) {
        console.log(`[MCP] Reconnecting ${conn.config.id} in ${RETRY_DELAY_MS}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        return startStream(retryCount + 1);
      }
      throw new Error(`SSE connection failed after ${MAX_RETRIES} retries: ${err.message}`);
    }
  };

  // Start stream processing in background (don't await — it's long-lived)
  startStream().catch(err => {
    conn.status = "error";
    conn.error = err.message;
    console.error(`[MCP] SSE stream permanently failed for ${conn.config.id}:`, err.message);
  });

  // v6.12: Wait for actual connection state instead of hardcoded 500ms delay
  const CONNECTION_TIMEOUT_MS = 5000;
  const POLL_INTERVAL_MS = 50;
  const deadline = Date.now() + CONNECTION_TIMEOUT_MS;
  while (conn.status === "disconnected" && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  if (conn.status === "error") {
    throw new Error(conn.error || "SSE connection failed");
  }
}

/** Handle incoming SSE events from MCP server */
function handleSSEEvent(conn: MCPConnection, eventType: string, data: string): void {
  try {
    const parsed = JSON.parse(data);

    if (eventType === "message" || eventType === "notification") {
      // JSON-RPC notification from server
      if (parsed.method === "notifications/tools/list_changed") {
        // Server tools changed — re-discover
        console.log(`[MCP] Tools changed notification from ${conn.config.id}, re-discovering...`);
        discoverTools(conn).then(tools => { conn.tools = tools; }).catch(() => {});
      } else if (parsed.id && conn.pendingRequests.has(parsed.id)) {
        // Response to a pending request
        const pending = conn.pendingRequests.get(parsed.id)!;
        conn.pendingRequests.delete(parsed.id);
        if (parsed.error) {
          pending.reject(new Error(parsed.error.message || "MCP error"));
        } else {
          pending.resolve(parsed.result);
        }
      }
    }
  } catch {
    // Non-JSON event or parse error — ignore
  }
}

// ─── Tool Discovery ─────────────────────────────────────────────────────────

async function discoverTools(conn: MCPConnection): Promise<MCPToolSchema[]> {
  try {
    if (conn.config.transport === "stdio") {
      const result = await sendJsonRpc(conn, "tools/list", {});
      return result?.tools ?? [];
    } else if (conn.config.transport === "sse" && conn.config.url) {
      // SSE: POST to the server's tools/list endpoint
      const resp = await fetch(conn.config.url.replace(/\/$/, "") + "/tools/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      const json = (await resp.json()) as any;
      return json?.result?.tools ?? json?.tools ?? [];
    }
    return [];
  } catch (err) {
    console.error(`[MCP] Tool discovery failed for ${conn.config.id}:`, err);
    return [];
  }
}

// ─── Tool Execution ─────────────────────────────────────────────────────────

async function callMCPTool(conn: MCPConnection, toolName: string, args: Record<string, unknown>): Promise<string> {
  if (conn.config.transport === "stdio") {
    const result = await sendJsonRpc(conn, "tools/call", { name: toolName, arguments: args });
    // MCP tool results can be text or structured
    if (result?.content) {
      return result.content
        .map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)))
        .join("\n");
    }
    return JSON.stringify(result);
  } else if (conn.config.transport === "sse" && conn.config.url) {
    const resp = await fetch(conn.config.url.replace(/\/$/, "") + "/tools/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });
    const json = (await resp.json()) as any;
    const result = json?.result;
    if (result?.content) {
      return result.content
        .map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)))
        .join("\n");
    }
    return JSON.stringify(result);
  }
  throw new Error("No valid transport for tool call");
}

// ─── Register MCP Tool in Andromeda Registry ────────────────────────────────

function registerMCPTool(conn: MCPConnection, tool: MCPToolSchema): void {
  const prefixedName = `mcp_${conn.config.id}_${tool.name}`;

  registerTool({
    name: prefixedName,
    description: `[MCP:${conn.config.name}] ${tool.description}`,
    category: "mcp",
    safety: "moderate",
    definition: {
      type: "function",
      function: {
        name: prefixedName,
        description: `[MCP Server: ${conn.config.name}] ${tool.description}`,
        parameters: tool.inputSchema as Record<string, unknown>,
      },
    },
    execute: async (args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> => {
      try {
        const output = await callMCPTool(conn, tool.name, args);
        return { success: true, output };
      } catch (err) {
        return {
          success: false,
          output: "",
          error: `MCP tool "${tool.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });
}
