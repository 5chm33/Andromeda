/**
 * fileEngine.ts — v6.25 (barrel export)
 *
 * This file is now a thin barrel that re-exports everything from the focused
 * sub-modules created in the v6.25 god-module split:
 *
 *   fileEngineTypes.ts    — Types, config, and semantic compression utilities
 *   fileEngineChunking.ts — Smart chunking + file index builder
 *   fileEngineAnalysis.ts — Multi-pass analysis and edit engine
 *   fileEngineUtils.ts    — Cost budget, retry, context window, scoring
 *
 * All existing import paths (e.g. `import { buildFileIndex } from "./fileEngine"`)
 * continue to work without modification.
 */

export * from "./fileEngineTypes.js";
export * from "./fileEngineChunking.js";
export * from "./fileEngineAnalysis.js";
export * from "./fileEngineUtils.js";
