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
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
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
