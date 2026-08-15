#!/usr/bin/env node
/**
 * Andromeda single-entry launcher.
 *
 * This is the supported bootstrap command for local development:
 *   pnpm launch
 *
 * It creates durable logs, checks supported runtimes, installs dependencies
 * deterministically when needed, builds the app, and starts the Electron launcher.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const LOG_DIR = path.join(ROOT, ".andromeda", "launcher-logs");
const now = () => new Date().toISOString().replace(/[:.]/g, "-");

fs.mkdirSync(LOG_DIR, { recursive: true });
const SESSION_LOG = path.join(LOG_DIR, `launch-${now()}.log`);

function write(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(SESSION_LOG, `${line}${os.EOL}`);
}

function fail(message, details = "") {
  write(`ERROR: ${message}`);
  if (details) write(details);
  write(`Full diagnostic log: ${SESSION_LOG}`);
  process.exitCode = 1;
}

function run(command, args, label, timeout = 600_000) {
  write(`${label}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout,
    env: { ...process.env, CI: "" },
  });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  fs.appendFileSync(SESSION_LOG, `${stdout}${stderr}`);
  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const combined = `${stdout}${stderr}`.trim();
    const tail = combined.split(/\r?\n/).slice(-30).join(os.EOL);
    throw new Error(`${label} failed with exit code ${result.status}.${os.EOL}${tail}`);
  }
  return { stdout, stderr };
}

function versionAtLeast(actual, requiredMajor) {
  const match = String(actual).match(/v?(\d+)/);
  return Boolean(match) && Number(match[1]) >= requiredMajor;
}

function main() {
  write("Andromeda local launcher started");
  write(`Project root: ${ROOT}`);
  write(`Diagnostic log: ${SESSION_LOG}`);

  if (!versionAtLeast(process.version, 22)) {
    fail(`Node.js 22+ is required; detected ${process.version}. Install Node.js 22 LTS and retry.`);
    return;
  }
  write(`Node.js ${process.version} verified`);
  if (versionAtLeast(process.version, 24)) {
    write("WARNING: Node.js 24+ detected. Node.js 22 LTS is the recommended local runtime for reproducible installs.");
  }

  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) {
    fail("Missing .env.local. Copy .env.local.example to .env.local and configure an LLM provider key.");
    return;
  }

  let pnpmVersion;
  try {
    pnpmVersion = run("pnpm", ["--version"], "Checking pnpm", 30_000).stdout.trim();
  } catch (error) {
    fail("pnpm 11+ is required. Install it with: npm install -g pnpm@11.9.0", error.message);
    return;
  }
  if (!versionAtLeast(pnpmVersion, 11)) {
    fail(`pnpm 11+ is required; detected ${pnpmVersion}. Install it with: npm install -g pnpm@11.9.0`);
    return;
  }
  write(`pnpm ${pnpmVersion} verified`);

  // Always reconcile the lockfile. A failed first run can leave an incomplete
  // node_modules directory behind, so checking only for its existence is unsafe.
  try {
    run("pnpm", ["install", "--frozen-lockfile", "--reporter=append-only"], "Reconciling dependencies");
    write("Dependencies are complete and match the lockfile");
  } catch (error) {
    fail("Dependency installation failed. Review the final 30 lines above and attach the diagnostic log when requesting help.", error.message);
    return;
  }

  const electronCli = path.join(ROOT, "node_modules", "electron", "cli.js");
  if (!fs.existsSync(electronCli)) {
    fail("Electron was not installed after dependency reconciliation. See the diagnostic log.");
    return;
  }

  // The Electron UI owns the build step so users can see live status and open
  // its diagnostics directly if a build fails.
  write("Starting the Andromeda desktop launcher");
  const electron = spawnSync(process.execPath, [electronCli, path.join(ROOT, "launcher", "main.cjs")], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (electron.error) {
    fail("Electron launcher could not start.", electron.error.message);
  } else if (electron.status && electron.status !== 0) {
    fail(`Electron launcher exited with code ${electron.status}.`);
  }
}

main();
