#!/usr/bin/env node
/**
 * start.js — Andromeda Node.js Launcher
 *
 * Run with:  node start.js
 *
 * This launcher bypasses cmd.exe entirely, so it works regardless of
 * Windows batch file parsing issues. It handles:
 *   - .env.local setup
 *   - pnpm install (first run)
 *   - pnpm run build (if dist is missing)
 *   - Server startup with auto-restart on crash
 */

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Helpers ───────────────────────────────────────────────────────────────────
const ROOT = __dirname;
const log = (msg) => console.log(msg);
const err = (msg) => console.error(msg);

function run(cmd, opts = {}) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: "inherit", ...opts });
    return true;
  } catch (e) {
    return false;
  }
}

function runCapture(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

// ── Banner ────────────────────────────────────────────────────────────────────
log("");
log("  ============================================================");
log("   Andromeda AI  v10.0.0  |  Godel Machine Edition");
log("  ============================================================");
log("");

// ── Step 1: Node.js version check ────────────────────────────────────────────
const nodeVer = runCapture("node --version");
if (!nodeVer) {
  err("  [ERROR] Cannot detect Node.js version. Something is very wrong.");
  process.exit(1);
}
log(`  [OK] Node.js ${nodeVer}`);

// ── Step 2: .env.local check ──────────────────────────────────────────────────
if (!exists(".env.local")) {
  log("  [WARN] .env.local not found.");
  if (exists(".env.local.example")) {
    fs.copyFileSync(
      path.join(ROOT, ".env.local.example"),
      path.join(ROOT, ".env.local")
    );
    log("  [OK] Created .env.local from .env.local.example");
    log("  [ACTION REQUIRED] Edit .env.local and add your API key, then run start.js again.");
    log("");
    // Open the file in the default editor
    try {
      if (os.platform() === "win32") {
        spawn("notepad.exe", [path.join(ROOT, ".env.local")], { detached: true, stdio: "ignore" }).unref();
      } else {
        spawn("open", [path.join(ROOT, ".env.local")], { detached: true, stdio: "ignore" }).unref();
      }
    } catch {}
    process.exit(0);
  } else {
    err("  [ERROR] .env.local.example not found. Please re-download Andromeda.");
    process.exit(1);
  }
}
log("  [OK] .env.local found");

// ── Step 3: pnpm check ────────────────────────────────────────────────────────
let pnpmCmd = "pnpm";
const pnpmVer = runCapture("pnpm --version");
if (!pnpmVer) {
  log("  [INFO] pnpm not found, installing via npm...");
  if (!run("npm install -g pnpm")) {
    err("  [ERROR] Failed to install pnpm. Try running as Administrator.");
    process.exit(1);
  }
  log("  [OK] pnpm installed");
} else {
  log(`  [OK] pnpm ${pnpmVer}`);
}

// ── Step 4: Install dependencies ─────────────────────────────────────────────
if (!exists("node_modules")) {
  log("");
  log("  [INFO] First run — installing dependencies (~2 minutes)...");
  log("");
  if (!run("pnpm install --no-frozen-lockfile")) {
    err("  [ERROR] Dependency installation failed.");
    err("  Try: delete node_modules folder and run start.js again.");
    process.exit(1);
  }
  log("  [OK] Dependencies installed");
  log("");
}

// ── Step 5: Build if dist is missing ─────────────────────────────────────────
const distEntry = path.join(ROOT, "dist", "_core", "index.js");
if (!fs.existsSync(distEntry)) {
  log("");
  log("  [INFO] Building Andromeda (~30 seconds)...");
  log("");
  if (!run("pnpm run build")) {
    err("  [ERROR] Build failed. See errors above.");
    err("  Common fixes:");
    err("    1. Delete node_modules and run start.js again");
    err("    2. Make sure Node.js 18+ is installed");
    process.exit(1);
  }
  log("  [OK] Build complete");
  log("");
}

// ── Step 6: Kill anything on port 3000 ───────────────────────────────────────
if (os.platform() === "win32") {
  try {
    const output = execSync('netstat -aon 2>nul | findstr ":3000 "', { encoding: "utf8" });
    const pids = [...new Set(
      output.split("\n")
        .map(line => line.trim().split(/\s+/).pop())
        .filter(pid => pid && /^\d+$/.test(pid) && pid !== "0")
    )];
    for (const pid of pids) {
      try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" }); } catch {}
    }
  } catch {}
}

// ── Step 7: Open browser after warmup ────────────────────────────────────────
setTimeout(() => {
  const url = "http://localhost:3000";
  try {
    if (os.platform() === "win32") {
      spawn("cmd", ["/c", "start", url], { detached: true, stdio: "ignore" }).unref();
    } else if (os.platform() === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {}
}, 5000);

// ── Step 8: Start server with auto-restart ────────────────────────────────────
log("");
log("  ============================================================");
log("   Andromeda AI v10.0.0  |  http://localhost:3000");
log("   Press Ctrl+C to stop.");
log("  ============================================================");
log("");

let restartCount = 0;
const MAX_RESTARTS = 20;

function startServer() {
  if (restartCount >= MAX_RESTARTS) {
    err(`  [ERROR] Server crashed ${MAX_RESTARTS} times. Giving up.`);
    err("  Check the errors above and fix the issue, then run start.js again.");
    process.exit(1);
  }

  const serverPath = path.join(ROOT, "dist", "_core", "index.js");
  const child = spawn("node", [serverPath], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env }
  });

  child.on("exit", (code, signal) => {
    if (signal === "SIGINT" || signal === "SIGTERM") {
      log("\n  [INFO] Server stopped. Goodbye.");
      process.exit(0);
    }
    restartCount++;
    log(`\n  [INFO] Server exited (code ${code}). Restarting in 3 seconds... (attempt ${restartCount}/${MAX_RESTARTS})`);
    log("  [INFO] Press Ctrl+C NOW to exit completely.");
    setTimeout(startServer, 3000);
  });
}

// Handle Ctrl+C
process.on("SIGINT", () => {
  log("\n  [INFO] Shutting down...");
  process.exit(0);
});

startServer();
