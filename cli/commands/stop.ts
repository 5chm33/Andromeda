/**
 * cli/commands/stop.ts — v1.0.0
 * `andromeda stop` — gracefully stops the pm2 daemon.
 */
import { Command } from "commander";
import { execSync } from "child_process";
import { resolve } from "path";
import ora from "ora";
import { printSuccess, printError, printInfo } from "../ui/banner.js";

const ROOT = resolve(import.meta.dirname, "../..");

export function stopCommand(): Command {
  const cmd = new Command("stop");
  cmd
    .description("Stop the Andromeda daemon")
    .option("--kill", "Force kill instead of graceful stop")
    .action((opts) => {
      const action = opts.kill ? "delete" : "stop";
      const label = opts.kill ? "Killing" : "Stopping";
      const spinner = ora({ text: `${label} Andromeda daemon…`, color: "cyan" }).start();

      try {
        execSync(`pm2 ${action} andromeda-rsi`, { cwd: ROOT, stdio: "pipe" });
        spinner.succeed(`Andromeda daemon ${opts.kill ? "killed" : "stopped"}`);
        printSuccess("All processes terminated cleanly.");
      } catch {
        spinner.fail("Could not stop via pm2 — trying direct port kill…");
        try {
          execSync("fuser -k 3000/tcp", { stdio: "pipe" });
          printSuccess("Port 3000 released.");
        } catch {
          printError("No running Andromeda process found.");
          printInfo("Use `andromeda status` to check the current state.");
        }
      }
    });

  return cmd;
}
