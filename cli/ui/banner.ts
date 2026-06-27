/**
 * cli/ui/banner.ts — v1.0.0
 * Branded ASCII banner with gradient coloring.
 */
import figlet from "figlet";
import gradient from "gradient-string";
import chalk from "chalk";

const ANDROMEDA_GRADIENT = gradient(["#7c3aed", "#2563eb", "#0ea5e9"]);

export function printBanner(): string {
  const ascii = figlet.textSync("ANDROMEDA", {
    font: "Big",
    horizontalLayout: "default",
  });

  const banner = [
    "",
    ANDROMEDA_GRADIENT(ascii),
    chalk.dim("  ─────────────────────────────────────────────────────────"),
    chalk.bold("  ") + chalk.hex("#7c3aed").bold("Recursive Self-Improving AI Agent") +
      chalk.dim("  v101.0.0"),
    chalk.dim("  ─────────────────────────────────────────────────────────"),
    "",
  ].join("\n");

  return banner;
}

export function printSuccess(msg: string): void {
  console.log(chalk.green("  ✓ ") + msg);
}

export function printError(msg: string): void {
  console.error(chalk.red("  ✗ ") + msg);
}

export function printWarning(msg: string): void {
  console.warn(chalk.yellow("  ⚠ ") + msg);
}

export function printInfo(msg: string): void {
  console.log(chalk.blue("  ℹ ") + msg);
}

export function printDim(msg: string): void {
  console.log(chalk.dim("    " + msg));
}
