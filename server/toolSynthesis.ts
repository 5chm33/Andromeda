/**
 * toolSynthesis.ts — v6.35
 *
 * RSI Tool Synthesis: allows the self-improvement engine to propose and register
 * entirely new tool implementations, not just edits to existing files.
 *
 * Synthesized tools are:
 *  - Written to server/tools/synthesized/{name}.ts
 *  - Compiled via the TypeScript compiler API
 *  - Registered in the live tool registry at runtime
 *  - Persisted in .data/synthesized_tools.json so they survive restarts
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { backgroundSimpleCompletion } from "./llmProvider.js";
import { registerTool } from "./tools/toolRegistry.js";
import type { RegisteredTool } from "./tools/toolRegistry.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SynthesizedTool {
  name: string;
  description: string;
  category: string;
  sourceFile: string;
  registeredAt: number;
  proposalId?: string;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

function getSynthesizedDir(): string {
  // Walk up from __dirname to find project root
  let cur = path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(cur, "package.json");
    if (fs.existsSync(pkg)) return path.join(cur, "server", "tools", "synthesized");
    cur = path.dirname(cur);
  }
  return path.join(process.cwd(), "server", "tools", "synthesized");
}

function getRegistryPath(): string {
  let cur = path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(cur, "package.json");
    if (fs.existsSync(pkg)) return path.join(cur, ".data", "synthesized_tools.json");
    cur = path.dirname(cur);
  }
  return path.join(process.cwd(), ".data", "synthesized_tools.json");
}

function loadRegistry(): SynthesizedTool[] {
  try {
    const p = getRegistryPath();
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, "utf8")) as SynthesizedTool[];
  } catch { return []; }
}

function saveRegistry(tools: SynthesizedTool[]): void {
  const p = getRegistryPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(tools, null, 2));
}

// ─── Synthesis ────────────────────────────────────────────────────────────────

/**
 * Generate a new tool implementation using the LLM.
 * Returns the TypeScript source code for the tool.
 */
