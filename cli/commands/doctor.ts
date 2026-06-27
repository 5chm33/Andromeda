/**
 * cli/commands/doctor.ts — v1.0.0
 * `andromeda doctor` — comprehensive system diagnostics and auto-fix.
 */
import { Command } from "commander";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { printBanner, printSuccess, printError, printWarning, printInfo, printDim } from "../ui/banner.js";

const ROOT = resolve(import.meta.dirname, "../..");

interface Check {
  name: string;
  run: () => { ok: boolean; detail: string; fix?: () => void };
}

function runCmd(cmd: string): string | null {
  try { return execSync(cmd, { stdio: "pipe", encoding: "utf8" }).trim(); }
  catch { return null; }
}

const CHECKS: Check[] = [
  {
    name: "Node.js ≥ 20",
    run: () => {
      const v = runCmd("node --version");
      const major = v ? parseInt(v.replace("v", "").split(".")[0], 10) : 0;
      return { ok: major >= 20, detail: v ?? "not found" };
    },
  },
  {
    name: "pnpm installed",
    run: () => {
      const v = runCmd("pnpm --version");
      return { ok: !!v, detail: v ? `v${v}` : "not found" };
    },
  },
  {
    name: "node_modules present",
    run: () => {
      const ok = existsSync(resolve(ROOT, "node_modules"));
      return {
        ok,
        detail: ok ? "installed" : "missing",
        fix: ok ? undefined : () => execSync("pnpm install", { cwd: ROOT }),
      };
    },
  },
  {
    name: ".env.local exists",
    run: () => {
      const envPath = resolve(ROOT, ".env.local");
      const exPath = resolve(ROOT, ".env.example");
      const ok = existsSync(envPath);
      return {
        ok,
        detail: ok ? "found" : "missing",
        fix: !ok && existsSync(exPath)
          ? () => copyFileSync(exPath, envPath)
          : undefined,
      };
    },
  },
  {
    name: "LLM API key configured",
    run: () => {
      const envPath = resolve(ROOT, ".env.local");
      if (!existsSync(envPath)) return { ok: false, detail: ".env.local missing" };
      const content = readFileSync(envPath, "utf8");
      const keys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "OLLAMA_BASE_URL"];
      const found = keys.find(k => {
        const m = content.match(new RegExp(`^\\s*${k}\\s*=\\s*(.+)$`, "m"));
        const v = m?.[1]?.trim() ?? "";
        return v && !v.includes("_here") && !v.startsWith("your_");
      });
      return {
        ok: !!found,
        detail: found ? `${found} is set` : "no LLM key found",
      };
    },
  },
  {
    name: "TypeScript compiles",
    run: () => {
      const result = runCmd("pnpm run typecheck 2>&1");
      const ok = result !== null && !result.includes("error TS");
      return { ok, detail: ok ? "0 errors" : "has TS errors — run `pnpm run typecheck`" };
    },
  },
  {
    name: "pm2 available (optional)",
    run: () => {
      const v = runCmd("pm2 --version");
      return { ok: !!v, detail: v ? `v${v}` : "not installed (install with: npm i -g pm2)" };
    },
  },
  {
    name: "Docker available (optional)",
    run: () => {
      const v = runCmd("docker --version");
      return { ok: !!v, detail: v ?? "not installed" };
    },
  },
  {
    name: "Port 3000 free",
    run: () => {
      const inUse = runCmd("lsof -ti:3000");
      return { ok: !inUse, detail: inUse ? `PID ${inUse} using port 3000` : "free" };
    },
  },
];

export function doctorCommand(): Command {
  const cmd = new Command("doctor");
  cmd
    .description("Run system diagnostics and check for configuration issues")
    .option("--fix", "Automatically fix issues where possible")
    .action(async (opts) => {
      console.log(printBanner());
      console.log(chalk.bold("  Running diagnostics…\n"));

      let passed = 0;
      let failed = 0;
      let warned = 0;
      const fixes: Array<() => void> = [];

      for (const check of CHECKS) {
        const spinner = ora({ text: `  Checking: ${check.name}`, color: "cyan" }).start();
        let result: ReturnType<Check["run"]>;
        try {
          result = check.run();
        } catch (e) {
          result = { ok: false, detail: String(e) };
        }

        if (result.ok) {
          spinner.succeed(chalk.green(`  ${check.name}`) + chalk.dim(` — ${result.detail}`));
          passed++;
        } else {
          const isOptional = check.name.includes("optional");
          if (isOptional) {
            spinner.warn(chalk.yellow(`  ${check.name}`) + chalk.dim(` — ${result.detail}`));
            warned++;
          } else {
            spinner.fail(chalk.red(`  ${check.name}`) + chalk.dim(` — ${result.detail}`));
            failed++;
          }
          if (result.fix) fixes.push(result.fix);
        }
      }

      console.log("");
      console.log(chalk.dim("  " + "─".repeat(50)));
      console.log(`  ${chalk.green(`${passed} passed`)}  ${failed > 0 ? chalk.red(`${failed} failed`) : chalk.dim("0 failed")}  ${warned > 0 ? chalk.yellow(`${warned} warnings`) : chalk.dim("0 warnings")}`);
      console.log("");

      if (failed === 0) {
        printSuccess("Andromeda is ready to run! Start with `andromeda start`");
      } else if (opts.fix && fixes.length > 0) {
        printInfo(`Applying ${fixes.length} auto-fix(es)…`);
        for (const fix of fixes) {
          try { fix(); printSuccess("Fixed."); }
          catch (e) { printError(`Fix failed: ${e}`); }
        }
        printInfo("Re-run `andromeda doctor` to verify.");
      } else if (fixes.length > 0) {
        printInfo(`Run \`andromeda doctor --fix\` to automatically fix ${fixes.length} issue(s).`);
      } else {
        printError("Manual intervention required. See details above.");
      }
    });

  return cmd;
}
