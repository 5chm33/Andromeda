import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { 
  emitRsiEvent, 
  registerSseClient, 
  getSseClientCount, 
  getEventHistory 
} from "./rsiEventBus";
import type { Response } from "express";

describe("rsiEventBus", () => {
  beforeEach(() => {
    // We can't easily clear the module-level clients map directly without resetModules,
    // but we can mock the Response object to test behavior.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should register a client and send connection event", () => {
    const mockRes = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
      on: vi.fn(),
    } as unknown as Response;

    const cleanup = registerSseClient(mockRes);

    expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
    expect(mockRes.flushHeaders).toHaveBeenCalled();
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining("event: connected"));
    expect(mockRes.on).toHaveBeenCalledWith("close", expect.any(Function));

    // Client count should be at least 1
    expect(getSseClientCount()).toBeGreaterThan(0);
    
    // Cleanup should work
    cleanup();
  });

  it("should emit events to connected clients and add to history", () => {
    const mockRes = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
      on: vi.fn(),
    } as unknown as Response;

    const cleanup = registerSseClient(mockRes);
    mockRes.write = vi.fn(); // Reset after connection event

    emitRsiEvent("proposal:new", { proposalId: "123" });

    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining("event: proposal:new"));
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('"proposalId":"123"'));

    const history = getEventHistory(1);
    expect(history[0].type).toBe("proposal:new");
    expect(history[0].data).toEqual({ proposalId: "123" });

    cleanup();
  });

  it("should send missed events to new clients if 'since' is provided", () => {
    // Emit an event
    emitRsiEvent("cycle:start", { cycle: 1 });
    const history = getEventHistory(1);
    const eventTime = history[0].timestamp;

    const mockRes = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
      on: vi.fn(),
    } as unknown as Response;

    // Register a client with a 'since' time just before the event
    const cleanup = registerSseClient(mockRes, eventTime - 1000);

    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining("event: cycle:start"));
    cleanup();
  });
});
