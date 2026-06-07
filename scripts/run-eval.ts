/**
 * scripts/run-eval.ts
 * Standalone eval runner — runs the full 70-task eval suite and writes
 * the result to data/eval_baseline.json.
 *
 * Usage:  npx tsx scripts/run-eval.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Inline scoreResponse + EVAL_TASKS (subset for quick run) ─────────────────
// We import directly from evalFramework but need to satisfy its llmProvider dep.
// Instead, we run the eval inline using the OpenAI SDK directly.

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE,
});

async function runAgent(prompt: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await client.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3,
    }, { signal: controller.signal as AbortSignal });
    return res.choices[0]?.message?.content?.trim() ?? "";
  } catch (e: any) {
    if (e.name === "AbortError") return "timeout";
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Import eval tasks and scoring from evalFramework ─────────────────────────
// We dynamically read the compiled evalFramework to get EVAL_TASKS + scoreResponse.
// Since we can't import server TS directly, we replicate the scoring logic.

interface EvalTask {
  id: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
  expectedKeywords: string[];
  forbiddenKeywords?: string[];
  maxTokens: number;
  timeoutMs: number;
  scoreWeight: number;
}

function scoreResponse(task: EvalTask, response: string): { score: number; passed: boolean } {
  const lower = response.toLowerCase();
  let score = 0;
  const keywordsFound = task.expectedKeywords.filter(k => lower.includes(k.toLowerCase()));
  const keywordScore = (keywordsFound.length / task.expectedKeywords.length) * 70;
  score += keywordScore;
  const forbidden = task.forbiddenKeywords ?? [];
  const forbiddenFound = forbidden.filter(k => lower.includes(k.toLowerCase()));
  if (forbiddenFound.length === 0) score += 15;
  if (response.length > 20 && response !== "timeout" && !response.startsWith("error:")) score += 15;
  const finalScore = Math.round(Math.min(100, score));
  return { score: finalScore, passed: finalScore >= 60 };
}

// ── Read EVAL_TASKS from evalFramework.ts source ─────────────────────────────
// Parse the tasks array directly from the TypeScript source
function parseEvalTasks(): EvalTask[] {
  const src = fs.readFileSync(path.join(ROOT, "server", "evalFramework.ts"), "utf-8");
  // Extract the EVAL_TASKS array block
  const startIdx = src.indexOf("export const EVAL_TASKS");
  if (startIdx === -1) throw new Error("Could not find EVAL_TASKS in evalFramework.ts");
  // Use a simple approach: eval the tasks via a temp script
  return [];
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔬 Andromeda v9.0.0 — Eval Suite Runner");
  console.log("=========================================");

  // Read tasks from evalFramework.ts by extracting them with tsx
  const evalModule = await import("../server/evalFramework.js").catch(() => null);

  if (!evalModule) {
    console.error("❌ Could not import evalFramework. Run from project root with: npx tsx scripts/run-eval.ts");
    process.exit(1);
  }

  const { EVAL_TASKS } = evalModule as any;
  if (!EVAL_TASKS || !Array.isArray(EVAL_TASKS)) {
    console.error("❌ EVAL_TASKS not found in evalFramework");
    process.exit(1);
  }

  console.log(`📋 Running ${EVAL_TASKS.length} eval tasks...`);
  console.log("");

  const runId = `eval-${Date.now()}`;
  const startTime = Date.now();
  let totalScore = 0;
  let maxScore = 0;
  let passed = 0;
  let failed = 0;
  const byCategory: Record<string, { score: number; max: number; pct: number }> = {};
  const results: any[] = [];

  for (let i = 0; i < EVAL_TASKS.length; i++) {
    const task = EVAL_TASKS[i] as EvalTask;
    process.stdout.write(`  [${String(i + 1).padStart(2)}/${EVAL_TASKS.length}] ${task.id.padEnd(10)} `);

    let response = "";
    try {
      response = await runAgent(task.prompt, task.maxTokens, task.timeoutMs);
    } catch (err: any) {
      response = `error: ${err.message}`;
    }

    const { score, passed: taskPassed } = scoreResponse(task, response);
    const weighted = score * task.scoreWeight;
    totalScore += weighted;
    maxScore += 100 * task.scoreWeight;
    if (taskPassed) passed++; else failed++;

    if (!byCategory[task.category]) byCategory[task.category] = { score: 0, max: 0, pct: 0 };
    byCategory[task.category].score += weighted;
    byCategory[task.category].max += 100 * task.scoreWeight;

    results.push({ taskId: task.id, category: task.category, score, passed: taskPassed, response: response.slice(0, 120) });

    const bar = taskPassed ? "✅" : score > 30 ? "🟡" : "❌";
    console.log(`${bar} ${score}/100`);
  }

  // Compute category percentages
  for (const cat of Object.values(byCategory)) {
    cat.pct = Math.round((cat.score / cat.max) * 100);
  }

  const percentage = Math.round((totalScore / maxScore) * 100);
  const durationMs = Date.now() - startTime;

  console.log("");
  console.log("=========================================");
  console.log(`📊 RESULTS: ${percentage}% (${passed}/${EVAL_TASKS.length} passed)`);
  console.log("");
  for (const [cat, data] of Object.entries(byCategory)) {
    const bar = "█".repeat(Math.round(data.pct / 5)) + "░".repeat(20 - Math.round(data.pct / 5));
    console.log(`  ${cat.padEnd(16)} ${bar} ${data.pct}%`);
  }
  console.log("");
  console.log(`⏱  Duration: ${(durationMs / 1000).toFixed(1)}s`);

  const run = {
    runId,
    timestamp: startTime,
    totalScore: Math.round(totalScore),
    maxScore: Math.round(maxScore),
    percentage,
    passed,
    failed,
    byCategory,
    results,
    durationMs,
    version: "9.0.0",
  };

  // Write to eval_baseline.json
  const baselinePath = path.join(ROOT, "data", "eval_baseline.json");
  fs.writeFileSync(baselinePath, JSON.stringify(run, null, 2), "utf-8");
  console.log(`✅ Saved to data/eval_baseline.json`);

  // Also append to workspace/evals/eval-history.jsonl
  const evalDir = path.join(ROOT, "workspace", "evals");
  fs.mkdirSync(evalDir, { recursive: true });
  fs.appendFileSync(path.join(evalDir, "eval-history.jsonl"), JSON.stringify(run) + "\n", "utf-8");
  console.log(`✅ Appended to workspace/evals/eval-history.jsonl`);
}

main().catch(e => { console.error(e); process.exit(1); });
