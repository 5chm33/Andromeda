/**
 * Andromeda GUI Launcher — Electron Main Process
 * v12.0.0
 *
 * Replaces the raw cmd.exe window with a branded splash screen.
 * Steps:
 *   1. Check Node.js version
 *   2. Validate .env.local (smart key check)
 *   3. Check / install pnpm
 *   4. Install dependencies (first run only)
 *   5. Build if dist is missing
 *   6. Kill port 3000 if occupied
 *   7. Start server with auto-restart
 *   8. Open browser when server is ready
 */

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { execSync, spawn } = require("child_process");
const fs   = require("fs");
const os   = require("os");
const path = require("path");
const net  = require("net");

// ── Root of the Andromeda project — robust multi-strategy resolution ─────────
// When Electron is launched globally (e.g. `electron launcher\main.cjs` from
// the .bat), __dirname is the launcher/ folder inside the project. But when
// launched via a globally-installed Electron binary, process.cwd() is the
// directory the .bat was run from (the project root). We try both.
function findProjectRoot() {
  const candidates = [
    // 1. One level up from launcher/ — correct when __dirname is launcher/
    path.join(__dirname, ".."),
    // 2. process.cwd() — correct when .bat sets CWD to project root
    process.cwd(),
    // 3. Two levels up (in case Electron resolves __dirname differently)
    path.join(__dirname, "..", ".."),
    // 4. Executable path heuristic — walk up from electron binary location
    path.join(process.execPath, "..", "..", ".."),
  ];
  for (const candidate of candidates) {
    // A valid project root has package.json AND either .env.local or .env.local.example
    const hasPkg = fs.existsSync(path.join(candidate, "package.json"));
    const hasEnv = fs.existsSync(path.join(candidate, ".env.local")) ||
                   fs.existsSync(path.join(candidate, ".env.local.example"));
    if (hasPkg && hasEnv) return path.resolve(candidate);
  }
  // Fallback: return the __dirname parent and hope for the best
  return path.resolve(path.join(__dirname, ".."));
}
const SOURCE_ROOT = findProjectRoot();
const IS_PACKAGED = app.isPackaged;
// In the portable app, application code is read-only inside app.asar while
// credentials and diagnostics belong in the user's Electron data directory.
const ROOT = IS_PACKAGED ? path.join(process.resourcesPath, "app.asar") : SOURCE_ROOT;
const USER_STATE_DIR = IS_PACKAGED
  ? path.join(app.getPath("userData"), "Andromeda")
  : path.join(SOURCE_ROOT, ".andromeda");
const ENV_PATH = IS_PACKAGED
  ? path.join(USER_STATE_DIR, ".env.local")
  : path.join(SOURCE_ROOT, ".env.local");
