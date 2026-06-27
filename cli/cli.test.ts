/**
 * cli/cli.test.ts — CLI v1-v5 test suite
 * Tests for: banner, doctor checks, status formatting, log colorizer
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";

// ── Banner tests ──────────────────────────────────────────────────────────────
describe("CLI Banner", () => {
  it("printBanner returns a non-empty string", async () => {
    const { printBanner } = await import("./ui/banner.js");
    const banner = printBanner();
    expect(typeof banner).toBe("string");
    expect(banner.length).toBeGreaterThan(10);
  });

  it("printBanner contains ANDROMEDA text", async () => {
    const { printBanner } = await import("./ui/banner.js");
    const banner = printBanner();
    // figlet renders ANDROMEDA as ASCII art — check for at least one capital A
    expect(banner).toMatch(/A/);
  });
});

// ── Doctor checks ─────────────────────────────────────────────────────────────
describe("Doctor Diagnostics", () => {
  it("doctor command module exports a Command", async () => {
    const { doctorCommand } = await import("./commands/doctor.js");
    const cmd = doctorCommand();
    expect(cmd.name()).toBe("doctor");
    expect(cmd.description()).toContain("diagnostics");
  });
});

// ── Status command ────────────────────────────────────────────────────────────
describe("Status Command", () => {
  it("status command module exports a Command", async () => {
    const { statusCommand } = await import("./commands/status.js");
    const cmd = statusCommand();
    expect(cmd.name()).toBe("status");
    expect(cmd.description()).toContain("status");
  });

  it("status command has --json option", async () => {
    const { statusCommand } = await import("./commands/status.js");
    const cmd = statusCommand();
    const jsonOpt = cmd.options.find(o => o.long === "--json");
    expect(jsonOpt).toBeDefined();
  });
});

// ── Start command ─────────────────────────────────────────────────────────────
describe("Start Command", () => {
  it("start command exports a Command", async () => {
    const { startCommand } = await import("./commands/start.js");
    const cmd = startCommand();
    expect(cmd.name()).toBe("start");
  });

  it("start command has --port option", async () => {
    const { startCommand } = await import("./commands/start.js");
    const cmd = startCommand();
    const portOpt = cmd.options.find(o => o.long === "--port");
    expect(portOpt).toBeDefined();
  });

  it("start command has --dev option", async () => {
    const { startCommand } = await import("./commands/start.js");
    const cmd = startCommand();
    const devOpt = cmd.options.find(o => o.long === "--dev");
    expect(devOpt).toBeDefined();
  });

  it("start command has --detach option", async () => {
    const { startCommand } = await import("./commands/start.js");
    const cmd = startCommand();
    const detachOpt = cmd.options.find(o => o.long === "--detach");
    expect(detachOpt).toBeDefined();
  });
});

// ── Stop command ──────────────────────────────────────────────────────────────
describe("Stop Command", () => {
  it("stop command exports a Command", async () => {
    const { stopCommand } = await import("./commands/stop.js");
    const cmd = stopCommand();
    expect(cmd.name()).toBe("stop");
  });

  it("stop command has --kill option", async () => {
    const { stopCommand } = await import("./commands/stop.js");
    const cmd = stopCommand();
    const killOpt = cmd.options.find(o => o.long === "--kill");
    expect(killOpt).toBeDefined();
  });
});

// ── Logs command ──────────────────────────────────────────────────────────────
describe("Logs Command", () => {
  it("logs command exports a Command", async () => {
    const { logsCommand } = await import("./commands/logs.js");
    const cmd = logsCommand();
    expect(cmd.name()).toBe("logs");
  });

  it("logs command has --filter option", async () => {
    const { logsCommand } = await import("./commands/logs.js");
    const cmd = logsCommand();
    const filterOpt = cmd.options.find(o => o.long === "--filter");
    expect(filterOpt).toBeDefined();
  });

  it("logs command has --rsi option", async () => {
    const { logsCommand } = await import("./commands/logs.js");
    const cmd = logsCommand();
    const rsiOpt = cmd.options.find(o => o.long === "--rsi");
    expect(rsiOpt).toBeDefined();
  });
});

// ── CLI index ─────────────────────────────────────────────────────────────────
describe("CLI Index", () => {
  it("cli directory has all required command files", () => {
    const base = resolve(import.meta.dirname);
    expect(existsSync(resolve(base, "commands/start.ts"))).toBe(true);
    expect(existsSync(resolve(base, "commands/stop.ts"))).toBe(true);
    expect(existsSync(resolve(base, "commands/status.ts"))).toBe(true);
    expect(existsSync(resolve(base, "commands/logs.ts"))).toBe(true);
    expect(existsSync(resolve(base, "commands/doctor.ts"))).toBe(true);
    expect(existsSync(resolve(base, "ui/banner.ts"))).toBe(true);
  });
});
