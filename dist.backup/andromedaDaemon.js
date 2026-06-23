import { createRequire as __createRequire } from "module";
const require = __createRequire(import.meta.url);

// server/andromedaDaemon.ts
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
var PID_FILE = process.env.ANDROMEDA_PID_FILE ?? "/tmp/andromeda.pid";
var LOG_DIR = process.env.ANDROMEDA_LOG_DIR ?? path.join(os.homedir(), ".andromeda");
var LOG_FILE = path.join(LOG_DIR, "daemon.log");
var MAX_RESTARTS = 10;
var INITIAL_BACKOFF_MS = 1e3;
var MAX_BACKOFF_MS = 6e4;
var HEALTHY_UPTIME_MS = 3e4;
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function log(msg) {
  const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}
`;
  process.stdout.write(line);
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
  }
}
function writePid(pid) {
  fs.writeFileSync(PID_FILE, String(pid), "utf8");
}
function readPid() {
  try {
    const raw = fs.readFileSync(PID_FILE, "utf8").trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}
function removePid() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
  }
}
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function cmdStatus() {
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
function cmdStop() {
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
  let waited = 0;
  const interval = setInterval(() => {
    waited += 200;
    if (!isProcessRunning(pid)) {
      clearInterval(interval);
      removePid();
      console.log("Andromeda daemon stopped.");
      process.exit(0);
    }
    if (waited >= 1e4) {
      clearInterval(interval);
      console.log(`Daemon did not stop in 10s, sending SIGKILL...`);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
      }
      removePid();
      process.exit(1);
    }
  }, 200);
}
function resolveServerEntry() {
  const candidates = [
    path.resolve(process.cwd(), "dist/index.js"),
    path.resolve(process.cwd(), "server/_core/index.ts")
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Cannot find server entry point. Tried: ${candidates.join(", ")}. Run 'pnpm build' first.`
  );
}
function startDaemon() {
  ensureLogDir();
  const existingPid = readPid();
  if (existingPid !== null && isProcessRunning(existingPid)) {
    console.log(`Andromeda daemon already running (PID ${existingPid}). Use 'pnpm daemon:stop' first.`);
    process.exit(1);
  }
  writePid(process.pid);
  log(`Andromeda daemon manager started (PID ${process.pid})`);
  let restartCount = 0;
  let backoffMs = INITIAL_BACKOFF_MS;
  let child = null;
  let startTime = 0;
  let stopping = false;
  function spawnServer() {
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
      stdio: ["ignore", "pipe", "pipe"]
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
        `Server exited (code=${code}, signal=${signal}, uptime=${(uptime / 1e3).toFixed(1)}s). Restarting in ${backoffMs}ms (attempt ${restartCount}/${MAX_RESTARTS})...`
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
  function cleanup() {
    removePid();
    log("Andromeda daemon manager exiting.");
  }
  function handleSignal(sig) {
    log(`Received ${sig}. Stopping daemon...`);
    stopping = true;
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
    setTimeout(() => {
      cleanup();
      process.exit(0);
    }, 5e3);
  }
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("uncaughtException", (err) => {
    log(`Daemon uncaught exception: ${err.message}
${err.stack}`);
  });
  spawnServer();
}
var command = process.argv[2];
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
