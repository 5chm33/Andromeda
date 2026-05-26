/**
 * ai.ts — v6.25 (barrel export)
 *
 * This file is now a thin barrel that re-exports everything from the focused
 * sub-modules created in the v6.25 god-module split:
 *
 *   aiTokens.ts    — Token counting and model/provider helpers
 *   aiPrompts.ts   — System prompt builders
 *   aiStreaming.ts — Core SSE streaming engine and public streaming API
 *   aiPlanning.ts  — Agent planning, Claude Code capabilities, todo system
 *
 * All existing import paths (e.g. `import { streamChat } from "./ai"`) continue
 * to work without modification.
 */

export * from "./aiTokens.js";
export * from "./aiPrompts.js";
export * from "./aiStreaming.js";
export * from "./aiPlanning.js";
