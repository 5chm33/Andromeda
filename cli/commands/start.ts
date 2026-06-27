/**
 * cli/commands/start.ts — v1.0.0
 * `andromeda start` — validates env, checks port, starts the daemon via pm2.
 */
import { Command } from "commander";
import { execSync, spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import ora from "ora";
import chalk from "chalk";
import { printBanner, printSuccess, printError, printWarning, printInfo, printDim } from "../ui/banner.js";

const ROOT = resolve(import.meta.dirname, "../..");

function validateEnv(): { ok: boolean; missing: string[]; warnings: string[] } {
  const envPath = resolve(ROOT, ".env.local");
  const envExPath = resolve(ROOT, ".env");
  const path = existsSync(envPath) ? envPath : existsSync(envExPath) ? envExPath : null;

  if (!path) {
    return { ok: false, missing: [".env.local not found — run `andromeda doctor` to set up"], warnings: [] };
  }

  const content = readFileSync(path, "utf8");
  const missing: string[] = [];
  const warnings: string[] = [];

  // At least one LLM key is required
  const hasLLM = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "OLLAMA_BASE_URL"]
    .some(k => {
      const m = content.match(new RegExp(`^\\s*${k}\\s*=\\s*(.+)$`, "m"));
      const v = m ? m[1].trim() : "";
      return v && !v.includes("_here") && !v.startsWith("your_");
    });

  if (!hasLLM) missing.push("No LLM API key configured (OPENAI_API_KEY / ANTHROPIC_API_KEY / OLLAMA_BASE_URL)");

  // Optional but recommended
  const recommended = ["GITHUB_TOKEN", "DATABASE_URL"];
  for (const key of recommended) {
    const m = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m"));
    const v = m ? m[1].trim() : "";
    if (!v || v.includes("_here")) warnings.push(`${key} not set — some features will be disabled`);
  }

  return { ok: missing.length === 0, missing, warnings };
}

function isPortInUse(port: number): boolean {
  try {
    execSync(`lsof -ti:${port}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function startCommand(): Command {
  const cmd = new Command("start");
  cmd
    .description("Start the Andromeda daemon")
    .option("-p, --port <port>", "Port to run on", "3000")
    .option("--no-rsi", "Start without the RSI daemon loop")
    .option("--dev", "Start in development mode with hot reload")
    .option("--detach", "Run in background via pm2")
    .action(async (opts) => {
      console.log(printBanner());

      // 1. Env validation
      const spinner = ora({ text: "Validating environment…", color: "cyan" }).start();
      const { ok, missing, warnings } = validateEnv();

      if (!ok) {
        spinner.fail("Environment validation failed");
        for (const m of missing) printError(m);
        printInfo("Run `andromeda doctor` to fix configuration issues.");
        process.exit(1);
      }
      spinner.succeed("Environment validated");

      for (const w of warnings) printWarning(w);

      // 2. Port check
      const port = parseInt(opts.port, 10);
      if (isPortInUse(port)) {
        printWarning(`Port ${port} is already in use.`);
        printInfo("Another Andromeda instance may already be running. Use `andromeda status` to check.");
        process.exit(1);
      }

      // 3. Build check
      const distExists = existsSync(resolve(ROOT, "dist/_core/index.js"));
      if (!distExists && !opts.dev) {
        const buildSpinner = ora({ text: "Building Andromeda (first run)…", color: "cyan" }).start();
        try {
          execSync("pnpm run build", { cwd: ROOT, stdio: "pipe" });
          buildSpinner.succeed("Build complete");
        } catch (e) {
          buildSpinner.fail("Build failed");
          printError("Run `pnpm run build` manually to see errors.");
          process.exit(1);
        }
      }

      // 4. Launch
      const mode = opts.dev ? "development" : "production";
      const rsiFlag = opts.noRsi ? "RSI_ENABLED=false" : "";
      printInfo(`Starting Andromeda in ${chalk.bold(mode)} mode on port ${chalk.bold(port)}…`);

      if (opts.detach) {
        const pmSpinner = ora({ text: "Starting daemon via pm2…", color: "cyan" }).start();
        try {
          execSync(`pm2 start scripts/ecosystem.config.js`, { cwd: ROOT, stdio: "pipe" });
          pmSpinner.succeed("Daemon started (pm2)");
          printSuccess(`Andromeda is running at ${chalk.cyan(`http://localhost:${port}`)}`);
          printDim("Use `andromeda status` to monitor • `andromeda logs` to stream logs");
        } catch {
          pmSpinner.fail("pm2 start failed — is pm2 installed? Run: npm i -g pm2");
          process.exit(1);
        }
      } else {
        // Foreground mode
        printSuccess(`Andromeda starting at ${chalk.cyan(`http://localhost:${port}`)}`);
        printDim("Press Ctrl+C to stop");
        console.log("");

        const script = opts.dev
          ? ["run", "dev"]
          : ["run", "start"];

        const env = { ...process.env, PORT: String(port), NODE_ENV: mode };
        if (rsiFlag) env.RSI_ENABLED = "false";

        const child = spawn("pnpm", script, { cwd: ROOT, stdio: "inherit", env });
        child.on("exit", (code) => process.exit(code ?? 0));
      }
    });

  return cmd;
}