const DIAGNOSTIC_DIR = path.join(USER_STATE_DIR, "launcher-logs");
const DIAGNOSTIC_LOG = path.join(
  DIAGNOSTIC_DIR,
  `launch-${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
);
fs.mkdirSync(DIAGNOSTIC_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────
function asText(value) {
  if (!value) return "";
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

function writeDiagnostic(level, message) {
  fs.appendFileSync(
    DIAGNOSTIC_LOG,
    `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${os.EOL}`,
  );
}

function outputTail(value, lineCount = 30) {
  return asText(value)
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-lineCount)
    .join(os.EOL);
}

function runCapture(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", ...opts }).trim();
  } catch { return null; }
}

function runChecked(cmd, label, timeout) {
  writeDiagnostic("info", `${label}: ${cmd}`);
  try {
    const output = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
    });
    if (output) writeDiagnostic("info", output);
    return output;
  } catch (error) {
    const captured = [asText(error.stdout), asText(error.stderr), asText(error.message)]
      .filter(Boolean)
      .join(os.EOL);
    writeDiagnostic("error", captured || `${label} failed without captured output.`);
    const tail = outputTail(captured) || "No process output was captured.";
    throw new Error(`${label} failed.${os.EOL}${tail}`);
  }
}

function resolveRootPath(candidate) {
  return path.isAbsolute(candidate) ? candidate : path.join(ROOT, candidate);
}

function exists(candidate) {
  return fs.existsSync(resolveRootPath(candidate));
}

function parseEnvKey(content, key) {
  const m = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m"));
  return m ? m[1].trim() : "";
}

const isPlaceholder = (v) =>
  !v || v.includes("_api_key_here") || v.includes("your_") || v === "";

// ── State ─────────────────────────────────────────────────────────────────────
let win = null;
let serverProcess = null;
let restartCount = 0;
const MAX_RESTARTS = 20;
const SERVER_PORT = 3000;

// ── IPC helpers ───────────────────────────────────────────────────────────────
function send(event, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(event, payload);
  }
}

function log(msg)  { writeDiagnostic("info", msg); send("log",  { level: "info",  msg }); }
function warn(msg) { writeDiagnostic("warn", msg); send("log",  { level: "warn",  msg }); }
function err(msg)  { writeDiagnostic("error", msg); send("log",  { level: "error", msg }); }
function step(id, status, label) { send("step", { id, status, label }); }

// ── Create the launcher window ────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 680,
    height: 520,
    resizable: false,
    frame: false,          // frameless — we draw our own title bar
    transparent: false,
    backgroundColor: "#09090b",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "splash.html"));

  win.on("closed", () => {
    win = null;
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
    app.quit();
  });
}

// ── IPC: window controls ──────────────────────────────────────────────────────
ipcMain.on("window-minimize", () => win && win.minimize());
ipcMain.on("window-close",    () => win && win.close());
ipcMain.on("open-browser",    () => shell.openExternal(`http://localhost:${SERVER_PORT}`));
ipcMain.on("open-env",        () => shell.openPath(ENV_PATH));
ipcMain.on("open-diagnostics", () => shell.openPath(DIAGNOSTIC_LOG));

// ── Main startup sequence ─────────────────────────────────────────────────────
async function runStartup() {
  // Small delay so the splash renders first
  await sleep(400);

  // Persist startup facts before any external command runs.
  log(`Project root: ${ROOT}`);
  log(`Diagnostic log: ${DIAGNOSTIC_LOG}`);
  const envExists = fs.existsSync(ENV_PATH);
  log(`  .env.local found: ${envExists}`);

  // ── Step 1: Runtime ──────────────────────────────────────────────────────
  step("node", "running", "Checking runtime…");
  if (IS_PACKAGED) {
    step("node", "done", `Bundled Electron ${process.versions.electron}`);
    log("Using the bundled desktop runtime; no local Node.js installation is required.");
  } else {
    const nodeVer = runCapture("node --version");
    if (!nodeVer) {
      step("node", "error", "Node.js not found");
      err("Cannot detect Node.js. Install Node.js 22 LTS, reopen the launcher, and try again.");
      send("show-log-button", {});
      return;
    }
    const major = parseInt(nodeVer.replace("v", "").split(".")[0], 10);
    if (major < 22) {
      step("node", "error", `Node.js ${nodeVer} unsupported`);
      err(`Node.js 22+ is required. You have ${nodeVer}. Install Node.js 22 LTS and relaunch.`);
      send("show-log-button", {});
      return;
    }
    step("node", "done", `Node.js ${nodeVer}`);
    log(`Node.js ${nodeVer} ✓`);
    if (major >= 24) {
      warn(`Node.js ${nodeVer} is newer than the recommended Node.js 22 LTS runtime; continuing because compatibility checks passed.`);
    }
  }

  // ── Step 2: .env.local check ─────────────────────────────────────────────
  step("env", "running", "Checking API keys…");
  await sleep(200);

  const foundEnvFile = fs.existsSync(ENV_PATH) ? ENV_PATH : null;
  log(`  Environment file: ${foundEnvFile || "not found"}`);

  if (!foundEnvFile) {
    const examplePath = path.join(ROOT, ".env.local.example");
    if (!fs.existsSync(examplePath)) {
      step("env", "error", "Configuration template missing");
      err(`Cannot find .env.local.example in: ${ROOT}`);
      send("show-log-button", {});
      return;
    }
    fs.mkdirSync(USER_STATE_DIR, { recursive: true });
    fs.copyFileSync(examplePath, ENV_PATH);
    shell.openPath(ENV_PATH);
    step("env", "error", "API keys required — fill in .env.local");
    err("Fill in at least one LLM key, save the file, then reopen Andromeda.");
    send("show-env-button", {});
    return;
  }

  log(`  Using env file: ${foundEnvFile}`);
  const envContent = fs.readFileSync(foundEnvFile, "utf8");
  const primaryKeys = [
    "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY", "KIMI_API_KEY",
  ];
  const filledKey = primaryKeys.find(k => !isPlaceholder(parseEnvKey(envContent, k)));

  if (!filledKey) {
    shell.openPath(ENV_PATH);
    step("env", "error", "No LLM key found — fill in .env.local");
    err("Add at least one key: DEEPSEEK_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY");
    send("show-env-button", {});
    return;
  }
  step("env", "done", `API key: ${filledKey}`);
  log(`LLM key configured (${filledKey}) ✓`);

  // ── Step 3: Dependencies ─────────────────────────────────────────────────
  step("deps", "running", "Checking dependencies…");
  await sleep(200);
  if (IS_PACKAGED) {
    step("deps", "done", "Bundled dependencies ready");
    log("Using application dependencies bundled with the portable launcher.");
  } else {
    const pnpmVer = runCapture("pnpm --version");
    const pnpmMajor = pnpmVer ? parseInt(pnpmVer.split(".")[0], 10) : 0;
    if (!pnpmVer || pnpmMajor < 11) {
      step("deps", "error", "pnpm 11+ required");
      err(`Install pnpm 11.9.0 with: npm install -g pnpm@11.9.0. Detected: ${pnpmVer || "not found"}.`);
      send("show-log-button", {});
      return;
    }
    log(`pnpm ${pnpmVer} ✓`);
    try {
      runChecked("pnpm install --frozen-lockfile --reporter=append-only", "Dependency installation", 600_000);
      step("deps", "done", "Dependencies ready");
      log("Dependencies installed ✓");
    } catch (e) {
      step("deps", "error", "Dependency install failed — see diagnostics");
      err(e.message);
      err("Click Open diagnostics to view and share the full installer log. Do not share .env.local.");
      send("show-log-button", {});
      return;
    }
  }

  // ── Step 5: Build ─────────────────────────────────────────────────────────
  const distEntry    = path.join(ROOT, "dist", "_core", "index.js");
  const distFrontend = path.join(ROOT, "dist", "public", "index.html");

  // Packaged launches use build assets bundled at release time. Source checkouts
  // rebuild when necessary so development remains convenient.
  function needsBuild() {
    if (IS_PACKAGED) return false;
    if (process.env.FORCE_REBUILD === "1") { log("FORCE_REBUILD=1 set — rebuilding…"); return true; }
    if (!fs.existsSync(distEntry) || !fs.existsSync(distFrontend)) return true;
    try {
      const distMtime = fs.statSync(distFrontend).mtimeMs;
      // Check if any .tsx/.ts/.css source file is newer than the dist
      const srcDirs = [
        path.join(ROOT, "client", "src"),
        path.join(ROOT, "server"),
      ];
      function walkNewest(dir) {
        if (!fs.existsSync(dir)) return 0;
        let newest = 0;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith(".")) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            newest = Math.max(newest, walkNewest(full));
          } else if (/\.(tsx?|css|html)$/.test(entry.name)) {
            newest = Math.max(newest, fs.statSync(full).mtimeMs);
          }
        }
        return newest;
      }
      const srcMtime = Math.max(...srcDirs.map(walkNewest));
      return srcMtime > distMtime;
    } catch { return true; }
  }

  if (needsBuild()) {
    step("build", "running", "Building Andromeda (~30 sec)…");
    log("Building latest changes…");
    try {
      runChecked("pnpm run build", "Andromeda build", 240_000);
      log("Build complete ✓");
    } catch (e) {
      step("build", "error", "Build failed — see diagnostics");
      err(e.message);
      err("Click Open diagnostics to view and share the full build log.");
      send("show-log-button", {});
      return;
    }
  }
  step("build", "done", IS_PACKAGED ? "Bundled build ready" : "Build ready");

  // ── Step 6: Kill port 3000 ────────────────────────────────────────────────
  step("server", "running", "Starting server…");
  await killPort(SERVER_PORT);

  // ── Step 7: Start server ──────────────────────────────────────────────────
  startServer();
}

