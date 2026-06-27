/**
 * cli/commands/status.ts — v1.0.0
 * `andromeda status` — shows daemon health, RSI state, and system metrics.
 */
import { Command } from "commander";
import { execSync } from "child_process";
import { resolve } from "path";
import chalk from "chalk";
import boxen from "boxen";
import ora from "ora";
import { printBanner, printError, printInfo } from "../ui/banner.js";

const ROOT = resolve(import.meta.dirname, "../..");

interface HealthData {
  status: string;
  uptime?: number;
  version?: string;
  rsi?: {
    enabled: boolean;
    phase: string;
    cycleCount: number;
    lastCycleAt?: number;
  };
  memory?: {
    heapUsedMb: number;
    heapTotalMb: number;
  };
}

async function fetchHealth(port: number): Promise<HealthData | null> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return await res.json() as HealthData;
  } catch {
    return null;
  }
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function pm2Status(): string {
  try {
    const out = execSync("pm2 jlist", { stdio: "pipe", encoding: "utf8" });
    const list = JSON.parse(out) as Array<{ name: string; pm2_env: { status: string } }>;
    const proc = list.find(p => p.name === "andromeda-rsi");
    return proc?.pm2_env?.status ?? "not found";
  } catch {
    return "pm2 not available";
  }
}

export function statusCommand(): Command {
  const cmd = new Command("status");
  cmd
    .description("Show the current status of the Andromeda daemon")
    .option("-p, --port <port>", "Port to check", "3000")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const spinner = ora({ text: "Fetching status…", color: "cyan" }).start();
      const port = parseInt(opts.port, 10);
      const health = await fetchHealth(port);
      const pm2 = pm2Status();
      spinner.stop();

      if (opts.json) {
        console.log(JSON.stringify({ health, pm2 }, null, 2));
        return;
      }

      console.log(printBanner());

      if (!health) {
        const box = boxen(
          chalk.red.bold("  ● OFFLINE\n\n") +
          chalk.dim(`  Port ${port} is not responding.\n`) +
          chalk.dim(`  pm2 status: ${pm2}`),
          {
            title: " Andromeda Status ",
            titleAlignment: "center",
            padding: 1,
            borderStyle: "round",
            borderColor: "red",
          }
        );
        console.log(box);
        printInfo("Run `andromeda start` to launch the daemon.");
        return;
      }

      const rsi = health.rsi;
      const mem = health.memory;
      const rsiStatus = rsi?.enabled
        ? chalk.green(`● Running  (${rsi.phase})`)
        : chalk.yellow("● Paused");

      const lastCycle = rsi?.lastCycleAt
        ? new Date(rsi.lastCycleAt).toLocaleTimeString()
        : "never";

      const lines = [
        chalk.green.bold("  ● ONLINE"),
        "",
        `  ${chalk.bold("Version:")}      ${chalk.cyan(health.version ?? "unknown")}`,
        `  ${chalk.bold("Uptime:")}       ${chalk.cyan(health.uptime ? formatUptime(health.uptime) : "unknown")}`,
        `  ${chalk.bold("pm2:")}          ${chalk.cyan(pm2)}`,
        "",
        `  ${chalk.bold("RSI Daemon:")}   ${rsiStatus}`,
        `  ${chalk.bold("Cycles:")}       ${chalk.cyan(rsi?.cycleCount ?? 0)}`,
        `  ${chalk.bold("Last Cycle:")}   ${chalk.cyan(lastCycle)}`,
        "",
        `  ${chalk.bold("Heap:")}         ${chalk.cyan(mem ? `${mem.heapUsedMb.toFixed(1)} / ${mem.heapTotalMb.toFixed(1)} MB` : "unknown")}`,
        "",
        chalk.dim(`  Dashboard: http://localhost:${port}`),
        chalk.dim(`  RSI Panel: http://localhost:${port}/rsi`),
      ].join("\n");

      const box = boxen(lines, {
        title: " Andromeda Status ",
        titleAlignment: "center",
        padding: 1,
        borderStyle: "round",
        borderColor: "cyan",
      });

      console.log(box);
    });

  return cmd;
}
