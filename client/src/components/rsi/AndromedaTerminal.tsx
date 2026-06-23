/**
 * AndromedaTerminal.tsx
 *
 * Embedded xterm.js terminal panel connected to a WebSocket PTY backend.
 * Used for watching Andromeda execute shell commands, run tests, and
 * apply RSI patches in real-time.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface AndromedaTerminalProps {
  /** WebSocket endpoint path, defaults to /ws/terminal */
  wsPath?: string;
  /** Initial command to run when connected */
  initCommand?: string;
  /** Height in pixels */
  height?: number;
  className?: string;
}

const CYBERPUNK_THEME = {
  background: "#020617",       // slate-950
  foreground: "#e2e8f0",       // slate-200
  cursor: "#a78bfa",           // violet-400
  cursorAccent: "#020617",
  black: "#0f172a",
  red: "#f87171",              // red-400
  green: "#34d399",            // emerald-400
  yellow: "#fbbf24",           // amber-400
  blue: "#60a5fa",             // blue-400
  magenta: "#a78bfa",          // violet-400
  cyan: "#22d3ee",             // cyan-400
  white: "#e2e8f0",
  brightBlack: "#475569",
  brightRed: "#fca5a5",
  brightGreen: "#6ee7b7",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#c4b5fd",
  brightCyan: "#67e8f9",
  brightWhite: "#f8fafc",
  selectionBackground: "#312e81",
  selectionForeground: "#e2e8f0",
};

export function AndromedaTerminal({
  wsPath = "/ws/terminal",
  initCommand,
  height = 320,
  className = "",
}: AndromedaTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [sessionId] = useState(() => Math.random().toString(36).slice(2, 10));

  const connect = useCallback(() => {
    if (!containerRef.current) return;

    // Create terminal
    const term = new Terminal({
      theme: CYBERPUNK_THEME,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 12,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const linksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(linksAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;
    fitRef.current = fitAddon;

    // Welcome banner
    term.writeln("\x1b[35m╔══════════════════════════════════════════════╗\x1b[0m");
    term.writeln("\x1b[35m║  \x1b[36mAndromeda RSI Terminal\x1b[35m  ·  \x1b[33mSession: " + sessionId + "\x1b[35m  ║\x1b[0m");
    term.writeln("\x1b[35m╚══════════════════════════════════════════════╝\x1b[0m");
    term.writeln("");

    // Connect WebSocket
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}${wsPath}?session=${sessionId}`;
    setStatus("connecting");
    term.writeln(`\x1b[33m⟳ Connecting to ${wsUrl}...\x1b[0m`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      term.writeln("\x1b[32m✓ Connected\x1b[0m\r\n");
      if (initCommand) {
        ws.send(JSON.stringify({ type: "input", data: initCommand + "\n" }));
      }
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "output") {
          term.write(msg.data);
        } else if (msg.type === "resize") {
          // server-side resize ack
        }
      } catch {
        term.write(e.data);
      }
    };

    ws.onerror = () => {
      setStatus("disconnected");
      term.writeln("\r\n\x1b[31m✗ WebSocket error — terminal offline\x1b[0m");
      term.writeln("\x1b[33m  (Start the server to enable live terminal)\x1b[0m");
    };

    ws.onclose = () => {
      setStatus("disconnected");
      term.writeln("\r\n\x1b[31m● Connection closed\x1b[0m");
    };

    // Forward keyboard input to server
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }));
      }
    });
    if (containerRef.current.parentElement) {
      resizeObserver.observe(containerRef.current.parentElement);
    }

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
  }, [wsPath, initCommand, sessionId]);

  useEffect(() => {
    const cleanup = connect();
    return () => {
      cleanup?.();
      wsRef.current?.close();
      termRef.current?.dispose();
    };
  }, [connect]);

  const handleReconnect = () => {
    wsRef.current?.close();
    termRef.current?.dispose();
    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }
    connect();
  };

  const statusColors = {
    connecting: "text-yellow-400",
    connected: "text-emerald-400",
    disconnected: "text-red-400",
  };
  const statusDots = {
    connecting: "bg-yellow-400 animate-pulse",
    connected: "bg-emerald-400",
    disconnected: "bg-red-400",
  };

  return (
    <div className={`flex flex-col rounded-lg overflow-hidden border border-slate-700/60 ${className}`}>
      {/* Terminal toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border-b border-slate-700/50">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/70" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
          <div className="w-3 h-3 rounded-full bg-emerald-500/70" />
        </div>
        <span className="text-[10px] font-mono text-slate-400 ml-1">andromeda@rsi</span>
        <div className="ml-auto flex items-center gap-2">
          <span className={`flex items-center gap-1 text-[10px] font-mono ${statusColors[status]}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusDots[status]}`} />
            {status}
          </span>
          {status === "disconnected" && (
            <button
              onClick={handleReconnect}
              className="text-[10px] px-2 py-0.5 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 transition-colors font-mono"
            >
              reconnect
            </button>
          )}
        </div>
      </div>

      {/* xterm container */}
      <div
        ref={containerRef}
        style={{ height, background: CYBERPUNK_THEME.background }}
        className="flex-1 overflow-hidden p-1"
      />
    </div>
  );
}
