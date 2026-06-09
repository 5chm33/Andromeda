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
    testTimeout: 10000,
    hookTimeout: 10000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
  },
});
