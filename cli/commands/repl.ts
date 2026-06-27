/**
 * cli/commands/repl.ts — v2.0.0
 * `andromeda repl` — interactive REPL for querying the live Andromeda agent.
 * Streams responses in real time from the /api/chat endpoint.
 */
import { Command } from "commander";
import * as readline from "readline";
import chalk from "chalk";
import ora from "ora";
import { printBanner, printInfo, printError, printDim } from "../ui/banner.js";

const COMMANDS: Record<string, string> = {
  ".help":    "Show this help message",
  ".status":  "Show daemon status",
  ".cycles":  "Show recent RSI cycles",
  ".clear":   "Clear the screen",
  ".exit":    "Exit the REPL",
};

async function streamChat(port: number, message: string): Promise<void> {
  const spinner = ora({ text: "Thinking…", color: "cyan" }).start();
  try {
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, stream: true }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      spinner.fail(`Server returned ${res.status}`);
      return;
    }

    spinner.stop();
    process.stdout.write(chalk.bold.cyan("\n  Andromeda: "));

    if (res.headers.get("content-type")?.includes("text/event-stream")) {
      // SSE streaming
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data) as { content?: string; delta?: string };
              const text = parsed.content ?? parsed.delta ?? "";
              process.stdout.write(text);
            } catch {
              process.stdout.write(data);
            }
          }
        }
      }
    } else {
      // Non-streaming fallback
      const data = await res.json() as { response?: string; message?: string; content?: string };
      const text = data.response ?? data.message ?? data.content ?? JSON.stringify(data);
      process.stdout.write(text);
    }

    process.stdout.write("\n\n");
  } catch (e) {
    spinner.fail(`Request failed: ${e instanceof Error ? e.message : String(e)}`);
    printError("Is Andromeda running? Start with `andromeda start`");
  }
}

async function showStatus(port: number): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json() as {
      version?: string;
      rsi?: { enabled: boolean; phase: string; cycleCount: number };
      memory?: { heapUsedMb: number };
    };
    console.log(chalk.cyan("  Status:"), data.rsi?.enabled ? chalk.green("● Running") : chalk.yellow("● Paused"));
    console.log(chalk.cyan("  Version:"), chalk.white(data.version ?? "unknown"));
    console.log(chalk.cyan("  Cycles:"), chalk.white(String(data.rsi?.cycleCount ?? 0)));
    console.log(chalk.cyan("  Heap:"), chalk.white(`${data.memory?.heapUsedMb?.toFixed(1) ?? "?"}MB`));
    console.log("");
  } catch {
    printError("Could not reach daemon");
  }
}

async function showCycles(port: number): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${port}/api/rsi/cycles?limit=5`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json() as { cycles?: Array<{ id: string; phase: string; proposalsApplied: number; completedAt?: number }> };
    const cycles = data.cycles ?? [];
    if (cycles.length === 0) {
      printDim("No cycles yet.");
      return;
    }
    for (const c of cycles) {
      const status = c.completedAt ? chalk.green("✓") : chalk.yellow("…");
      console.log(`  ${status} ${chalk.cyan(c.phase.padEnd(25))} +${c.proposalsApplied} applied`);
    }
    console.log("");
  } catch {
    printError("Could not fetch cycles");
  }
}

export function replCommand(): Command {
  const cmd = new Command("repl");
  cmd
    .description("Start an interactive REPL session with the Andromeda agent")
    .option("-p, --port <port>", "Port to connect to", "3000")
    .action(async (opts) => {
      const port = parseInt(opts.port, 10);
      console.log(printBanner());
      printInfo(`Connecting to Andromeda on port ${port}…`);
      printDim("Type .help for commands, .exit to quit");
      console.log("");

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.bold.magenta("  ⬡ ") + chalk.bold("you") + chalk.dim(" › "),
        terminal: true,
      });

      rl.prompt();

      rl.on("line", async (line) => {
        const input = line.trim();
        if (!input) { rl.prompt(); return; }

        // Built-in REPL commands
        if (input === ".exit" || input === ".quit") {
          console.log(chalk.dim("\n  Goodbye.\n"));
          rl.close();
          process.exit(0);
        }

        if (input === ".help") {
          console.log("");
          for (const [cmd, desc] of Object.entries(COMMANDS)) {
            console.log(`  ${chalk.cyan(cmd.padEnd(12))} ${chalk.dim(desc)}`);
          }
          console.log("");
          rl.prompt();
          return;
        }

        if (input === ".status") {
          await showStatus(port);
          rl.prompt();
          return;
        }

        if (input === ".cycles") {
          await showCycles(port);
          rl.prompt();
          return;
        }

        if (input === ".clear") {
          console.clear();
          rl.prompt();
          return;
        }

        // Send to agent
        await streamChat(port, input);
        rl.prompt();
      });

      rl.on("close", () => {
        console.log(chalk.dim("\n  Session ended.\n"));
        process.exit(0);
      });
    });

  return cmd;
}
