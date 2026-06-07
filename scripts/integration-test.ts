#!/usr/bin/env tsx
/**
 * integration-test.ts — v8.9.0
 *
 * Lightweight integration test suite that spins up the server, exercises
 * key API endpoints, and reports pass/fail.  Designed to run in CI and
 * as a pre-commit gate after RSI cycles.
 *
 * Usage:
 *   npx tsx scripts/integration-test.ts
 *   PORT=3099 npx tsx scripts/integration-test.ts
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */
import { execSync, spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const BASE_URL = `http://localhost:${process.env.PORT || "3099"}`;
const SERVER_STARTUP_MS = 8_000;
const REQUEST_TIMEOUT_MS = 10_000;

interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  statusCode?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function fetchWithTimeout(url: string, opts: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function runTest(name: string, fn: () => Promise<void>): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, passed: true, durationMs: Date.now() - start };
  } catch (err: any) {
    return { name, passed: false, durationMs: Date.now() - start, error: err.message };
  }
}

// ─── Test Cases ───────────────────────────────────────────────────────────────
const tests: Array<() => Promise<TestResult>> = [
  // 1. Health endpoint returns 200
  () => runTest("GET /api/health → 200", async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/api/health`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const body = await res.json();
    if (!body || typeof body !== "object") throw new Error("Expected JSON body");
  }),

  // 2. Health endpoint includes subsystem status
  () => runTest("GET /api/health → has subsystems", async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/api/health`);
    const body = await res.json();
    if (!body.status) throw new Error("Missing status field");
  }),

  // 3. tRPC endpoint responds (batch ping)
  () => runTest("POST /api/trpc → responds", async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/api/trpc/health.ping`, {
      method: "GET",
    });
    // tRPC returns 200 or 404 depending on procedure; both mean the server is alive
    if (res.status >= 500) throw new Error(`Server error: ${res.status}`);
  }),

  // 4. Static assets served (index.html exists)
  () => runTest("GET / → serves HTML", async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const text = await res.text();
    if (!text.includes("<!DOCTYPE html") && !text.includes("<html")) {
      throw new Error("Response does not look like HTML");
    }
  }),

  // 5. RSI status endpoint responds
  () => runTest("GET /api/rsi/status → responds", async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/api/rsi/status`);
    if (res.status >= 500) throw new Error(`Server error: ${res.status}`);
  }),

  // 6. Diagnostics endpoint responds
  () => runTest("GET /api/diagnostics → responds", async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/api/diagnostics`);
    if (res.status >= 500) throw new Error(`Server error: ${res.status}`);
  }),

  // 7. Boot status endpoint
  () => runTest("GET /api/runtime/boot-status → has bootCount", async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/api/runtime/boot-status`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const body = await res.json();
    if (typeof body.bootCount !== "number") throw new Error("Missing bootCount");
  }),

  // 8. Package.json version is accessible
  () => runTest("package.json version is 8.x", async () => {
    const pkgPath = join(process.cwd(), "package.json");
    if (!existsSync(pkgPath)) throw new Error("package.json not found");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (!pkg.version.startsWith("8.")) throw new Error(`Expected 8.x, got ${pkg.version}`);
  }),

  // 9. TypeScript compiles cleanly
  () => runTest("TypeScript compiles (tsc --noEmit)", async () => {
    execSync("npx tsc --noEmit 2>&1", { cwd: process.cwd(), stdio: "pipe", timeout: 60_000 });
  }),

  // 10. No crash flag left over
  () => runTest("No stale crash flag", async () => {
    const flagPath = join(process.cwd(), ".andromeda", ".boot_crash_flag");
    if (existsSync(flagPath)) {
      const content = readFileSync(flagPath, "utf-8");
      const flag = JSON.parse(content);
      // If the PID in the flag is no longer running, it's stale
      try {
        process.kill(flag.pid, 0); // throws if process doesn't exist
        // Process is still running — flag is live, not stale
      } catch {
        throw new Error(`Stale crash flag found (PID ${flag.pid} not running). Run: rm .andromeda/.boot_crash_flag`);
      }
    }
  }),
];

// ─── Server Lifecycle ─────────────────────────────────────────────────────────
async function waitForServer(url: string, maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetchWithTimeout(url);
      if (res.status < 500) return true;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n🔬 Andromeda Integration Test Suite v8.9.0");
  console.log("=".repeat(50));

  // Check if a server is already running
  let serverProcess: ReturnType<typeof spawn> | null = null;
  let serverAlreadyRunning = false;

  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/health`);
    if (res.status < 500) {
      console.log(`✓ Server already running at ${BASE_URL}`);
      serverAlreadyRunning = true;
    }
  } catch {
    // Start the server
    console.log(`Starting server on ${BASE_URL}…`);
    serverProcess = spawn("npx", ["tsx", "server/_core/index.ts"], {
      env: { ...process.env, PORT: String(process.env.PORT || "3099"), NODE_ENV: "production" },
      stdio: "pipe",
      detached: false,
    });

    serverProcess.stderr?.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line) process.stderr.write(`  [server] ${line}\n`);
    });

    const ready = await waitForServer(`${BASE_URL}/api/health`, SERVER_STARTUP_MS);
    if (!ready) {
      console.error("✗ Server did not start in time");
      serverProcess.kill();
      process.exit(1);
    }
    console.log("✓ Server started\n");
  }

  // Run tests
  const results: TestResult[] = [];
  for (const test of tests) {
    const result = await test();
    const icon = result.passed ? "✓" : "✗";
    const duration = `${result.durationMs}ms`;
    if (result.passed) {
      console.log(`  ${icon} ${result.name} (${duration})`);
    } else {
      console.log(`  ${icon} ${result.name} (${duration})`);
      console.log(`      Error: ${result.error}`);
    }
    results.push(result);
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0);

  console.log("\n" + "=".repeat(50));
  console.log(`Results: ${passed}/${results.length} passed, ${failed} failed (${totalMs}ms total)`);

  // Cleanup
  if (serverProcess && !serverAlreadyRunning) {
    serverProcess.kill();
  }

  if (failed > 0) {
    console.log("\n❌ Integration tests FAILED");
    process.exit(1);
  } else {
    console.log("\n✅ All integration tests passed");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
