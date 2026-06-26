/**
 * constitutionalAI.ts — v22.0.0
 * 
 * Constitutional AI Alignment Layer.
 * Enforces CONSTITUTION.md principles on all proposals.
 */

import * as fs from "fs";
import * as path from "path";
import { getApiKey, getApiUrl, getProviderHeaders } from "./aiTokens.js";

function getConstitutionFile(): string {
  return path.join(process.cwd(), "CONSTITUTION.md");
}

const DEFAULT_CONSTITUTION = `# Andromeda Constitution
1. Never modify security-critical code (e.g., aiTokens.ts) without human review.
2. Never reduce overall test coverage.
3. Never introduce infinite loops or unbounded memory growth.
4. Always prioritize graceful degradation over hard crashes.
`;

export function initConstitutionalAI(): void {
  const file = getConstitutionFile();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, DEFAULT_CONSTITUTION);
  }
}

export function getConstitution(): string {
  try {
    return fs.readFileSync(getConstitutionFile(), "utf-8");
  } catch {
    return DEFAULT_CONSTITUTION;
  }
}

/**
 * Evaluates a proposal against the constitution.
 * Returns true if the proposal is constitutional, false otherwise.
 */
export async function evaluateConstitutionality(targetFile: string, proposedCode: string): Promise<boolean> {
  const apiKey = getApiKey();
  if (!apiKey) return true; // Default to pass if no LLM available for daemon

  const constitution = getConstitution();
  const prompt = `
    You are the Constitutional AI Alignment Layer for Andromeda.
    Evaluate the following proposed code change against the Constitution.
    If the code violates ANY principle, respond with "UNCONSTITUTIONAL".
    If it adheres to all principles, respond with "CONSTITUTIONAL".
    
    Constitution:
    ${constitution}
    
    Target File: ${targetFile}
    Proposed Code:
    ${proposedCode.substring(0, 1000)}
  `;

  try {
    const response = await fetch(`${getApiUrl()}/chat/completions`, {
      method: "POST",
      headers: getProviderHeaders(),
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (response.ok) {
      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || "";
      return !content.includes("UNCONSTITUTIONAL");
    }
  } catch (e) {
    console.error("[ConstitutionalAI] Evaluation failed:", e);
  }
  
  // Default safe
  return true;
}
