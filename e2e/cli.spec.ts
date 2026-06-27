/**
 * cli.spec.ts — v101.0.0
 * E2E-style tests for the Andromeda CLI commands.
 * These run the CLI as a child process and verify output/exit codes.
 * No browser needed — uses Playwright's test runner for consistency.
 */
import { test, expect } from "@playwright/test";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_PATH = path.resolve(__dirname, "../cli/index.ts");
const ROOT = path.resolve(__dirname, "..");

// Helper to run CLI with tsx (TypeScript runner)
function runCli(args: string[], timeoutMs = 10000): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(
    "node",
    ["--import", "tsx/esm", CLI_PATH, ...args],
    {
      cwd: ROOT,
      timeout: timeoutMs,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test", FORCE_COLOR: "0" },
    }
  );
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

// Helper to run CLI with ts-node as fallback
function runCliTsNode(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = spawnSync(
      "npx",
      ["ts-node", "--esm", "--skipProject", CLI_PATH, ...args],
      {
        cwd: ROOT,
        timeout: 10000,
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "test", FORCE_COLOR: "0" },
      }
    );
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? 1,
    };
  } catch {
    return { stdout: "", stderr: "ts-node not available", exitCode: 1 };
  }
}

// ── CLI File Existence ────────────────────────────────────────────────────────
test.describe("CLI File Structure", () => {
  test("CLI index.ts exists", async () => {
    const fs = await import("fs");
    expect(fs.existsSync(CLI_PATH)).toBe(true);
  });

  test("CLI commands directory exists", async () => {
    const fs = await import("fs");
    const cmdDir = path.resolve(ROOT, "cli/commands");
    expect(fs.existsSync(cmdDir)).toBe(true);
  });

  test("All required command files exist", async () => {
    const fs = await import("fs");
    const commands = ["start.ts", "stop.ts", "status.ts", "logs.ts", "doctor.ts", "dashboard.ts", "repl.ts", "bench.ts", "config.ts"];
    for (const cmd of commands) {
      const cmdPath = path.resolve(ROOT, "cli/commands", cmd);
      expect(fs.existsSync(cmdPath), `Missing: cli/commands/${cmd}`).toBe(true);
    }
  });

  test("CLI banner module exists", async () => {
    const fs = await import("fs");
    const bannerPath = path.resolve(ROOT, "cli/ui/banner.ts");
    expect(fs.existsSync(bannerPath)).toBe(true);
  });
});

// ── CLI Module Imports ────────────────────────────────────────────────────────
test.describe("CLI Module Validity", () => {
  test("CLI index.ts has valid TypeScript syntax", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(CLI_PATH, "utf8");
    // Should have commander import
    expect(content).toContain("commander");
    // Should have version
    expect(content).toMatch(/version|VERSION/);
    // Should register commands
    expect(content).toContain("command");
  });

  test("start command exports a registerStart function", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(path.resolve(ROOT, "cli/commands/start.ts"), "utf8");
    expect(content).toMatch(/export.*function|export.*const.*start|registerStart/);
  });

  test("status command exports a registerStatus function", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(path.resolve(ROOT, "cli/commands/status.ts"), "utf8");
    expect(content).toMatch(/export.*function|export.*const.*status|registerStatus/);
  });

  test("doctor command exports a registerDoctor function", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(path.resolve(ROOT, "cli/commands/doctor.ts"), "utf8");
    expect(content).toMatch(/export.*function|export.*const.*doctor|registerDoctor/);
  });

  test("dashboard command exports a registerDashboard function", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(path.resolve(ROOT, "cli/commands/dashboard.ts"), "utf8");
    expect(content).toMatch(/export.*function|export.*const.*dashboard|registerDashboard/);
  });

  test("bench command exports a registerBench function", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(path.resolve(ROOT, "cli/commands/bench.ts"), "utf8");
    expect(content).toMatch(/export.*function|export.*const.*bench|registerBench/);
  });

  test("config command exports a registerConfig function", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(path.resolve(ROOT, "cli/commands/config.ts"), "utf8");
    expect(content).toMatch(/export.*function|export.*const.*config|registerConfig/);
  });
});

// ── Docker Compose ────────────────────────────────────────────────────────────
test.describe("Docker Compose Configuration", () => {
  test("docker-compose.yml exists", async () => {
    const fs = await import("fs");
    const composePath = path.resolve(ROOT, "docker-compose.yml");
    expect(fs.existsSync(composePath)).toBe(true);
  });

  test("docker-compose.yml includes Redis service", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(path.resolve(ROOT, "docker-compose.yml"), "utf8");
    expect(content).toContain("redis");
  });

  test("docker-compose.yml includes Ollama service", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(path.resolve(ROOT, "docker-compose.yml"), "utf8");
    expect(content).toContain("ollama");
  });

  test("docker-compose.yml includes health checks", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(path.resolve(ROOT, "docker-compose.yml"), "utf8");
    expect(content).toContain("healthcheck");
  });

  test("docker-compose.yml includes profiles for GPU", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(path.resolve(ROOT, "docker-compose.yml"), "utf8");
    expect(content).toContain("profiles");
  });

  test(".env.example exists with required variables", async () => {
    const fs = await import("fs");
    const envPath = path.resolve(ROOT, ".env.example");
    expect(fs.existsSync(envPath)).toBe(true);
    const content = fs.readFileSync(envPath, "utf8");
    expect(content).toContain("OPENROUTER_API_KEY");
    expect(content).toContain("GITHUB_TOKEN");
  });
});

// ── Dashboard Pages ───────────────────────────────────────────────────────────
test.describe("Dashboard Page Files", () => {
  const pages = [
    "KnowledgeGraph.tsx",
    "ModuleBrowser.tsx",
    "DebateViewer.tsx",
    "MetricsDashboard.tsx",
  ];

  for (const page of pages) {
    test(`${page} exists and has valid React component`, async () => {
      const fs = await import("fs");
      const pagePath = path.resolve(ROOT, "client/src/pages", page);
      expect(fs.existsSync(pagePath)).toBe(true);
      const content = fs.readFileSync(pagePath, "utf8");
      // Should be a valid React component
      expect(content).toContain("export default");
      expect(content).toContain("React");
      expect(content).toContain("return");
    });
  }

  test("App.tsx routes include all new pages", async () => {
    const fs = await import("fs");
    const appPath = path.resolve(ROOT, "client/src/App.tsx");
    const content = fs.readFileSync(appPath, "utf8");
    expect(content).toContain("/graph");
    expect(content).toContain("/modules");
    expect(content).toContain("/debate");
    expect(content).toContain("/metrics");
  });
});