// ── Server management ─────────────────────────────────────────────────────────
function startServer() {
  if (restartCount >= MAX_RESTARTS) {
    step("server", "error", `Crashed ${MAX_RESTARTS} times — giving up`);
    err(`Server crashed ${MAX_RESTARTS} times. Check logs and restart.`);
    return;
  }

  const serverPath = path.join(ROOT, "dist", "_core", "index.js");

  // Load the user-owned .env.local variables so the server has all API keys.
  const envVars = { ...process.env };
  if (fs.existsSync(ENV_PATH)) {
    const envLines = fs.readFileSync(ENV_PATH, "utf8").split("\n");
    for (const line of envLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (k) envVars[k] = v;
    }
  }

  const runtime = IS_PACKAGED ? process.execPath : "node";
  const runtimeEnv = IS_PACKAGED
    ? { ...envVars, ELECTRON_RUN_AS_NODE: "1" }
    : envVars;
  serverProcess = spawn(runtime, [serverPath], {
    cwd: IS_PACKAGED ? USER_STATE_DIR : SOURCE_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: runtimeEnv,
  });

  serverProcess.stdout.on("data", (data) => {
    const text = data.toString().trim();
    if (text) log(text);
  });

  serverProcess.stderr.on("data", (data) => {
    const text = data.toString().trim();
    if (text) warn(text);
  });

  // Poll until the server is accepting connections
  waitForPort(SERVER_PORT, 60_000).then((ready) => {
    if (ready) {
      step("server", "done", `Server running on :${SERVER_PORT}`);
      log(`Andromeda is live at http://localhost:${SERVER_PORT} ✓`);
      send("server-ready", { url: `http://localhost:${SERVER_PORT}` });
      // Auto-open the browser 1.5 s after server is ready
      // v12.2.1: Only open on first start — not on auto-restarts (prevents multiple tabs)
      if (restartCount === 0) {
        setTimeout(() => {
          shell.openExternal(`http://localhost:${SERVER_PORT}`);
        }, 1500);
      }
    } else {
      step("server", "error", "Server did not start in time");
      err("Server did not respond within 60 seconds.");
    }
  });

  serverProcess.on("exit", (code, signal) => {
    if (signal === "SIGINT" || signal === "SIGTERM") return;
    restartCount++;
    warn(`Server exited (code ${code}). Restarting in 3s… (${restartCount}/${MAX_RESTARTS})`);
    step("server", "running", `Restarting… (attempt ${restartCount})`);
    setTimeout(startServer, 3000);
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForPort(port, timeoutMs) {
  return new Promise(resolve => {
    const start = Date.now();
    function attempt() {
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock.on("connect", () => { sock.destroy(); resolve(true); });
      sock.on("error",   () => { sock.destroy(); retry(); });
      sock.on("timeout", () => { sock.destroy(); retry(); });
      sock.connect(port, "127.0.0.1");
    }
    function retry() {
      if (Date.now() - start > timeoutMs) { resolve(false); return; }
      setTimeout(attempt, 500);
    }
    attempt();
  });
}

function killPort(port) {
  return new Promise(resolve => {
    try {
      if (process.platform === "win32") {
        const out = execSync(`netstat -aon 2>nul | findstr ":${port} "`, { encoding: "utf8" });
        const pids = [...new Set(
          out.split("\n")
            .map(l => l.trim().split(/\s+/).pop())
            .filter(p => p && /^\d+$/.test(p) && p !== "0")
        )];
        for (const pid of pids) {
          try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" }); } catch {}
        }
      } else {
        execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: "ignore" });
      }
    } catch {}
    resolve();
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  win.webContents.once("did-finish-load", () => {
    runStartup();
  });
});

app.on("window-all-closed", () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  app.quit();
});
