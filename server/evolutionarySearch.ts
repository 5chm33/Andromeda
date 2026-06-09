/**
 * evolutionarySearch.ts — Phase 4b/5b: Algorithmic Self-Discovery
 * Andromeda v9.16.2
 *
 * Implements an evolutionary search algorithm (genetic programming) over the
 * RSI engine itself. Andromeda writes variations of its core logic, benchmarks
 * them against the eval suite, and keeps the fittest mutations.
 */
import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";
import { chatCompletion, getProviderForTier } from "./llmProvider.js";
import { runBenchmarks } from "./benchmarkRunner.js";

const log = createLogger("evolutionarySearch");

export interface MutationResult {
  generation: number;
  targetFile: string;
  originalScore: number;
  newScore: number;
  success: boolean;
  diff: string;
}

/**
 * Runs a single generation of evolutionary search on a target file.
 * Typically targets core RSI files like selfImprove.ts or evalFramework.ts.
 */
export async function runEvolutionaryGeneration(targetFile: string, generation: number): Promise<MutationResult> {
  const filePath = path.resolve(process.cwd(), "server", targetFile);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Target file not found: ${filePath}`);
  }

  log.info(`[Evolution] Generation ${generation}: Targeting ${targetFile}`);
  
  // 1. Measure baseline fitness
  const baseline = await runBenchmarks();
  const baselineScore = baseline.overallScore;
  log.info(`[Evolution] Baseline fitness: ${baselineScore}/100`);

  // 2. Read source code
  const sourceCode = fs.readFileSync(filePath, "utf8");

  // 3. Generate mutation (Pro tier - Claude 3.5 Sonnet)
  const proProvider = getProviderForTier("pro");
  const prompt = `
You are an evolutionary meta-programming engine. Your goal is to optimize the following TypeScript file to improve its performance on the Andromeda benchmark suite.

TARGET FILE: ${targetFile}
CURRENT FITNESS: ${baselineScore}/100

Analyze the code and identify ONE specific algorithmic bottleneck, heuristic flaw, or missing optimization. 
Rewrite the entire file with your proposed mutation. 
Do not break existing exports or signatures.

Respond EXACTLY with the new raw TypeScript code. Do not include markdown formatting like \`\`\`typescript.
`;

  const result = await chatCompletion(
    [{ role: "user", content: prompt }],
    { 
      providerId: proProvider, 
      maxTokens: 8000, 
      temperature: 0.7, // Higher temp for exploration/mutation
      toolChoice: "none"
    }
  );

  let mutatedCode = result.content || "";
  // Strip markdown if the LLM ignored instructions
  if (mutatedCode.startsWith("```")) {
    mutatedCode = mutatedCode.replace(/```typescript\n?|```\n?/g, "");
  }

  if (!mutatedCode || mutatedCode.length < sourceCode.length * 0.5) {
    log.warn(`[Evolution] Mutation failed: LLM returned invalid or truncated code.`);
    return { generation, targetFile, originalScore: baselineScore, newScore: baselineScore, success: false, diff: "Truncated output" };
  }

  // 4. Apply mutation
  fs.writeFileSync(filePath, mutatedCode, "utf8");
  log.info(`[Evolution] Mutation applied. Running fitness evaluation...`);

  // 5. Evaluate fitness
  let newScore = 0;
  let success = false;
  try {
    const newBenchmark = await runBenchmarks();
    newScore = newBenchmark.overallScore;
    log.info(`[Evolution] New fitness: ${newScore}/100`);

    if (newScore > baselineScore) {
      log.info(`[Evolution] 🧬 SUCCESS! Mutation improved fitness by +${newScore - baselineScore}`);
      success = true;
    } else {
      log.info(`[Evolution] 💀 FAILURE. Mutation decreased or maintained fitness (${newScore - baselineScore}). Rolling back.`);
      fs.writeFileSync(filePath, sourceCode, "utf8"); // Rollback
    }
  } catch (err) {
    log.warn(`[Evolution] 💀 FATAL ERROR during evaluation. Rolling back. ${(err as Error).message}`);
    fs.writeFileSync(filePath, sourceCode, "utf8"); // Rollback
  }

  return {
    generation,
    targetFile,
    originalScore: baselineScore,
    newScore,
    success,
    diff: success ? "Code improved" : "Rolled back"
  };
}
