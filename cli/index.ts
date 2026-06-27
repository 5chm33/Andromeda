#!/usr/bin/env node
/**
 * Andromeda CLI — cli/index.ts
 * v2.0.0 — Full command suite
 *
 * Commands:
 *   start      — Start the daemon
 *   stop       — Stop the daemon
 *   status     — Show daemon status
 *   logs       — Stream live logs
 *   doctor     — Run diagnostics
 *   dashboard  — Live terminal dashboard (Ink)
 *   repl       — Interactive agent REPL
 *   bench      — Run benchmark suite
 *   config     — Configuration wizard
 */
import { Command } from "commander";
import { printBanner } from "./ui/banner.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { logsCommand } from "./commands/logs.js";
import { doctorCommand } from "./commands/doctor.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { replCommand } from "./commands/repl.js";
import { benchCommand } from "./commands/bench.js";
import { configCommand } from "./commands/config.js";

const program = new Command();

program
  .name("andromeda")
  .description("The Recursive Self-Improving AI Agent — CLI v2.0.0")
  .version("101.0.0", "-v, --version", "Print the current version")
  .addHelpText("beforeAll", printBanner());

program.addCommand(startCommand());
program.addCommand(stopCommand());
program.addCommand(statusCommand());
program.addCommand(logsCommand());
program.addCommand(doctorCommand());
program.addCommand(dashboardCommand());
program.addCommand(replCommand());
program.addCommand(benchCommand());
program.addCommand(configCommand());

// Show help if no command given
if (process.argv.length <= 2) {
  printBanner();
  program.help();
}

program.parseAsync(process.argv).catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
