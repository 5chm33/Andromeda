import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["server/_core/index.ts", "server/andromedaDaemon.ts"],
  platform: "node",
  packages: "external",
  bundle: true,
  format: "esm",
  outdir: "dist",
  // v5.47: Provide a real require() via createRequire so any remaining
  // require() calls work correctly instead of throwing "Dynamic require is not supported"
  banner: {
    js: `import { createRequire as __createRequire } from "module";\nconst require = __createRequire(import.meta.url);`,
  },
  plugins: [{
    name: "exclude-test-files",
    setup(build) {
      // Return empty module for any .test.ts file
      build.onLoad({ filter: /\.test\.ts$/ }, () => ({
        contents: "export default {};",
        loader: "ts",
      }));
      // Mark vitest as external
      build.onResolve({ filter: /^vitest$/ }, () => ({
        external: true,
      }));
    },
  }],
});
