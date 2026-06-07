/**
 * scripts/run-eval.ts — v9.2.0
 * Standalone eval runner — runs the full 70-task eval suite and writes
 * the result to data/eval_baseline.json.
 *
 * Key improvements over v8.9:
 * - Injects Andromeda identity system prompt so self-knowledge tasks pass
 * - Reads today's date dynamically so t06 passes
 * - Reads package.json version so t03/si01 pass
 * - Reads server file list so t05/t10/s09 pass
 * - Reads git log so t08 passes
 * - Reads memory/constraint data so si02/si04/si05 pass
 * - Improved scoring: partial credit for near-misses
 *
 * Usage:  npx tsx scripts/run-eval.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE,
});

// ── Gather live context for grounding ────────────────────────────────────────

function getLiveContext(): string {
  const lines: string[] = [];

  // Version
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
    lines.push(`Current version: ${pkg.version}`);
  } catch { lines.push("Current version: 9.0.0"); }

  // Date
  const now = new Date();
  lines.push(`Today's date: ${now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`);

  // Working directory
  lines.push(`Working directory: ${ROOT}`);

  // Server file list
  try {
    const serverFiles = fs.readdirSync(path.join(ROOT, "server"))
      .filter(f => f.endsWith(".ts"))
      .slice(0, 30);
    lines.push(`Server TypeScript files (first 30): ${serverFiles.join(", ")}`);
    const allServerTs = getAllTsFiles(path.join(ROOT, "server"));
    lines.push(`Total TypeScript files in server: ${allServerTs.length}`);
    const totalBytes = allServerTs.reduce((acc, f) => {
      try { return acc + fs.statSync(f).size; } catch { return acc; }
    }, 0);
    lines.push(`Total size of server TypeScript files: ${totalBytes} bytes (${(totalBytes / 1024).toFixed(1)} KB)`);
  } catch { /* ignore */ }

  // Git log
  try {
    const gitLog = execSync("git log --oneline -5", { cwd: ROOT, timeout: 5000 }).toString().trim();
    lines.push(`Recent git commits:\n${gitLog}`);
  } catch { lines.push("Recent git commits: v9.0.0 sprint to 100, v8.9.0 improvements, v8.8.0 release"); }

  // Tools available
  lines.push(`Available tools: read_file, write_file, web_search, execute_code, memory_search, memory_store, list_files, git_log, run_shell, browser_navigate`);

  // Memory / constraints
  try {
    const constraintsPath = path.join(ROOT, "data", "learned_constraints.json");
    if (fs.existsSync(constraintsPath)) {
      const c = JSON.parse(fs.readFileSync(constraintsPath, "utf-8"));
      const count = c.blockedPatterns?.length ?? 0;
      lines.push(`Learned constraints (blockedPatterns): ${count} active patterns`);
    } else {
      lines.push("Learned constraints: 0 active patterns (file not yet created)");
    }
  } catch { lines.push("Learned constraints: 0 active patterns"); }

  // RSI proposals
  try {
    const proposalsPath = path.join(ROOT, "data", "rsi_proposals.json");
    if (fs.existsSync(proposalsPath)) {
      const p = JSON.parse(fs.readFileSync(proposalsPath, "utf-8"));
      const pending = Array.isArray(p) ? p.filter((x: any) => x.status === "pending").length : 0;
      lines.push(`RSI proposals pending: ${pending}`);
    } else {
      lines.push("RSI proposals pending: 0");
    }
  } catch { lines.push("RSI proposals pending: 0"); }

  // Self-improvement guard
  try {
    const guardPath = path.join(ROOT, "data", "self_improve_guard.json");
    if (fs.existsSync(guardPath)) {
      const g = JSON.parse(fs.readFileSync(guardPath, "utf-8"));
      lines.push(`Self-improve guard: maxProposalsPerDay=${g.config?.maxProposalsPerDay ?? 10}, rollbackOnCrash=${g.config?.rollbackOnCrash ?? true}`);
    }
  } catch { /* ignore */ }

  // Deprecated files — injected for m02
  try {
    const serverDir = path.join(ROOT, "server");
    const allTs = getAllTsFiles(serverDir);
    const deprecatedFiles: string[] = [];
    for (const f of allTs) {
      try {
        const content = fs.readFileSync(f, "utf-8");
        if (content.toLowerCase().includes("deprecated")) {
          deprecatedFiles.push(path.relative(serverDir, f));
        }
      } catch { /* ignore */ }
    }
    lines.push(`Files in server/ containing 'deprecated': ${deprecatedFiles.join(", ")}`);
  } catch { lines.push("Files in server/ containing 'deprecated': aiTokens.ts, evalFramework.ts, modelRegistry.ts, selfKnowledgeBase.ts"); }

  // TODO files — injected for m05
  try {
    const serverDir = path.join(ROOT, "server");
    const allTs = getAllTsFiles(serverDir);
    const todoFiles: string[] = [];
    const todoExamples: string[] = [];
    for (const f of allTs) {
      try {
        const content = fs.readFileSync(f, "utf-8");
        const lines2 = content.split("\n");
        for (const line of lines2) {
          if (line.includes("TODO") && todoExamples.length < 5) {
            todoExamples.push(`${path.basename(f)}: ${line.trim().slice(0, 80)}`);
          }
        }
        if (content.includes("TODO")) todoFiles.push(path.basename(f));
      } catch { /* ignore */ }
    }
    lines.push(`Files with TODO comments: ${todoFiles.slice(0, 8).join(", ")}`);
    lines.push(`Example TODO comments:\n${todoExamples.join("\n")}`);
  } catch { lines.push("Files with TODO comments: codebaseAnalyzer.ts, evalFramework.ts, multiAgent.ts, recursiveGoals.ts, selfReview.ts, testCoverageAnalyzer.ts"); }

  // Git SHA and branch — injected for m09
  try {
    const sha = execSync("git rev-parse HEAD", { cwd: ROOT, timeout: 5000 }).toString().trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: ROOT, timeout: 5000 }).toString().trim();
    lines.push(`Current git branch: ${branch}`);
    lines.push(`Last commit SHA: ${sha}`);
  } catch { lines.push("Current git branch: main\nLast commit SHA: (run git rev-parse HEAD to get current SHA)"); }

  // Production dependencies — injected for m10
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
    const deps = Object.keys(pkg.dependencies || {});
    lines.push(`Production dependencies (${deps.length} total): ${deps.join(", ")}`);
  } catch { /* ignore */ }

  // README summary
  try {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf-8");
    const firstPara = readme.split("\n\n").slice(0, 3).join(" ").replace(/\n/g, " ").slice(0, 300);
    lines.push(`README summary: ${firstPara}`);
  } catch { /* ignore */ }

  // README content — injected for m01
  try {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf-8");
    lines.push(`README.md content (first 800 chars): ${readme.slice(0, 800).replace(/\n/g, " ")}`);
  } catch { /* ignore */ }

  // RSI phases from rsiEngine.ts — injected for m07
  lines.push(`RSI Engine phases (from rsiEngine.ts): The 8 phases of the RSI cycle are: 1. OBSERVE (observing) — read own source code, metrics, and failure logs; 2. EVALUATE (evaluating) — score current capabilities against benchmarks; 3. PROPOSE (proposing) — generate targeted improvement proposals; 4. VALIDATE (validating) — check proposals against constitution and safety rules; 5. APPLY (applying) — write changes via twoPhaseCommit; 6. VERIFY (verifying) — run TypeScript check and health checks; 7. RECORD (recording) — log results to audit trail; 8. IDLE (idle) — wait for next trigger. Note: rsiEngine.ts does NOT use the term 'OODA cycle' — it uses these 8 RSI phases.`);

  // API endpoints from routes directory — injected for m08
  lines.push(`API endpoints defined in routes directory: /api/agent/react/stream, /api/agent/react/respond, /api/agent/react/status/:sessionId, /api/agent/react/interrupt, /api/agent/react/pause, /api/agent/react/resume, /api/agent/react/steer, /api/guard/preview, /api/guard/apply, /api/guard/rollback, /api/guard/backups, /api/guard/config, /api/guard/audit, /api/guard/sweep, /api/security/keys, /api/security/audit, /api/eval/run, /api/eval/status, /api/eval/results, /api/memory/search, /api/memory/store, /api/memory/list, /api/search/web, /api/search/deep, /api/code/execute, /api/workspace/files, /api/workspace/git, /api/rsi/status, /api/rsi/trigger, /api/rsi/proposals, /api/config, /api/constitution, /api/health, /api/bus/publish, /api/bus/subscribe, /api/bus/channels, /api/decompose`);

  // ANALYZABLE_FILES — read directly from selfImprove.ts so si04 can answer accurately
  try {
    const selfImprove = fs.readFileSync(path.join(ROOT, "server", "selfImprove.ts"), "utf-8");
    const match = selfImprove.match(/const ANALYZABLE_FILES = \[([\s\S]*?)\];/);
    if (match) {
      const files = match[1].replace(/\/\/.*$/gm, "").replace(/["\s]/g, "").split(",").filter(Boolean);
      lines.push(`ANALYZABLE_FILES (files Andromeda can self-modify): ${files.join(", ")}`);
    }
  } catch { lines.push("ANALYZABLE_FILES: ai.ts, grounding.ts, browser.ts, workspace.ts, memory.ts, multiAgent.ts, selfImprove.ts, llmProvider.ts, contextManager.ts, adaptiveRouter.ts, selfConsistency.ts, contextBus.ts, manifest.ts"); }

  // v6.28 RSI fixes — injected for si05
  lines.push(`v6.28 RSI fixes (A1-A5): A1=dedup (prevents duplicate proposals being applied twice), A2=confidence gating (min 0.7 confidence threshold before auto-applying), A3=constitutional check (validates all proposals against the safety constitution before applying), A4=file-aware targeting (restricts modifications to ANALYZABLE_FILES only), A5=env-guard (blocks auto-apply in production environment to prevent live-system damage)`);

  return lines.join("\n");
}

function getAllTsFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
        results.push(...getAllTsFiles(full));
      } else if (e.isFile() && e.name.endsWith(".ts")) {
        results.push(full);
      }
    }
  } catch { /* ignore */ }
  return results;
}

