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
const ROOT = findProjectRoot();

// ── Helpers ───────────────────────────────────────────────────────────────────
function runCapture(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", ...opts }).trim();
  } catch { return null; }
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
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

function log(msg)  { send("log",  { level: "info",  msg }); }
function warn(msg) { send("log",  { level: "warn",  msg }); }
function err(msg)  { send("log",  { level: "error", msg }); }
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
ipcMain.on("open-env",        () => shell.openPath(path.join(ROOT, ".env.local")));

// ── Main startup sequence ─────────────────────────────────────────────────────
async function runStartup() {
  // Small delay so the splash renders first
  await sleep(400);

  // Debug: show resolved project root so path issues are immediately visible
  log(`Project root: ${ROOT}`);
  const envExists = fs.existsSync(path.join(ROOT, ".env.local"));
  log(`  .env.local found: ${envExists}`);

  // ── Step 1: Node.js version ──────────────────────────────────────────────
  step("node", "running", "Checking Node.js…");
  const nodeVer = runCapture("node --version");
  if (!nodeVer) {
    step("node", "error", "Node.js not found");
    err("Cannot detect Node.js. Please install Node.js 18+ and try again.");
    return;
  }
  const major = parseInt(nodeVer.replace("v", "").split(".")[0], 10);
  if (major < 18) {
    step("node", "error", `Node.js ${nodeVer} too old`);
    err(`Node.js 18+ required. You have ${nodeVer}. Please upgrade.`);
    return;
  }
  step("node", "done", `Node.js ${nodeVer}`);
  log(`Node.js ${nodeVer} ✓`);

  // ── Step 2: .env.local check ─────────────────────────────────────────────
  step("env", "running", "Checking API keys…");
  await sleep(200);

  // Check multiple possible env file names in priority order
  const envCandidates = [".env.local", ".env", ".env.production", ".env.development"];
  const foundEnvFile = envCandidates.find(f => exists(f));
  log(`  Env file search: ${envCandidates.map(f => `${f}=${exists(f)}`).join(', ')}`);

  if (!foundEnvFile) {
    if (exists(".env.local.example")) {
      // Don't overwrite — just open the example so user can fill it in
      log("No .env.local found. Opening .env.local.example for editing…");
      // Copy only if truly no env file exists at all
      fs.copyFileSync(
        path.join(ROOT, ".env.local.example"),
        path.join(ROOT, ".env.local")
      );
      shell.openPath(path.join(ROOT, ".env.local"));
      step("env", "error", "API keys required — fill in .env.local");
      err("Fill in at least one LLM key (DEEPSEEK_API_KEY recommended), then relaunch.");
      send("show-env-button", {});
      return;
    } else {
      step("env", "error", ".env.local not found");
      err(`No .env.local found in: ${ROOT}`);
      err("Please create .env.local with your API keys and relaunch.");
      send("show-env-button", {});
      return;
    }
  }

  log(`  Using env file: ${foundEnvFile}`);
  const envContent = fs.readFileSync(path.join(ROOT, foundEnvFile), "utf8");
  const primaryKeys = [
    "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY", "KIMI_API_KEY",
  ];
  const filledKey = primaryKeys.find(k => !isPlaceholder(parseEnvKey(envContent, k)));

  if (!filledKey) {
    shell.openPath(path.join(ROOT, ".env.local"));
    step("env", "error", "No LLM key found — fill in .env.local");
    err("Add at least one key: DEEPSEEK_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY");
    send("show-env-button", {});
    return;
  }
  step("env", "done", `API key: ${filledKey}`);
  log(`LLM key configured (${filledKey}) ✓`);

  // ── Step 3: pnpm ─────────────────────────────────────────────────────────
  step("deps", "running", "Checking pnpm…");
  await sleep(200);
  let pnpmVer = runCapture("pnpm --version");
  if (!pnpmVer) {
    log("pnpm not found — installing via npm…");
    try {
      execSync("npm install -g pnpm", { cwd: ROOT, stdio: "pipe" });
      pnpmVer = runCapture("pnpm --version");
    } catch {
      step("deps", "error", "pnpm install failed");
      err("Failed to install pnpm. Try running as Administrator.");
      return;
    }
  }
  log(`pnpm ${pnpmVer} ✓`);

  // ── Step 4: Install dependencies ─────────────────────────────────────────
  if (!exists("node_modules")) {
    step("deps", "running", "Installing dependencies (~2 min)…");
    log("First run — installing dependencies…");
    try {
      execSync("pnpm install --no-frozen-lockfile", {
        cwd: ROOT, stdio: "pipe", timeout: 300_000,
      });
      log("Dependencies installed ✓");
    } catch (e) {
      step("deps", "error", "Dependency install failed");
      err("pnpm install failed. Delete node_modules and try again.");
      return;
    }
  }
  step("deps", "done", "Dependencies ready");

  // ── Step 5: Build ─────────────────────────────────────────────────────────
  const distEntry    = path.join(ROOT, "dist", "_core", "index.js");
  const distFrontend = path.join(ROOT, "dist", "public", "index.html");

  // Rebuild if dist is missing OR if source files are newer than the dist
  function needsBuild() {
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
      execSync("pnpm run build", {
        cwd: ROOT, stdio: "pipe", timeout: 180_000,
      });
      log("Build complete ✓");
    } catch (e) {
      step("build", "error", "Build failed");
      err("Build failed. Check Node.js 18+ is installed and try again.");
      return;
    }
  }
  step("build", "done", "Build ready");

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

  // Load .env.local variables so the server has all API keys
  const envVars = { ...process.env };
  const envCandidates2 = [".env.local", ".env", ".env.production", ".env.development"];
  const envFile2 = envCandidates2.find(f => fs.existsSync(path.join(ROOT, f)));
  if (envFile2) {
    const envLines = fs.readFileSync(path.join(ROOT, envFile2), "utf8").split("\n");
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

  serverProcess = spawn("node", [serverPath], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: envVars,
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
      setTimeout(() => {
        shell.openExternal(`http://localhost:${SERVER_PORT}`);
      }, 1500);
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
