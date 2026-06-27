/**
 * cli/commands/bench.ts — v2.0.0
 * `andromeda bench` — runs the RSI benchmark suite and reports results.
 */
import { Command } from "commander";
import { execSync } from "child_process";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { printBanner, printSuccess, printError, printInfo, printDim } from "../ui/banner.js";

const ROOT = resolve(import.meta.dirname, "../..");

interface BenchResult {
  suite: string;
  passed: number;
  failed: number;
  duration: number;
  score?: number;
}

function runBenchSuite(name: string, cmd: string): BenchResult {
  const start = Date.now();
  try {
    const out = execSync(cmd, { cwd: ROOT, stdio: "pipe", encoding: "utf8", timeout: 120000 });
    const duration = Date.now() - start;
    // Parse vitest output for pass/fail counts
    const passMatch = out.match(/(\d+)\s+passed/);
    const failMatch = out.match(/(\d+)\s+failed/);
    const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
    const total = passed + failed;
    const score = total > 0 ? passed / total : 1;
    return { suite: name, passed, failed, duration, score };
  } catch (e) {
    const duration = Date.now() - start;
    const errOut = String(e);
    const passMatch = errOut.match(/(\d+)\s+passed/);
    const failMatch = errOut.match(/(\d+)\s+failed/);
    const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failed = failMatch ? parseInt(failMatch[1], 10) : 1;
    return { suite: name, passed, failed, duration, score: passed / (passed + failed) };
  }
}

export function benchCommand(): Command {
  const cmd = new Command("bench");
  cmd
    .description("Run the Andromeda benchmark suite")
    .option("--quick", "Run only the fast unit test suite")
    .option("--full", "Run all suites including integration tests")
    .option("--json", "Output results as JSON")
    .action(async (opts) => {
      if (!opts.json) {
        console.log(printBanner());
        console.log(chalk.bold("  Running Andromeda Benchmark Suite\n"));
      }

      const suites: Array<{ name: string; cmd: string; skip?: boolean }> = [
        {
          name: "Unit Tests (server)",
          cmd: "pnpm run test -- --run --reporter=verbose 2>&1",
        },
        {
          name: "Integration Tests",
          cmd: "pnpm run test:integration 2>&1",
          skip: opts.quick,
        },
        {
          name: "Eval Suite",
          cmd: "pnpm run test:eval 2>&1",
          skip: opts.quick,
        },
      ];

      const results: BenchResult[] = [];

      for (const suite of suites) {
        if (suite.skip) {
          if (!opts.json) printDim(`  Skipping: ${suite.name}`);
          continue;
        }

        const spinner = opts.json ? null : ora({ text: `  Running: ${suite.name}…`, color: "cyan" }).start();
        const result = runBenchSuite(suite.name, suite.cmd);
        results.push(result);

        if (spinner) {
          if (result.failed === 0) {
            spinner.succeed(
              chalk.green(`  ${suite.name}`) +
              chalk.dim(` — ${result.passed} passed in ${(result.duration / 1000).toFixed(1)}s`)
            );
          } else {
            spinner.fail(
              chalk.red(`  ${suite.name}`) +
              chalk.dim(` — ${result.passed} passed, ${result.failed} failed`)
            );
          }
        }
      }

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      // Summary
      const totalPassed = results.reduce((s, r) => s + r.passed, 0);
      const totalFailed = results.reduce((s, r) => s + r.failed, 0);
      const totalTime = results.reduce((s, r) => s + r.duration, 0);
      const overallScore = totalPassed / (totalPassed + totalFailed);

      console.log("");
      console.log(chalk.dim("  " + "─".repeat(50)));
      console.log(
        `  ${chalk.bold("Total:")} ${chalk.green(`${totalPassed} passed`)}  ` +
        (totalFailed > 0 ? chalk.red(`${totalFailed} failed`) + "  " : "") +
        chalk.dim(`${(totalTime / 1000).toFixed(1)}s`)
      );
      console.log(
        `  ${chalk.bold("Score:")} ${overallScore >= 0.99 ? chalk.green("A+") : overallScore >= 0.95 ? chalk.green("A") : overallScore >= 0.9 ? chalk.yellow("B") : chalk.red("C")} ` +
        chalk.dim(`(${(overallScore * 100).toFixed(1)}%)`)
      );
      console.log("");

      if (totalFailed === 0) {
        printSuccess("All benchmarks passed! System is healthy.");
      } else {
        printError(`${totalFailed} test(s) failed. Run \`pnpm run test\` for details.`);
        process.exit(1);
      }
    });

  return cmd;
}
