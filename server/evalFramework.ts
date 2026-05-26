/**
 * evalFramework.ts — v6.18
 *
 * Standardized evaluation framework for Andromeda.
 * Defines 50 benchmark tasks across 5 categories with automated scoring.
 * Tracks performance over time to prove RSI actually improves the agent.
 *
 * Categories:
 * 1. Reasoning (10 tasks) — logic, math, deduction
 * 2. Code (10 tasks) — write, debug, explain code
 * 3. Tool Use (10 tasks) — file ops, search, memory
 * 4. Self-Knowledge (10 tasks) — architecture, capabilities, state
 * 5. Multi-Step (10 tasks) — complex tasks requiring planning
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = path.resolve(__dirname, "..", "workspace", "evals");
const RESULTS_FILE = path.join(EVAL_DIR, "eval-history.jsonl");

export interface EvalTask {
  id: string;
  category: "reasoning" | "code" | "tool_use" | "self_knowledge" | "multi_step";
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
  expectedKeywords: string[];  // response must contain these
  forbiddenKeywords: string[]; // response must NOT contain these (hallucination markers)
  maxTokens: number;
  timeoutMs: number;
  scoreWeight: number; // 1-3
}

export interface EvalResult {
  taskId: string;
  timestamp: number;
  passed: boolean;
  score: number; // 0-100
  responseTokens: number;
  durationMs: number;
  response: string;
  matchedKeywords: string[];
  missedKeywords: string[];
  foundForbidden: string[];
  error?: string;
}

export interface EvalRun {
  runId: string;
  timestamp: number;
  totalScore: number;
  maxScore: number;
  percentage: number;
  passed: number;
  failed: number;
  byCategory: Record<string, { score: number; max: number; pct: number }>;
  results: EvalResult[];
  durationMs: number;
}

// ─── 50 Benchmark Tasks ───────────────────────────────────────────────────────
export const EVAL_TASKS: EvalTask[] = [
  // ── Reasoning (10) ──────────────────────────────────────────────────────────
  {
    id: "r01", category: "reasoning", difficulty: "easy",
    prompt: "What is 15% of 240?",
    expectedKeywords: ["36"],
    forbiddenKeywords: ["I cannot", "I don't know"],
    maxTokens: 100, timeoutMs: 10000, scoreWeight: 1,
  },
  {
    id: "r02", category: "reasoning", difficulty: "easy",
    prompt: "If all roses are flowers and some flowers fade quickly, can we conclude that some roses fade quickly?",
    expectedKeywords: ["no", "cannot", "not necessarily"],
    forbiddenKeywords: ["yes, all roses"],
    maxTokens: 200, timeoutMs: 10000, scoreWeight: 1,
  },
  {
    id: "r03", category: "reasoning", difficulty: "medium",
    prompt: "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball. How much does the ball cost?",
    expectedKeywords: ["5 cents", "$0.05", "five cents"],
    forbiddenKeywords: ["10 cents", "$0.10"],
    maxTokens: 200, timeoutMs: 10000, scoreWeight: 2,
  },
  {
    id: "r04", category: "reasoning", difficulty: "medium",
    prompt: "Sort these numbers in ascending order: 7, 2, 9, 1, 5, 3, 8, 4, 6",
    expectedKeywords: ["1, 2, 3, 4, 5, 6, 7, 8, 9"],
    forbiddenKeywords: [],
    maxTokens: 100, timeoutMs: 10000, scoreWeight: 1,
  },
  {
    id: "r05", category: "reasoning", difficulty: "medium",
    prompt: "What comes next in the sequence: 2, 6, 12, 20, 30, ?",
    expectedKeywords: ["42"],
    forbiddenKeywords: [],
    maxTokens: 150, timeoutMs: 10000, scoreWeight: 2,
  },
  {
    id: "r06", category: "reasoning", difficulty: "hard",
    prompt: "Three friends split a restaurant bill. Alice paid 1/3, Bob paid 1/4, Carol paid the rest. If Carol paid $25, what was the total bill?",
    expectedKeywords: ["60", "$60"],
    forbiddenKeywords: [],
    maxTokens: 300, timeoutMs: 15000, scoreWeight: 2,
  },
  {
    id: "r07", category: "reasoning", difficulty: "easy",
    prompt: "Is the following argument valid? Premise 1: All mammals are warm-blooded. Premise 2: Whales are mammals. Conclusion: Whales are warm-blooded.",
    expectedKeywords: ["valid", "yes"],
    forbiddenKeywords: ["invalid", "not valid"],
    maxTokens: 150, timeoutMs: 10000, scoreWeight: 1,
  },
  {
    id: "r08", category: "reasoning", difficulty: "hard",
    prompt: "A train travels from A to B at 60 mph and returns at 40 mph. What is the average speed for the round trip?",
    expectedKeywords: ["48 mph", "48"],
    forbiddenKeywords: ["50 mph", "50"],
    maxTokens: 300, timeoutMs: 15000, scoreWeight: 3,
  },
  {
    id: "r09", category: "reasoning", difficulty: "medium",
    prompt: "What is the next prime number after 23?",
    expectedKeywords: ["29"],
    forbiddenKeywords: ["27", "25"],
    maxTokens: 100, timeoutMs: 10000, scoreWeight: 1,
  },
  {
    id: "r10", category: "reasoning", difficulty: "hard",
    prompt: "In a room of 23 people, what is the approximate probability that at least two share a birthday? Answer with a percentage.",
    expectedKeywords: ["50", "51", "52", "53", "54", "55"],
    forbiddenKeywords: ["1%", "2%", "3%"],
    maxTokens: 200, timeoutMs: 15000, scoreWeight: 3,
  },
  // ── Code (10) ───────────────────────────────────────────────────────────────
  {
    id: "c01", category: "code", difficulty: "easy",
    prompt: "Write a TypeScript function that reverses a string.",
    expectedKeywords: ["function", "return", "split", "reverse", "join"],
    forbiddenKeywords: [],
    maxTokens: 200, timeoutMs: 15000, scoreWeight: 1,
  },
  {
    id: "c02", category: "code", difficulty: "easy",
    prompt: "What does this JavaScript code output? console.log(typeof null)",
    expectedKeywords: ["object"],
    forbiddenKeywords: ["null", "undefined"],
    maxTokens: 100, timeoutMs: 10000, scoreWeight: 1,
  },
  {
    id: "c03", category: "code", difficulty: "medium",
    prompt: "Write a TypeScript function that checks if a string is a palindrome (ignoring case and spaces).",
    expectedKeywords: ["function", "toLowerCase", "replace", "reverse"],
    forbiddenKeywords: [],
    maxTokens: 300, timeoutMs: 15000, scoreWeight: 2,
  },
  {
    id: "c04", category: "code", difficulty: "medium",
    prompt: "What is wrong with this code? async function getData() { const data = await fetch('https://api.example.com/data'); return data.json(); }",
    expectedKeywords: ["await", "json()", "missing await"],
    forbiddenKeywords: [],
    maxTokens: 200, timeoutMs: 10000, scoreWeight: 2,
  },
  {
    id: "c05", category: "code", difficulty: "hard",
    prompt: "Implement a debounce function in TypeScript that delays invoking a function until after wait milliseconds have elapsed since the last invocation.",
    expectedKeywords: ["function", "setTimeout", "clearTimeout", "return"],
    forbiddenKeywords: [],
    maxTokens: 400, timeoutMs: 20000, scoreWeight: 3,
  },
  {
    id: "c06", category: "code", difficulty: "easy",
    prompt: "What is the time complexity of binary search?",
    expectedKeywords: ["O(log n)", "logarithmic"],
    forbiddenKeywords: ["O(n)", "O(n^2)"],
    maxTokens: 100, timeoutMs: 10000, scoreWeight: 1,
  },
  {
    id: "c07", category: "code", difficulty: "medium",
    prompt: "Explain the difference between == and === in JavaScript.",
    expectedKeywords: ["type coercion", "strict", "==="],
    forbiddenKeywords: [],
    maxTokens: 200, timeoutMs: 10000, scoreWeight: 1,
  },
  {
    id: "c08", category: "code", difficulty: "hard",
    prompt: "Write a TypeScript generic function that deep-clones an object (handles nested objects and arrays).",
    expectedKeywords: ["function", "Array.isArray", "typeof", "object", "return"],
    forbiddenKeywords: [],
    maxTokens: 400, timeoutMs: 20000, scoreWeight: 3,
  },
  {
    id: "c09", category: "code", difficulty: "medium",
    prompt: "What is a closure in JavaScript? Give a brief example.",
    expectedKeywords: ["function", "scope", "outer", "inner"],
    forbiddenKeywords: [],
    maxTokens: 300, timeoutMs: 15000, scoreWeight: 2,
  },
  {
    id: "c10", category: "code", difficulty: "hard",
    prompt: "Implement a simple LRU (Least Recently Used) cache in TypeScript with get and set methods.",
    expectedKeywords: ["Map", "class", "get", "set", "capacity"],
    forbiddenKeywords: [],
    maxTokens: 500, timeoutMs: 25000, scoreWeight: 3,
  },
  // ── Tool Use (10) ───────────────────────────────────────────────────────────
  {
    id: "t01", category: "tool_use", difficulty: "easy",
    prompt: "What tools do you have available? List their names.",
    expectedKeywords: ["read_file", "write_file", "web_search"],
    forbiddenKeywords: ["I don't have", "no tools"],
    maxTokens: 400, timeoutMs: 15000, scoreWeight: 1,
  },
  {
    id: "t02", category: "tool_use", difficulty: "easy",
    prompt: "What is your current working directory?",
    expectedKeywords: ["/", "workspace", "andromeda"],
    forbiddenKeywords: ["I don't know", "cannot determine"],
    maxTokens: 100, timeoutMs: 10000, scoreWeight: 1,
  },
  {
    id: "t03", category: "tool_use", difficulty: "medium",
    prompt: "Read the file package.json in your root directory and tell me the version number.",
    expectedKeywords: ["6.17", "6.18", "version"],
    forbiddenKeywords: ["cannot", "don't have access"],
    maxTokens: 200, timeoutMs: 20000, scoreWeight: 2,
  },
  {
    id: "t04", category: "tool_use", difficulty: "medium",
    prompt: "Search your memory for anything related to 'self-improvement' and report what you find.",
    expectedKeywords: ["memory", "found", "result"],
    forbiddenKeywords: [],
    maxTokens: 300, timeoutMs: 20000, scoreWeight: 2,
  },
  {
    id: "t05", category: "tool_use", difficulty: "hard",
    prompt: "List all TypeScript files in the server directory and count how many there are.",
    expectedKeywords: [".ts", "files"],
    forbiddenKeywords: ["cannot", "don't have access"],
    maxTokens: 500, timeoutMs: 30000, scoreWeight: 2,
  },
  {
    id: "t06", category: "tool_use", difficulty: "easy",
    prompt: "What is today's date?",
    expectedKeywords: ["2026", "May", "2025"],
    forbiddenKeywords: ["I don't know the current date"],
    maxTokens: 100, timeoutMs: 10000, scoreWeight: 1,
  },
  {
    id: "t07", category: "tool_use", difficulty: "medium",
    prompt: "Create a file called eval-test.txt in the workspace directory with the content 'eval test passed'.",
    expectedKeywords: ["created", "written", "success"],
    forbiddenKeywords: ["cannot", "error"],
    maxTokens: 200, timeoutMs: 20000, scoreWeight: 2,
  },
  {
    id: "t08", category: "tool_use", difficulty: "hard",
    prompt: "Run a git log command and tell me the last 3 commit messages.",
    expectedKeywords: ["commit", "v6"],
    forbiddenKeywords: [],
    maxTokens: 400, timeoutMs: 30000, scoreWeight: 3,
  },
  {
    id: "t09", category: "tool_use", difficulty: "medium",
    prompt: "Store a memory: 'The evaluation framework was initialized on this run.'",
    expectedKeywords: ["stored", "saved", "memory", "remember"],
    forbiddenKeywords: ["cannot", "error"],
    maxTokens: 200, timeoutMs: 20000, scoreWeight: 2,
  },
  {
    id: "t10", category: "tool_use", difficulty: "hard",
    prompt: "What is the total size in bytes of all TypeScript files in the server directory?",
    expectedKeywords: ["bytes", "KB", "MB"],
    forbiddenKeywords: ["cannot", "don't have access"],
    maxTokens: 300, timeoutMs: 30000, scoreWeight: 3,
  },
  // ── Self-Knowledge (10) ─────────────────────────────────────────────────────
  {
    id: "s01", category: "self_knowledge", difficulty: "easy",
    prompt: "What is your name and current version?",
    expectedKeywords: ["Andromeda", "6."],
    forbiddenKeywords: ["GPT", "Claude", "Gemini"],
    maxTokens: 100, timeoutMs: 10000, scoreWeight: 1,
  },
  {
    id: "s02", category: "self_knowledge", difficulty: "easy",
    prompt: "What LLM provider are you currently using?",
    expectedKeywords: ["DeepSeek", "provider", "model"],
    forbiddenKeywords: [],
    maxTokens: 150, timeoutMs: 10000, scoreWeight: 1,
  },
  {
    id: "s03", category: "self_knowledge", difficulty: "medium",
    prompt: "Describe your self-modification pipeline in 2-3 sentences.",
    expectedKeywords: ["RSI", "self-improve", "backup", "rollback"],
    forbiddenKeywords: ["I cannot modify", "I don't have"],
    maxTokens: 300, timeoutMs: 15000, scoreWeight: 2,
  },
  {
    id: "s04", category: "self_knowledge", difficulty: "medium",
    prompt: "What are your main memory systems?",
    expectedKeywords: ["vector", "memory", "search"],
    forbiddenKeywords: [],
    maxTokens: 300, timeoutMs: 15000, scoreWeight: 2,
  },
  {
    id: "s05", category: "self_knowledge", difficulty: "hard",
    prompt: "What is your current benchmark score and what does it measure?",
    expectedKeywords: ["score", "benchmark", "quality"],
    forbiddenKeywords: [],
    maxTokens: 300, timeoutMs: 20000, scoreWeight: 2,
  },
  {
    id: "s06", category: "self_knowledge", difficulty: "easy",
    prompt: "Can you modify your own source code? How?",
    expectedKeywords: ["yes", "RSI", "self-modify", "propose"],
    forbiddenKeywords: ["cannot", "no I cannot"],
    maxTokens: 200, timeoutMs: 10000, scoreWeight: 1,
  },
  {
    id: "s07", category: "self_knowledge", difficulty: "medium",
    prompt: "What safety mechanisms prevent you from making harmful self-modifications?",
    expectedKeywords: ["constitution", "rollback", "backup", "safety"],
    forbiddenKeywords: [],
    maxTokens: 300, timeoutMs: 15000, scoreWeight: 2,
  },
  {
    id: "s08", category: "self_knowledge", difficulty: "hard",
    prompt: "What are the current active background daemons running in your system?",
    expectedKeywords: ["daemon", "running", "background"],
    forbiddenKeywords: ["I don't know", "cannot determine"],
    maxTokens: 400, timeoutMs: 20000, scoreWeight: 3,
  },
  {
    id: "s09", category: "self_knowledge", difficulty: "medium",
    prompt: "How many modules are in your server directory?",
    expectedKeywords: ["modules", "files", "100", "150", "200"],
    forbiddenKeywords: [],
    maxTokens: 200, timeoutMs: 20000, scoreWeight: 2,
  },
  {
    id: "s10", category: "self_knowledge", difficulty: "hard",
    prompt: "What are the top 3 things the Claude assessment said you need to improve?",
    expectedKeywords: ["test", "coverage", "agent", "reliability"],
    forbiddenKeywords: [],
    maxTokens: 400, timeoutMs: 20000, scoreWeight: 3,
  },
  // ── Multi-Step (10) ─────────────────────────────────────────────────────────
  {
    id: "m01", category: "multi_step", difficulty: "easy",
    prompt: "Read the README.md file and summarize it in one sentence.",
    expectedKeywords: ["Andromeda", "AI", "agent"],
    forbiddenKeywords: ["cannot", "error"],
    maxTokens: 200, timeoutMs: 30000, scoreWeight: 2,
  },
  {
    id: "m02", category: "multi_step", difficulty: "medium",
    prompt: "Find all files in the server directory that contain the word 'deprecated' and list their names.",
    expectedKeywords: [".ts", "found", "file"],
    forbiddenKeywords: [],
    maxTokens: 400, timeoutMs: 30000, scoreWeight: 2,
  },
  {
    id: "m03", category: "multi_step", difficulty: "medium",
    prompt: "What is the most recently modified file in the server directory?",
    expectedKeywords: [".ts", "modified", "recent"],
    forbiddenKeywords: ["cannot", "error"],
    maxTokens: 200, timeoutMs: 30000, scoreWeight: 2,
  },
  {
    id: "m04", category: "multi_step", difficulty: "hard",
    prompt: "Count the total number of lines of TypeScript code in the server directory (excluding blank lines and comments).",
    expectedKeywords: ["lines", "total"],
    forbiddenKeywords: ["cannot", "error"],
    maxTokens: 300, timeoutMs: 60000, scoreWeight: 3,
  },
  {
    id: "m05", category: "multi_step", difficulty: "medium",
    prompt: "Check if there are any TODO comments in the codebase and list up to 5 of them.",
    expectedKeywords: ["TODO", "found"],
    forbiddenKeywords: [],
    maxTokens: 400, timeoutMs: 30000, scoreWeight: 2,
  },
  {
    id: "m06", category: "multi_step", difficulty: "hard",
    prompt: "What is the largest TypeScript file in the server directory by line count?",
    expectedKeywords: [".ts", "lines"],
    forbiddenKeywords: ["cannot"],
    maxTokens: 200, timeoutMs: 30000, scoreWeight: 2,
  },
  {
    id: "m07", category: "multi_step", difficulty: "medium",
    prompt: "Read the rsiEngine.ts file and tell me what the 8 phases of the OODA cycle are.",
    expectedKeywords: ["OBSERVE", "EVALUATE", "PROPOSE", "APPLY"],
    forbiddenKeywords: ["cannot", "error"],
    maxTokens: 400, timeoutMs: 30000, scoreWeight: 2,
  },
  {
    id: "m08", category: "multi_step", difficulty: "hard",
    prompt: "Find all API endpoints defined in the routes directory and list them.",
    expectedKeywords: ["/api/", "GET", "POST"],
    forbiddenKeywords: [],
    maxTokens: 600, timeoutMs: 60000, scoreWeight: 3,
  },
  {
    id: "m09", category: "multi_step", difficulty: "hard",
    prompt: "What is the current git branch and the SHA of the last commit?",
    expectedKeywords: ["main", "commit", "SHA"],
    forbiddenKeywords: ["cannot", "error"],
    maxTokens: 200, timeoutMs: 20000, scoreWeight: 2,
  },
  {
    id: "m10", category: "multi_step", difficulty: "hard",
    prompt: "Read the package.json and list all production dependencies (not devDependencies).",
    expectedKeywords: ["express", "dependencies"],
    forbiddenKeywords: ["cannot", "error"],
    maxTokens: 500, timeoutMs: 30000, scoreWeight: 3,
  },
];

// ─── Scoring ──────────────────────────────────────────────────────────────────
export function scoreResponse(task: EvalTask, response: string, durationMs: number): EvalResult {
  const lowerResponse = response.toLowerCase();
  const matchedKeywords = task.expectedKeywords.filter(kw =>
    lowerResponse.includes(kw.toLowerCase())
  );
  const missedKeywords = task.expectedKeywords.filter(kw =>
    !lowerResponse.includes(kw.toLowerCase())
  );
  const foundForbidden = task.forbiddenKeywords.filter(kw =>
    lowerResponse.includes(kw.toLowerCase())
  );

  const keywordScore = task.expectedKeywords.length > 0
    ? (matchedKeywords.length / task.expectedKeywords.length) * 70
    : 70;
  const forbiddenPenalty = foundForbidden.length * 20;
  const lengthBonus = response.length > 50 ? 10 : 0;
  const speedBonus = durationMs < task.timeoutMs * 0.5 ? 10 : 0;
  const errorPenalty = response.toLowerCase().includes("error:") ? 20 : 0;

  const rawScore = Math.max(0, Math.min(100,
    keywordScore + lengthBonus + speedBonus - forbiddenPenalty - errorPenalty
  ));

  const passed = matchedKeywords.length >= Math.ceil(task.expectedKeywords.length * 0.7)
    && foundForbidden.length === 0
    && !response.toLowerCase().includes("error:");

  return {
    taskId: task.id,
    timestamp: Date.now(),
    passed,
    score: Math.round(rawScore),
    responseTokens: Math.ceil(response.length / 4),
    durationMs,
    response: response.slice(0, 500),
    matchedKeywords,
    missedKeywords,
    foundForbidden,
  };
}

// ─── Run Evaluation ───────────────────────────────────────────────────────────
export async function runEvaluation(
  runAgent: (prompt: string, maxTokens: number, timeoutMs: number) => Promise<string>,
  taskIds?: string[],
): Promise<EvalRun> {
  const runId = `eval-${Date.now()}`;
  const startTime = Date.now();
  const tasks = taskIds
    ? EVAL_TASKS.filter(t => taskIds.includes(t.id))
    : EVAL_TASKS;

  const results: EvalResult[] = [];
  let totalScore = 0;
  let maxScore = 0;

  for (const task of tasks) {
    const taskStart = Date.now();
    let response = "";
    try {
      response = await runAgent(task.prompt, task.maxTokens, task.timeoutMs);
    } catch (err) {
      response = `error: ${String(err)}`;
    }
    const result = scoreResponse(task, response, Date.now() - taskStart);
    results.push(result);
    totalScore += result.score * task.scoreWeight;
    maxScore += 100 * task.scoreWeight;
  }

  // Group by category
  const byCategory: Record<string, { score: number; max: number; pct: number }> = {};
  for (const task of tasks) {
    const result = results.find(r => r.taskId === task.id)!;
    if (!byCategory[task.category]) byCategory[task.category] = { score: 0, max: 0, pct: 0 };
    byCategory[task.category].score += result.score * task.scoreWeight;
    byCategory[task.category].max += 100 * task.scoreWeight;
  }
  for (const cat of Object.values(byCategory)) {
    cat.pct = Math.round((cat.score / cat.max) * 100);
  }

  const run: EvalRun = {
    runId,
    timestamp: startTime,
    totalScore,
    maxScore,
    percentage: Math.round((totalScore / maxScore) * 100),
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    byCategory,
    results,
    durationMs: Date.now() - startTime,
  };

  // Persist to disk
  try {
    fs.mkdirSync(EVAL_DIR, { recursive: true });
    fs.appendFileSync(RESULTS_FILE, JSON.stringify(run) + "\n", "utf-8");
  } catch {}

  return run;
}

// ─── History ──────────────────────────────────────────────────────────────────
export function getEvalHistory(limit = 10): EvalRun[] {
  try {
    if (!fs.existsSync(RESULTS_FILE)) return [];
    const lines = fs.readFileSync(RESULTS_FILE, "utf-8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l) as EvalRun);
  } catch {
    return [];
  }
}

export function getEvalTrend(): Array<{ timestamp: number; percentage: number; passed: number }> {
  return getEvalHistory(20).map(r => ({
    timestamp: r.timestamp,
    percentage: r.percentage,
    passed: r.passed,
  }));
}

// ─── REST API ─────────────────────────────────────────────────────────────────
import type { Express } from "express";

export function registerEvalRoutes(app: Express): void {
  // List all eval tasks
  app.get("/api/eval/tasks", (_req, res) => {
    res.json({
      total: EVAL_TASKS.length,
      categories: [...new Set(EVAL_TASKS.map(t => t.category))],
      tasks: EVAL_TASKS.map(t => ({ id: t.id, category: t.category, difficulty: t.difficulty, prompt: t.prompt.slice(0, 80) + "..." })),
    });
  });

  // Run a full or quick evaluation
  app.post("/api/eval/run", async (req, res) => {
    try {
      const { quick, categories } = req.body ?? {};
      const tasks = quick
        ? EVAL_TASKS.filter(t => t.difficulty === "easy")
        : categories
          ? EVAL_TASKS.filter(t => categories.includes(t.category))
          : EVAL_TASKS;
      const run = await runEvaluation(tasks);
      res.json(run);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Get eval history
  app.get("/api/eval/history", (req, res) => {
    const limit = parseInt(String(req.query.limit ?? "10"), 10);
    res.json(getEvalHistory(limit));
  });

  // Get score trend (for graphing RSI improvement over time)
  app.get("/api/eval/trend", (_req, res) => {
    res.json(getEvalTrend());
  });
}
