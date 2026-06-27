/**
 * cli/commands/logs.ts — v1.0.0
 * `andromeda logs` — streams live logs from the daemon with color coding.
 */
import { Command } from "commander";
import { spawn, execSync } from "child_process";
import { resolve } from "path";
import chalk from "chalk";
import { printBanner, printInfo, printError } from "../ui/banner.js";

const ROOT = resolve(import.meta.dirname, "../..");

const LOG_COLORS: Record<string, (s: string) => string> = {
  ERROR: chalk.red,
  WARN:  chalk.yellow,
  INFO:  chalk.cyan,
  DEBUG: chalk.dim,
  RSI:   chalk.magenta,
  CYCLE: chalk.green,
};

function colorize(line: string): string {
  for (const [key, fn] of Object.entries(LOG_COLORS)) {
    if (line.includes(`[${key}]`) || line.toUpperCase().includes(key)) {
      return fn(line);
    }
  }
  return line;
}

export function logsCommand(): Command {
  const cmd = new Command("logs");
  cmd
    .description("Stream live logs from the Andromeda daemon")
    .option("-n, --lines <n>", "Number of past lines to show", "50")
    .option("-f, --filter <term>", "Filter lines containing this term")
    .option("--rsi", "Show only RSI-related log lines")
    .option("--errors", "Show only error lines")
    .action((opts) => {
      console.log(printBanner());
      printInfo("Streaming logs… (Ctrl+C to stop)");
      console.log(chalk.dim("─".repeat(60)));
      console.log("");

      const filter = opts.rsi ? "RSI" : opts.errors ? "ERROR" : opts.filter;

      // Try pm2 logs first
      try {
        execSync("pm2 --version", { stdio: "pipe" });
        const args = ["logs", "andromeda-rsi", "--lines", opts.lines, "--raw"];
        const child = spawn("pm2", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });

        const processLine = (line: string) => {
          if (filter && !line.toLowerCase().includes(filter.toLowerCase())) return;
          console.log(colorize(line.trim()));
        };

        child.stdout?.on("data", (d) => String(d).split("\n").forEach(processLine));
        child.stderr?.on("data", (d) => String(d).split("\n").forEach(processLine));
        child.on("exit", () => process.exit(0));
        return;
      } catch {
        // pm2 not available — fall back to server log file
      }

      // Fallback: tail the log file
      const logFile = resolve(ROOT, "data/andromeda.log");
      try {
        const args = ["-n", opts.lines, "-f", logFile];
        const child = spawn("tail", args, { stdio: ["ignore", "pipe", "pipe"] });

        const processLine = (line: string) => {
          if (filter && !line.toLowerCase().includes(filter.toLowerCase())) return;
          console.log(colorize(line.trim()));
        };

        child.stdout?.on("data", (d) => String(d).split("\n").forEach(processLine));
        child.on("exit", () => process.exit(0));
      } catch {
        printError("Could not stream logs — is Andromeda running?");
        printInfo("Start the daemon with `andromeda start`");
        process.exit(1);
      }
    });

  return cmd;
}
