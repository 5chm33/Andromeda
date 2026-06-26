/**
 * toolSynthesizer.ts — v20.0.0
 * 
 * Self-Writing Agent Skills.
 * Allows Andromeda to detect capability gaps and autonomously generate, 
 * test, and deploy new tools (TypeScript wrappers around CLI/APIs).
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { getApiKey, getApiUrl, getProviderHeaders } from "./aiTokens.js";

export interface ToolSynthesisResult {
  success: boolean;
  toolName: string;
  errorMessage?: string;
}

/**
 * Autonomously writes and deploys a new tool based on a detected capability gap.
 */
export async function synthesizeNewTool(
  capabilityGap: string,
  workspaceDir: string
): Promise<ToolSynthesisResult> {
  const toolsDir = path.join(workspaceDir, "server", "tools");
  if (!fs.existsSync(toolsDir)) {
    fs.mkdirSync(toolsDir, { recursive: true });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, toolName: "", errorMessage: "No API key configured for tool synthesis." };
  }

  const prompt = `
    You are Andromeda's Tool Synthesizer.
    A capability gap has been detected: "${capabilityGap}"
    
    Write a self-contained TypeScript module that exports a single function to solve this gap.
    The module should use standard Node.js libraries (fs, child_process, https) where possible.
    
    Respond strictly with a JSON object:
    {
      "toolName": "camelCaseName",
      "code": "import * as fs from 'fs';\\n\\nexport async function camelCaseName() { ... }"
    }
  `;

  try {
    const response = await fetch(`${getApiUrl()}/chat/completions`, {
      method: "POST",
      headers: getProviderHeaders(),
      body: JSON.stringify({
        model: "gpt-4o", // Needs high reasoning capability
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
      }),
      signal: AbortSignal.timeout(120000)
    });

    if (!response.ok) throw new Error(`VLM API failed: ${response.statusText}`);
    
    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content;
    
    if (content) {
      try {
        const parsed = JSON.parse(content);
        if (parsed.toolName && parsed.code) {
          const toolPath = path.join(toolsDir, `${parsed.toolName}.ts`);
          fs.writeFileSync(toolPath, parsed.code);
          
          // Verify it compiles
          try {
            execSync(`npx tsc --noEmit ${toolPath}`, { cwd: workspaceDir, stdio: "pipe" });
            return { success: true, toolName: parsed.toolName };
          } catch (tscError: any) {
            fs.unlinkSync(toolPath); // Rollback
            return { success: false, toolName: parsed.toolName, errorMessage: `Compilation failed: ${tscError.message}` };
          }
        }
      } catch {
        return { success: false, toolName: "", errorMessage: "Failed to parse LLM JSON response." };
      }
    }
  } catch (e: any) {
    return { success: false, toolName: "", errorMessage: e.message };
  }

  return { success: false, toolName: "", errorMessage: "Unknown error during synthesis." };
}
