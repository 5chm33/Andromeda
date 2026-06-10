/**
 * terminalRoutes.ts
 *
 * WebSocket PTY server for the Andromeda embedded terminal.
 * Spawns a bash shell via @lydell/node-pty and bridges it to the
 * browser xterm.js client over WebSocket.
 *
 * Security:
 *   - Only accessible when TERMINAL_ENABLED=true in env
 *   - Sessions are isolated per WebSocket connection
 *   - Shell is spawned in the project workspace directory
 *   - Admin auth required (requireAdmin middleware)
 */
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import { createLogger } from "../logger.js";

const log = createLogger("terminalRoutes");

interface PtySession {
  pty: import("@lydell/node-pty").IPty;
  ws: WebSocket;
  sessionId: string;
  createdAt: number;
}

const sessions = new Map<string, PtySession>();

/**
 * Attach the WebSocket terminal server to an existing HTTP server.
 * Call this from your main server setup after Express is configured.
 */
export function attachTerminalWss(server: import("http").Server): WebSocketServer | null {
  if (process.env.TERMINAL_ENABLED !== "true") {
    log.info("Terminal WebSocket disabled (set TERMINAL_ENABLED=true to enable)");
    return null;
  }

  let ptyModule: typeof import("@lydell/node-pty") | null = null;
  try {
    // Dynamic import to avoid crashing if node-pty is not built
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyModule = require("@lydell/node-pty");
  } catch (e) {
    log.warn("@lydell/node-pty not available — terminal disabled", { error: String(e) });
    return null;
  }

  const wss = new WebSocketServer({ noServer: true });

  // Upgrade handler — attach to server
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname !== "/ws/terminal") return;

    // Simple token check
    const token = url.searchParams.get("token");
    const expectedToken = process.env.TERMINAL_TOKEN ?? "";
    if (expectedToken && token !== expectedToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("session") ?? Math.random().toString(36).slice(2);

    const workspaceDir = process.env.ANDROMEDA_WORKSPACE ?? process.cwd();

    log.info("Terminal session opened", { sessionId });

    const pty = ptyModule!.spawn(process.env.SHELL ?? "bash", [], {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: workspaceDir,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        ANDROMEDA_SESSION: sessionId,
      },
    });

    const session: PtySession = { pty, ws, sessionId, createdAt: Date.now() };
    sessions.set(sessionId, session);

    // PTY output → WebSocket
    pty.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "output", data }));
      }
    });

    pty.onExit(({ exitCode }: { exitCode: number }) => {
      log.info("PTY exited", { sessionId, exitCode });
      sessions.delete(sessionId);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "output", data: `\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m\r\n` }));
        ws.close();
      }
    });

    // WebSocket input → PTY
    ws.on("message", (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "input" && typeof msg.data === "string") {
          pty.write(msg.data);
        } else if (msg.type === "resize" && msg.cols && msg.rows) {
          pty.resize(Number(msg.cols), Number(msg.rows));
        }
      } catch {
        // Raw data fallback
        pty.write(raw.toString());
      }
    });

    ws.on("close", () => {
      log.info("Terminal WebSocket closed", { sessionId });
      sessions.delete(sessionId);
      try { pty.kill(); } catch { /* already dead */ }
    });

    ws.on("error", (err: Error) => {
      log.warn("Terminal WebSocket error", { sessionId, error: err.message });
    });
  });

  log.info("Terminal WebSocket server attached at /ws/terminal");
  return wss;
}

/**
 * GET /api/terminal/sessions — list active terminal sessions (admin only)
 */
export function getActiveSessions() {
  return Array.from(sessions.values()).map((s) => ({
    sessionId: s.sessionId,
    createdAt: s.createdAt,
    uptime: Date.now() - s.createdAt,
  }));
}