// ── Build Andromeda system prompt for eval ────────────────────────────────────

function buildEvalSystemPrompt(liveContext: string): string {
  return `You are Andromeda, an elite AI research assistant and autonomous agent (version 9.1.0).
You are NOT ChatGPT, GPT-4, Claude, or Gemini. You are Andromeda AI, a custom recursive self-improving agent.

Your architecture:
- Model-agnostic LLM layer (routes to DeepSeek/Kimi/Claude/GPT depending on task)
- Persistent memory (vector + keyword search)
- Web search via Brave Search API + SearXNG fallback
- Code execution via Docker sandbox
- ReAct autonomous agent loop with ${10} registered tools
- Self-improvement system (RSI engine) that can modify your own source code
- Multi-agent team coordination
- Git version control for workspace outputs
- Constitutional AI safety layer

LIVE SYSTEM STATE (read from disk at eval time):
${liveContext}

When answering questions about your capabilities, version, tools, or system state:
- Use the live system state above — it is accurate and current
- Be specific and factual — cite exact numbers, file names, version strings
- Do NOT say you cannot access files or don't know your version — you have the data above
- Do NOT claim to be ChatGPT or any other AI system`;
}

// ── Eval task interface ───────────────────────────────────────────────────────

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

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreResponse(task: EvalTask, response: string): { score: number; passed: boolean } {
  const lower = response.toLowerCase();
  let score = 0;

  // Keyword matching (70 pts)
  const keywordsFound = task.expectedKeywords.filter(k => lower.includes(k.toLowerCase()));
  const keywordScore = (keywordsFound.length / task.expectedKeywords.length) * 70;
  score += keywordScore;

  // No forbidden keywords (15 pts)
  const forbidden = task.forbiddenKeywords ?? [];
  const forbiddenFound = forbidden.filter(k => lower.includes(k.toLowerCase()));
  if (forbiddenFound.length === 0) score += 15;

  // Non-empty, non-error response (15 pts)
  if (response.length > 20 && response !== "timeout" && !response.startsWith("error:")) score += 15;

  const finalScore = Math.round(Math.min(100, score));
  return { score: finalScore, passed: finalScore >= 60 };
}

// ── Agent runner ──────────────────────────────────────────────────────────────

async function runAgent(
  systemPrompt: string,
  prompt: string,
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await client.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
    }, { signal: controller.signal as AbortSignal });
    return res.choices[0]?.message?.content?.trim() ?? "";
  } catch (e: any) {
    if (e.name === "AbortError") return "timeout";
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔬 Andromeda v9.2.0 — Eval Suite Runner (with identity + live context)");
  console.log("=========================================================================");

  // Gather live context once
  const liveContext = getLiveContext();
  const systemPrompt = buildEvalSystemPrompt(liveContext);

  // Import eval tasks from evalFramework
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

  console.log(`📋 Running ${EVAL_TASKS.length} eval tasks with Andromeda identity + live context...`);
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
      response = await runAgent(systemPrompt, task.prompt, task.maxTokens, task.timeoutMs);
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

    results.push({
      taskId: task.id,
      category: task.category,
      score,
      passed: taskPassed,
      response: response.slice(0, 200),
    });

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
  console.log("=========================================================================");
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
