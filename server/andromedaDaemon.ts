/**
 * andromedaDaemon.ts — v1.0.0
 *
 * Andromeda background daemon mode.
 *
 * When run as a daemon, this module:
 *   1. Spawns the main Andromeda server as a child process
 *   2. Auto-restarts it on crash (with exponential back-off)
 *   3. Writes a PID file to /tmp/andromeda.pid
 *   4. Logs to ~/.andromeda/daemon.log (or $ANDROMEDA_LOG_DIR)
 *   5. Handles SIGTERM / SIGINT cleanly (stops child + removes PID file)
 *
 * Usage:
 *   node dist/andromedaDaemon.js          # start daemon
 *   node dist/andromedaDaemon.js stop     # stop running daemon
 *   node dist/andromedaDaemon.js status   # check daemon status
 *
 * Or via package.json scripts:
 *   pnpm daemon:start
 *   pnpm daemon:stop
 *   pnpm daemon:status
 */

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── Configuration ────────────────────────────────────────────────────────────

const PID_FILE = process.env.ANDROMEDA_PID_FILE ?? "/tmp/andromeda.pid";
const LOG_DIR = process.env.ANDROMEDA_LOG_DIR ?? path.join(os.homedir(), ".andromeda");
const LOG_FILE = path.join(LOG_DIR, "daemon.log");

const MAX_RESTARTS = 10;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const HEALTHY_UPTIME_MS = 30_000; // reset restart count if up for this long

// ─── Logging ──────────────────────────────────────────────────────────────────

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // Non-fatal
  }
}

// ─── PID file helpers ─────────────────────────────────────────────────────────

function writePid(pid: number): void {
  fs.writeFileSync(PID_FILE, String(pid), "utf8");
}

function readPid(): number | null {
  try {
    const raw = fs.readFileSync(PID_FILE, "utf8").trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function removePid(): void {
  try { fs.unlinkSync(PID_FILE); } catch { /* already gone */ }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = check existence
    return true;
  } catch {
    return false;
  }
}

// ─── Daemon commands ──────────────────────────────────────────────────────────

function cmdStatus(): void {
  const pid = readPid();
  if (pid === null) {
    console.log("Andromeda daemon: NOT RUNNING (no PID file)");
    process.exit(1);
  }
  if (isProcessRunning(pid)) {
    console.log(`Andromeda daemon: RUNNING (PID ${pid})`);
    process.exit(0);
  } else {
    console.log(`Andromeda daemon: STALE PID FILE (PID ${pid} is not running)`);
    removePid();
    process.exit(1);
  }
}

function cmdStop(): void {
  const pid = readPid();
  if (pid === null) {
    console.log("Andromeda daemon: not running.");
    process.exit(0);
  }
  if (!isProcessRunning(pid)) {
    console.log(`Andromeda daemon: PID ${pid} not found, cleaning up.`);
    removePid();
    process.exit(0);
  }
  console.log(`Stopping Andromeda daemon (PID ${pid})...`);
  process.kill(pid, "SIGTERM");
  // Wait for it to exit
  let waited = 0;
  const interval = setInterval(() => {
    waited += 200;
    if (!isProcessRunning(pid)) {
      clearInterval(interval);
      removePid();
      console.log("Andromeda daemon stopped.");
      process.exit(0);
    }
    if (waited >= 10_000) {
      clearInterval(interval);
      console.log(`Daemon did not stop in 10s, sending SIGKILL...`);
      try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
      removePid();
      process.exit(1);
    }
  }, 200);
}

// ─── Main daemon loop ─────────────────────────────────────────────────────────

function resolveServerEntry(): string {
  // esbuild bundles everything into dist/index.js (see build.mjs)
  // For dev, fall back to tsx running server/_core/index.ts
  const candidates = [
    path.resolve(process.cwd(), "dist/index.js"),
    path.resolve(process.cwd(), "server/_core/index.ts"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Cannot find server entry point. Tried: ${candidates.join(", ")}. Run 'pnpm build' first.`
  );
}

function startDaemon(): void {
  ensureLogDir();

  // Check for existing daemon
  const existingPid = readPid();
  if (existingPid !== null && isProcessRunning(existingPid)) {
    console.log(`Andromeda daemon already running (PID ${existingPid}). Use 'pnpm daemon:stop' first.`);
    process.exit(1);
  }

  // Write our own PID (the daemon manager process)
  writePid(process.pid);
  log(`Andromeda daemon manager started (PID ${process.pid})`);

  let restartCount = 0;
  let backoffMs = INITIAL_BACKOFF_MS;
  let child: ChildProcess | null = null;
  let startTime = 0;
  let stopping = false;

  function spawnServer(): void {
    if (stopping) return;

    const serverEntry = resolveServerEntry();
    const isTs = serverEntry.endsWith(".ts");
    const cmd = isTs ? "npx" : "node";
    const args = isTs ? ["ts-node", serverEntry] : [serverEntry];

    log(`Spawning server: ${cmd} ${args.join(" ")} (restart #${restartCount})`);
    startTime = Date.now();

    const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

    child = spawn(cmd, args, {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });

    child.on("exit", (code, signal) => {
      if (stopping) {
        log(`Server exited (code=${code}, signal=${signal}). Daemon stopping.`);
        cleanup();
        return;
      }

      const uptime = Date.now() - startTime;
      if (uptime >= HEALTHY_UPTIME_MS) {
        // Was healthy — reset back-off
        restartCount = 0;
        backoffMs = INITIAL_BACKOFF_MS;
      }

      restartCount++;
      if (restartCount > MAX_RESTARTS) {
        log(`Server crashed ${restartCount} times. Giving up. Check ${LOG_FILE} for details.`);
        cleanup();
        process.exit(1);
      }

      log(
        `Server exited (code=${code}, signal=${signal}, uptime=${(uptime / 1000).toFixed(1)}s). ` +
        `Restarting in ${backoffMs}ms (attempt ${restartCount}/${MAX_RESTARTS})...`
      );

      setTimeout(() => {
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        spawnServer();
      }, backoffMs);
    });

    child.on("error", (err) => {
      log(`Failed to spawn server: ${err.message}`);
    });
  }

  function cleanup(): void {
    removePid();
    log("Andromeda daemon manager exiting.");
  }

  function handleSignal(sig: string): void {
    log(`Received ${sig}. Stopping daemon...`);
    stopping = true;
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
    setTimeout(() => {
      cleanup();
      process.exit(0);
    }, 5_000);
  }

  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("uncaughtException", (err) => {
    log(`Daemon uncaught exception: ${err.message}\n${err.stack}`);
    // Don't exit — keep the daemon alive
  });

  spawnServer();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const command = process.argv[2];

switch (command) {
  case "stop":
    cmdStop();
    break;
  case "status":
    cmdStatus();
    break;
  default:
    startDaemon();
    break;
}
