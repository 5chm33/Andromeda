/**
 * v66.test.ts — Real-World Integration
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getBrowsingHistory, clearBrowsingHistory } from "./webBrowsingEngine";
import { readFile, writeFile, listDirectory, getFileAuditLog, _resetFileIOManagerForTest } from "./fileIOManager";
import { executeCode, getExecutionHistory, _resetCodeExecutionSandboxForTest } from "./codeExecutionSandbox";
import { registerTool, listTools, callTool, getToolCallLog, _resetToolUseOrchestratorForTest } from "./toolUseOrchestrator";
import { registerPlugin, loadPlugin, activatePlugin, disablePlugin, getActiveCapabilities, _resetPluginManagerForTest } from "./pluginManager";
import { getRequestLog, _resetHttpClientManagerForTest } from "./httpClientManager";

beforeEach(() => {
  clearBrowsingHistory();
  _resetFileIOManagerForTest();
  _resetCodeExecutionSandboxForTest();
  _resetToolUseOrchestratorForTest();
  _resetPluginManagerForTest();
  _resetHttpClientManagerForTest();
});

describe("fileIOManager", () => {
  it("writes and reads a file correctly", () => {
    const tmpPath = path.join(os.tmpdir(), `andromeda_test_${Date.now()}.txt`);
    const content = "Hello Andromeda v66";
    const writeResult = writeFile(tmpPath, content);
    expect(writeResult.sizeBytes).toBeGreaterThan(0);
    const readResult = readFile(tmpPath);
    expect(readResult.content).toBe(content);
    expect(readResult.mimeType).toBe("text/plain");
    fs.unlinkSync(tmpPath);
  });

  it("lists directory entries", () => {
    const result = listDirectory(os.tmpdir());
    expect(result.entries).toBeInstanceOf(Array);
    expect(result.directory).toBe(path.resolve(os.tmpdir()));
  });

  it("records audit log for file operations", () => {
    const tmpPath = path.join(os.tmpdir(), `andromeda_audit_${Date.now()}.txt`);
    writeFile(tmpPath, "audit test");
    readFile(tmpPath);
    const log = getFileAuditLog();
    expect(log.length).toBe(2);
    expect(log[0].op).toBe("write");
    expect(log[1].op).toBe("read");
    fs.unlinkSync(tmpPath);
  });

  it("detects MIME type from extension", () => {
    const tmpPath = path.join(os.tmpdir(), `andromeda_mime_${Date.now()}.json`);
    writeFile(tmpPath, '{"test": true}');
    const result = readFile(tmpPath);
    expect(result.mimeType).toBe("application/json");
    fs.unlinkSync(tmpPath);
  });
});

describe("codeExecutionSandbox", () => {
  it("executes JavaScript code successfully", () => {
    const result = executeCode({ code: 'console.log("hello world")', language: "javascript" });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("hello world");
    expect(result.exitCode).toBe(0);
  });

  it("executes Python code successfully", () => {
    const result = executeCode({ code: 'print("python works")', language: "python" });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("python works");
  });

  it("captures execution errors", () => {
    const result = executeCode({ code: "throw new Error('intentional')", language: "javascript" });
    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it("records execution history", () => {
    executeCode({ code: "console.log(1+1)", language: "javascript" });
    executeCode({ code: "console.log(2+2)", language: "javascript" });
    expect(getExecutionHistory()).toHaveLength(2);
  });

  it("executes bash code", () => {
    const result = executeCode({ code: 'echo "bash works"', language: "bash" });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("bash works");
  });
});

describe("toolUseOrchestrator", () => {
  it("registers and lists tools", () => {
    registerTool({ name: "calculator", description: "Adds numbers", parameters: { a: "number", b: "number" }, handler: async (p) => (p.a as number) + (p.b as number) });
    const tools = listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("calculator");
  });

  it("calls a tool and returns result", async () => {
    registerTool({ name: "echo", description: "Echoes input", parameters: { msg: "string" }, handler: async (p) => p.msg });
    const call = await callTool("echo", { msg: "hello" });
    expect(call.status).toBe("success");
    expect(call.result).toBe("hello");
  });

  it("handles tool errors gracefully", async () => {
    registerTool({ name: "failer", description: "Always fails", parameters: {}, handler: async () => { throw new Error("tool error"); } });
    const call = await callTool("failer", {}, 0);
    expect(call.status).toBe("error");
    expect(call.error).toContain("tool error");
  });

  it("logs all tool calls", async () => {
    registerTool({ name: "noop", description: "No-op", parameters: {}, handler: async () => null });
    await callTool("noop", {});
    await callTool("noop", {});
    expect(getToolCallLog()).toHaveLength(2);
  });
});

describe("pluginManager", () => {
  it("registers and activates a plugin", () => {
    registerPlugin({ name: "search", version: "1.0.0", description: "Web search", dependencies: [], capabilities: ["web_search"] });
    loadPlugin("search");
    const plugin = activatePlugin("search");
    expect(plugin.status).toBe("active");
  });

  it("fails to load plugin with missing dependency", () => {
    registerPlugin({ name: "advanced", version: "1.0.0", description: "Advanced", dependencies: ["base"], capabilities: ["advanced_ops"] });
    const plugin = loadPlugin("advanced");
    expect(plugin.status).toBe("error");
    expect(plugin.errorMessage).toContain("base");
  });

  it("resolves dependency chain correctly", () => {
    registerPlugin({ name: "base", version: "1.0.0", description: "Base", dependencies: [], capabilities: ["base_ops"] });
    registerPlugin({ name: "advanced", version: "1.0.0", description: "Advanced", dependencies: ["base"], capabilities: ["advanced_ops"] });
    loadPlugin("base");
    activatePlugin("base");
    loadPlugin("advanced");
    activatePlugin("advanced");
    const caps = getActiveCapabilities();
    expect(caps).toContain("base_ops");
    expect(caps).toContain("advanced_ops");
  });

  it("disables a plugin", () => {
    registerPlugin({ name: "temp", version: "1.0.0", description: "Temp", dependencies: [], capabilities: ["temp_ops"] });
    loadPlugin("temp");
    activatePlugin("temp");
    disablePlugin("temp");
    expect(getActiveCapabilities()).not.toContain("temp_ops");
  });
});

describe("webBrowsingEngine + httpClientManager", () => {
  it("browsing history starts empty", () => {
    expect(getBrowsingHistory()).toHaveLength(0);
  });

  it("request log starts empty", () => {
    expect(getRequestLog()).toHaveLength(0);
  });
});
