/**
 * benchmarkSynthesizer.ts — v22.0.0
 * 
 * Self-Synthesizing Evaluation Benchmarks.
 * Generates novel coding challenges targeting specific weaknesses identified by UCD.
 */

import * as fs from "fs";
import * as path from "path";
import { getApiKey, getApiUrl, getProviderHeaders } from "./aiTokens.js";

export interface SyntheticBenchmark {
  id: string;
  targetWeakness: string;
  testCode: string;
  passed: boolean;
}

function getBenchmarkDir(): string {
  return path.join(process.cwd(), "synthetic_benchmarks");
}

export function initBenchmarkSynthesizer(): void {
  const dir = getBenchmarkDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Uses the LLM to generate a novel benchmark test case targeting a specific weakness.
 */
export async function synthesizeBenchmark(weakness: string): Promise<SyntheticBenchmark | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null; // Cannot synthesize without LLM

  const prompt = `
    You are an expert software tester.
    The Andromeda RSI engine has identified a weakness in: "${weakness}".
    Generate a novel, extremely difficult TypeScript test case (using Vitest syntax)
    that specifically tests this capability.
    
    The test must be self-contained and executable.
    Output ONLY the raw TypeScript code. No markdown formatting.
  `;

  try {
    const response = await fetch(`${getApiUrl()}/chat/completions`, {
      method: "POST",
      headers: getProviderHeaders(),
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(45000)
    });

    if (response.ok) {
      const data = await response.json() as any;
      let content = data.choices?.[0]?.message?.content || "";
      content = content.replace(/```typescript/g, "").replace(/```ts/g, "").replace(/```/g, "").trim();
      
      const id = `bench_${Date.now()}`;
      const filePath = path.join(getBenchmarkDir(), `${id}.test.ts`);
      fs.writeFileSync(filePath, content);
      
      return {
        id,
        targetWeakness: weakness,
        testCode: content,
        passed: false // Initially false until evaluated
      };
    }
  } catch (e) {
    console.error("[BenchmarkSynthesizer] Failed to synthesize:", e);
  }
  
  return null;
}