export async function generateToolSource(
  toolName: string,
  toolDescription: string,
  parameterSchema: string,
  exampleUsage?: string,
): Promise<string> {
  const systemPrompt = `You are an expert TypeScript developer building tool plugins for an AI agent system.
Generate a complete, working TypeScript module that exports a single ToolDefinition object.

The module MUST follow this exact structure:
\`\`\`typescript
import type { ToolDefinition } from "../toolRegistry.js";

export const toolDefinition: ToolDefinition = {
  name: "tool_name",
  description: "...",
  category: "...", // one of: code, search, browser, filesystem, analysis, system, sandbox, vision, agent
  safetyLevel: "low" | "medium" | "high",
  parameters: {
    type: "object",
    properties: { /* JSON Schema */ },
    required: [/* required param names */],
  },
  execute: async (args: any) => {
    // implementation
    return { /* result */ };
  },
};
\`\`\`

Rules:
- Use only Node.js built-ins and packages already in package.json (fs, path, fetch, etc.)
- NO external imports that aren't already available
- Handle errors gracefully — always return an object, never throw
- Keep execute() under 50 lines
- Return ONLY the TypeScript source code, no markdown, no explanation`;

  const userPrompt = `Create a tool named "${toolName}" that: ${toolDescription}

Parameters: ${parameterSchema}
${exampleUsage ? `\nExample usage: ${exampleUsage}` : ""}

Return ONLY the TypeScript source code.`;

  const source = await backgroundSimpleCompletion(systemPrompt, userPrompt);
  // Strip markdown fences if present
  return source.replace(/^```typescript\s*/i, "").replace(/^```ts\s*/i, "").replace(/```\s*$/i, "").trim();
}

/**
 * Validate that the TypeScript source compiles without errors.
 */
export function validateToolSource(source: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  try {
    const result = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        strict: false,
        noEmit: true,
      },
      reportDiagnostics: true,
    });
    if (result.diagnostics && result.diagnostics.length > 0) {
      for (const d of result.diagnostics) {
        errors.push(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
      }
    }
  } catch (err) {
    errors.push(String(err));
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Write a synthesized tool to disk and register it in the live registry.
 */
export async function synthesizeTool(
  toolName: string,
  toolDescription: string,
  parameterSchema: string,
  proposalId?: string,
): Promise<{ success: boolean; error?: string; tool?: SynthesizedTool }> {
  try {
    // 1. Generate source
    const source = await generateToolSource(toolName, toolDescription, parameterSchema);

    // 2. Validate TypeScript
    const validation = validateToolSource(source);
    if (!validation.valid) {
      return {
        success: false,
        error: `TypeScript validation failed: ${validation.errors.join("; ")}`,
      };
    }

    // 3. Write to disk
    const synthDir = getSynthesizedDir();
    fs.mkdirSync(synthDir, { recursive: true });
    const sourceFile = path.join(synthDir, `${toolName}.ts`);
    fs.writeFileSync(sourceFile, source, "utf8");

    // 4. Transpile to JS for runtime loading
    const jsSource = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText;
    const jsFile = path.join(synthDir, `${toolName}.js`);
    fs.writeFileSync(jsFile, jsSource, "utf8");

    // 5. Dynamic import and register
    const mod = await import(`file://${jsFile}?t=${Date.now()}`);
    const toolDef = mod.toolDefinition;
    if (!toolDef || typeof toolDef.execute !== "function") {
      return { success: false, error: "Module did not export a valid toolDefinition" };
    }

    const registered: RegisteredTool = {
      name: toolDef.name,
      description: toolDef.description,
      category: toolDef.category ?? "agent",
      safetyLevel: toolDef.safetyLevel ?? "medium",
      definition: toolDef,
    };
    registerTool(registered);

    // 6. Persist to registry
    const registry = loadRegistry();
    const entry: SynthesizedTool = {
      name: toolDef.name,
      description: toolDef.description,
      category: toolDef.category ?? "agent",
      sourceFile,
      registeredAt: Date.now(),
      proposalId,
    };
    // Replace if already exists
    const idx = registry.findIndex(t => t.name === toolDef.name);
    if (idx >= 0) registry[idx] = entry; else registry.push(entry);
    saveRegistry(registry);

    console.log(`[ToolSynthesis] Synthesized and registered new tool: "${toolDef.name}"`);
    return { success: true, tool: entry };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Re-load all previously synthesized tools on startup.
 */
export async function loadSynthesizedTools(): Promise<void> {
  const registry = loadRegistry();
  if (registry.length === 0) return;
  const synthDir = getSynthesizedDir();
  let loaded = 0;
  for (const entry of registry) {
    try {
      const jsFile = path.join(synthDir, `${entry.name}.js`);
      if (!fs.existsSync(jsFile)) continue;
      const mod = await import(`file://${jsFile}?t=${Date.now()}`);
      const toolDef = mod.toolDefinition;
      if (!toolDef || typeof toolDef.execute !== "function") continue;
      const registered: RegisteredTool = {
        name: toolDef.name,
        description: toolDef.description,
        category: toolDef.category ?? "agent",
        safetyLevel: toolDef.safetyLevel ?? "medium",
        definition: toolDef,
      };
      registerTool(registered);
      loaded++;
    } catch (err) {
      console.warn(`[ToolSynthesis] Failed to reload tool "${entry.name}":`, err);
    }
  }
  if (loaded > 0) {
    console.log(`[ToolSynthesis] Reloaded ${loaded} synthesized tool(s) from previous sessions`);
  }
}

/**
 * List all synthesized tools.
 */
export function listSynthesizedTools(): SynthesizedTool[] {
  return loadRegistry();
}

/**
 * Delete a synthesized tool by name.
 */
export function deleteSynthesizedTool(name: string): boolean {
  const registry = loadRegistry();
  const idx = registry.findIndex(t => t.name === name);
  if (idx < 0) return false;
  const entry = registry[idx];
  // Remove files
  try {
    const synthDir = getSynthesizedDir();
    const tsFile = path.join(synthDir, `${name}.ts`);
    const jsFile = path.join(synthDir, `${name}.js`);
    if (fs.existsSync(tsFile)) fs.unlinkSync(tsFile);
    if (fs.existsSync(jsFile)) fs.unlinkSync(jsFile);
  } catch { /* non-fatal */ }
  registry.splice(idx, 1);
  saveRegistry(registry);
  console.log(`[ToolSynthesis] Deleted synthesized tool: "${name}"`);
  return true;
}
