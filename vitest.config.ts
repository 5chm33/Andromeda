import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["server/**/*.ts"],
      exclude: [
        "server/**/*.test.ts",
        "server/**/*.spec.ts",
        "server/**/*.d.ts",
        "server/_core/index.ts",
      ],
      // Thresholds reflect current test coverage baseline.
      // These are enforced in CI and should only increase over time.
      // Current baseline (v9.12): lines 26%, branches 58%, functions 30%
      // Set at 5% below actual to allow for minor fluctuation without CI failures.
      thresholds: {
        lines: 20,
        functions: 25,
        branches: 50,
        statements: 20,
      },
    },
    setupFiles: ["./server/vitest.setup.ts"],
    globals: true,
    // v11.0.1: Increased from 10s to 30s to handle tests that shell out to
    // pnpm/npm (e.g. checkForUpdates, scanVulnerabilities) in CI environments
    // where network latency can push individual tests past 10s.
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
  },
});
