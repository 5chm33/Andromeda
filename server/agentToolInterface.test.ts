/**
 * agentToolInterface.test.ts — Tests for the typed tool interface layer
 * Andromeda v5.0
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Mock child_process to avoid real exec in tests
vi.mock("child_process", () => ({
  spawnSync: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

import {
  readSymbol,
  searchSymbols,
  listTests,
  runBounded,
  runProbe,
  validateTypes,
  recordHypothesis,
  formatHypothesisForPrompt,
  type ToolMode,
} from "./agentToolInterface";
import { spawnSync } from "child_process";

const mockSpawnSync = vi.mocked(spawnSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

describe("agentToolInterface — mode capability gates", () => {
  it("explore mode blocks command execution", () => {
    const result = runBounded("echo", ["hello"], "/tmp", "explore");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not permit command execution/);
  });

  it("explore mode blocks writes in runBounded", () => {
    // explore mode should not even reach spawnSync for execution
    const result = runBounded("touch", ["file.txt"], "/tmp", "explore");
    expect(result.success).toBe(false);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("candidate mode permits execution but not writes", () => {
    mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: "ok", stderr: "", signal: null, pid: 1, output: [], error: undefined } as any);
    const result = runBounded("echo", ["hello"], "/tmp", "candidate");
    expect(result.success).toBe(true);
  });

  it("promote mode permits execution and writes", () => {
    mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: "ok", stderr: "", signal: null, pid: 1, output: [], error: undefined } as any);
    const result = runBounded("echo", ["hello"], "/tmp", "promote");
    expect(result.success).toBe(true);
  });
});

describe("agentToolInterface — timeout fail-closed", () => {
  it("returns failure when command times out (SIGTERM)", () => {
    mockSpawnSync.mockReturnValueOnce({
      status: null,
      stdout: "partial",
      stderr: "",
      signal: "SIGTERM",
      pid: 1,
      output: [],
      error: undefined,
    } as any);
    const result = runBounded("sleep", ["999"], "/tmp", "candidate");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/);
  });

  it("runProbe uses explore mode limits (5s, no network)", () => {
    mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: "result", stderr: "", signal: null, pid: 1, output: [], error: undefined } as any);
    runProbe("grep", ["-rn", "pattern", "."], "/tmp");
    const call = mockSpawnSync.mock.calls[0];
    const opts = call[2] as any;
    expect(opts.timeout).toBe(5_000);
    // API keys should be stripped in non-network mode
    expect(opts.env?.ANTHROPIC_API_KEY).toBe("");
    expect(opts.env?.OPENROUTER_API_KEY).toBe("");
  });
});

describe("agentToolInterface — readSymbol", () => {
  it("returns the symbol definition from a TypeScript file", () => {
    const mockContent = `
export function myFunction(x: number): string {
  return String(x);
}

export function otherFunction(): void {}
`.trim();
    mockReadFileSync.mockReturnValueOnce(mockContent as any);
    const result = readSymbol("/fake/path.ts", "myFunction", "explore");
    expect(result.success).toBe(true);
    expect(result.output).toContain("myFunction");
    expect(result.output).not.toContain("otherFunction");
  });

  it("returns error when symbol not found", () => {
    mockReadFileSync.mockReturnValueOnce("export function other(): void {}" as any);
    const result = readSymbol("/fake/path.ts", "nonExistent", "explore");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/);
  });
});

describe("agentToolInterface — hypothesis protocol", () => {
  beforeEach(() => {
    vi.mocked(fs.appendFileSync).mockImplementation(() => {});
  });

  it("recordHypothesis returns a well-formed record", () => {
    const h = recordHypothesis(
      "selfImprove.ts",
      "The retry loop has no backoff",
      "grep shows no exponential backoff pattern",
      "grep shows Math.pow or 2 ** attempt",
      "grep -n 'backoff\\|Math.pow' server/selfImprove.ts"
    );
    expect(h.claim).toContain("retry loop");
    expect(h.confirmingObservation).toBeTruthy();
    expect(h.refutingObservation).toBeTruthy();
    expect(h.probe).toBeTruthy();
    expect(h.formedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("formatHypothesisForPrompt produces the expected section markers", () => {
    const h = recordHypothesis("file.ts", "claim", "confirm", "refute", "probe");
    const formatted = formatHypothesisForPrompt(h);
    expect(formatted).toContain("--- INVESTIGATION HYPOTHESIS ---");
    expect(formatted).toContain("--- END HYPOTHESIS ---");
    expect(formatted).toContain("Claim: claim");
    expect(formatted).toContain("Confirming observation: confirm");
    expect(formatted).toContain("Refuting observation: refute");
  });
});
