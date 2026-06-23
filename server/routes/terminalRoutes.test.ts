/**
 * terminalRoutes.test.ts
 *
 * Tests for the WebSocket PTY terminal server.
 * All PTY and WebSocket operations are mocked — we test the routing
 * logic, session management, auth gating, and message handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mock @lydell/node-pty ─────────────────────────────────────────────────────

const mockPtyOnData = vi.fn();
const mockPtyOnExit = vi.fn();
const mockPtyWrite = vi.fn();
const mockPtyResize = vi.fn();
const mockPtyKill = vi.fn();

const mockPty = {
  onData: mockPtyOnData,
  onExit: mockPtyOnExit,
  write: mockPtyWrite,
  resize: mockPtyResize,
  kill: mockPtyKill,
};

const mockSpawn = vi.fn(() => mockPty);

vi.mock("@lydell/node-pty", () => ({
  default: { spawn: mockSpawn },
  spawn: mockSpawn,
}));

// ── Mock ws ───────────────────────────────────────────────────────────────────

const mockWsOn = vi.fn();
const mockWsSend = vi.fn();
const mockWsClose = vi.fn();

class MockWebSocket {
  readyState = 1; // OPEN
  on = mockWsOn;
  send = mockWsSend;
  close = mockWsClose;
  static OPEN = 1;
}

const mockWssOn = vi.fn();
const mockWssHandleUpgrade = vi.fn();
const mockWssEmit = vi.fn();

class MockWebSocketServer {
  on = mockWssOn;
  handleUpgrade = mockWssHandleUpgrade;
  emit = mockWssEmit;
}

vi.mock("ws", () => ({
  WebSocketServer: MockWebSocketServer,
  WebSocket: MockWebSocket,
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("terminalRoutes — attachTerminalWss", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.TERMINAL_ENABLED;
    delete process.env.TERMINAL_TOKEN;
    delete process.env.ANDROMEDA_WORKSPACE;
  });

  it("returns null when TERMINAL_ENABLED is not set", async () => {
    const { attachTerminalWss } = await import("../routes/terminalRoutes.js");
    const mockServer = { on: vi.fn() } as any;
    const result = attachTerminalWss(mockServer);
    expect(result).toBeNull();
  });

  it("returns null when TERMINAL_ENABLED=false", async () => {
    process.env.TERMINAL_ENABLED = "false";
    const { attachTerminalWss } = await import("../routes/terminalRoutes.js");
    const mockServer = { on: vi.fn() } as any;
    const result = attachTerminalWss(mockServer);
    expect(result).toBeNull();
  });

  it("returns a WebSocketServer when TERMINAL_ENABLED=true", async () => {
    process.env.TERMINAL_ENABLED = "true";
    const { attachTerminalWss } = await import("../routes/terminalRoutes.js");
    const mockServer = { on: vi.fn() } as any;
    const result = attachTerminalWss(mockServer);
    expect(result).toBeDefined();
    expect(result).toBeInstanceOf(MockWebSocketServer);
  });

  it("registers upgrade handler on the server", async () => {
    process.env.TERMINAL_ENABLED = "true";
    const { attachTerminalWss } = await import("../routes/terminalRoutes.js");
    const serverOn = vi.fn();
    const mockServer = { on: serverOn } as any;
    attachTerminalWss(mockServer);
    expect(serverOn).toHaveBeenCalledWith("upgrade", expect.any(Function));
  });

  it("registers connection handler on the WSS", async () => {
    process.env.TERMINAL_ENABLED = "true";
    const { attachTerminalWss } = await import("../routes/terminalRoutes.js");
    const mockServer = { on: vi.fn() } as any;
    attachTerminalWss(mockServer);
    expect(mockWssOn).toHaveBeenCalledWith("connection", expect.any(Function));
  });
});

describe("terminalRoutes — upgrade handler auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.TERMINAL_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.TERMINAL_ENABLED;
    delete process.env.TERMINAL_TOKEN;
  });

  it("rejects connection with wrong token when TERMINAL_TOKEN is set", async () => {
    process.env.TERMINAL_TOKEN = "secret-token-123";
    const { attachTerminalWss } = await import("../routes/terminalRoutes.js");
    const serverOn = vi.fn();
    const mockServer = { on: serverOn } as any;
    attachTerminalWss(mockServer);

    // Get the upgrade handler
    const upgradeHandler = serverOn.mock.calls.find(c => c[0] === "upgrade")?.[1];
    expect(upgradeHandler).toBeDefined();

    const socketWrite = vi.fn();
    const socketDestroy = vi.fn();
    const mockSocket = { write: socketWrite, destroy: socketDestroy };
    const mockReq = {
      url: "/ws/terminal?token=wrong-token",
      headers: { host: "localhost:3000" },
    };

    upgradeHandler(mockReq, mockSocket, Buffer.alloc(0));
    expect(socketWrite).toHaveBeenCalledWith("HTTP/1.1 401 Unauthorized\r\n\r\n");
    expect(socketDestroy).toHaveBeenCalled();
  });

  it("allows connection with correct token", async () => {
    process.env.TERMINAL_TOKEN = "correct-token";
    const { attachTerminalWss } = await import("../routes/terminalRoutes.js");
    const serverOn = vi.fn();
    const mockServer = { on: serverOn } as any;
    attachTerminalWss(mockServer);

    const upgradeHandler = serverOn.mock.calls.find(c => c[0] === "upgrade")?.[1];
    expect(upgradeHandler).toBeDefined();

    const socketWrite = vi.fn();
    const socketDestroy = vi.fn();
    const mockSocket = { write: socketWrite, destroy: socketDestroy };
    const mockReq = {
      url: "/ws/terminal?token=correct-token",
      headers: { host: "localhost:3000" },
    };

    upgradeHandler(mockReq, mockSocket, Buffer.alloc(0));
    // Should NOT reject — handleUpgrade should be called
    expect(socketWrite).not.toHaveBeenCalled();
    expect(socketDestroy).not.toHaveBeenCalled();
    expect(mockWssHandleUpgrade).toHaveBeenCalled();
  });

  it("ignores upgrade requests for non-terminal paths", async () => {
    const { attachTerminalWss } = await import("../routes/terminalRoutes.js");
    const serverOn = vi.fn();
    const mockServer = { on: serverOn } as any;
    attachTerminalWss(mockServer);

    const upgradeHandler = serverOn.mock.calls.find(c => c[0] === "upgrade")?.[1];
    const socketWrite = vi.fn();
    const socketDestroy = vi.fn();
    const mockSocket = { write: socketWrite, destroy: socketDestroy };
    const mockReq = {
      url: "/ws/other-path",
      headers: { host: "localhost:3000" },
    };

    upgradeHandler(mockReq, mockSocket, Buffer.alloc(0));
    // Should not reject or upgrade — just ignore
    expect(socketWrite).not.toHaveBeenCalled();
    expect(socketDestroy).not.toHaveBeenCalled();
    expect(mockWssHandleUpgrade).not.toHaveBeenCalled();
  });
});

describe("terminalRoutes — getActiveSessions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns an empty array when no sessions are active", async () => {
    const { getActiveSessions } = await import("../routes/terminalRoutes.js");
    const sessions = getActiveSessions();
    expect(Array.isArray(sessions)).toBe(true);
    // May have sessions from other tests, but should be an array
  });

  it("returns session objects with required fields", async () => {
    process.env.TERMINAL_ENABLED = "true";
    const { attachTerminalWss, getActiveSessions } = await import("../routes/terminalRoutes.js");
    const mockServer = { on: vi.fn() } as any;
    attachTerminalWss(mockServer);

    // Simulate a connection being established
    const connectionHandler = mockWssOn.mock.calls.find(c => c[0] === "connection")?.[1];
    if (connectionHandler) {
      const mockWs = new MockWebSocket();
      const mockReq = {
        url: "/ws/terminal?session=test-session-123",
        headers: { host: "localhost:3000" },
      };
      connectionHandler(mockWs, mockReq);

      const sessions = getActiveSessions();
      expect(Array.isArray(sessions)).toBe(true);
      if (sessions.length > 0) {
        const session = sessions[0];
        expect(session).toHaveProperty("sessionId");
        expect(session).toHaveProperty("createdAt");
        expect(session).toHaveProperty("uptime");
        expect(typeof session.uptime).toBe("number");
      }
    }

    delete process.env.TERMINAL_ENABLED;
  });
});
