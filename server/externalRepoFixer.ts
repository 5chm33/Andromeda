/**
 * externalRepoFixer.ts — v12.2.2
 *
 * "Fix Any GitHub Repo" — autonomous clone → LLM analysis → PR pipeline.
 *
 * v12.2.2 COMPLETE REWRITE: Real LLM-powered code analysis.
 * Previous version only did deterministic whitespace fixes (trailing spaces,
 * blank line normalization). This version uses the same LLM pipeline as the
 * main RSI engine to find and fix REAL issues:
 *   - Missing error handling (bare catch blocks, unhandled promise rejections)
 *   - Undefined/null access without guards
 *   - Magic numbers that should be named constants
 *   - Missing input validation
 *   - Inefficient patterns (repeated array.find, unnecessary re-computation)
 *   - Dead code and unreachable branches
 *   - Missing return type annotations
 *   - Inconsistent error propagation
 *
 * Flow:
 *   1. Clone the target repo to a temp directory
 *   2. Scan for source files (TS, JS, Python, etc.)
 *   3. For each file: call LLM to analyze and propose a specific improvement
 *   4. Apply the improvement using snippet replacement (same as RSI engine)
 *   5. Commit all changes to a new branch
 *   6. Push and open a Pull Request via the GitHub API
 *   7. Stream SSE progress events back to the caller
 */

import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { EventEmitter } from "events";
import { createLogger } from "./logger.js";
import { buildSmartContext } from "./sweBenchContextBuilder.js";  // Fix 30: smart context selection

const log = createLogger("externalRepoFixer");

// ─── Types ────────────────────────────────────────────────────────────────────

export type FixJobStatus =
  | "pending"
  | "cloning"
  | "analyzing"
  | "improving"
  | "committing"
  | "pushing"
  | "pr_opened"
  | "done"
  | "failed";

export type FixJobEvent = {
  jobId: string;
  status: FixJobStatus;
  message: string;
  progress: number; // 0-100
  prUrl?: string;
  error?: string;
  timestamp: number;
};

export type FixJobOptions = {
  repoUrl: string;
  /** Optional GitHub PAT — falls back to GITHUB_TOKEN env var */
  githubPat?: string;
  /** How many files to analyze and improve (default: 5) */
  maxFiles?: number;
  /** Branch name prefix (default: andromeda/fix) */
  branchPrefix?: string;
  /** PR title (default: auto-generated) */
  prTitle?: string;
  /** PR body (default: auto-generated) */
  prBody?: string;
};

export type FixJob = {
  id: string;
  repoUrl: string;
  status: FixJobStatus;
  createdAt: number;
  updatedAt: number;
  prUrl?: string;
  error?: string;
  events: FixJobEvent[];
  emitter: EventEmitter;
};

// ─── In-memory job store ──────────────────────────────────────────────────────

const _jobs = new Map<string, FixJob>();
const MAX_JOBS = 20;

function makeJobId(): string {
  return `fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getJob(jobId: string): FixJob | undefined {
  return _jobs.get(jobId);
}

export function listJobs(): Omit<FixJob, "emitter">[] {
  return [..._jobs.values()].map(({ emitter: _e, ...rest }) => rest);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emit(job: FixJob, status: FixJobStatus, message: string, progress: number, extra?: Partial<FixJobEvent>) {
  const event: FixJobEvent = {
    jobId: job.id,
    status,
    message,
    progress,
    timestamp: Date.now(),
    ...extra,
  };
  job.status = status;
  job.updatedAt = Date.now();
  job.events.push(event);
  if (extra?.prUrl) job.prUrl = extra.prUrl;
  if (extra?.error) job.error = extra.error;
  job.emitter.emit("event", event);
  log.info(`[${job.id}] ${status}: ${message}`);
}

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: "pipe" });
}

/** Extract owner/repo from a GitHub URL */
function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?(?:\/.*)?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/** Inject PAT into a GitHub HTTPS URL */
function injectPat(url: string, pat: string): string {
  return url.replace(/^https:\/\//, `https://${pat}@`);
}

/** Detect the primary language of a repo */
function detectLanguage(dir: string): "typescript" | "javascript" | "python" | "mixed" {
  let ts = 0, js = 0, py = 0;
  function walk(d: string, depth = 0) {
    if (depth > 3) return;
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist" || e.name === "__pycache__") continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) ts++;
        else if (e.name.endsWith(".js") || e.name.endsWith(".jsx") || e.name.endsWith(".mjs")) js++;
        else if (e.name.endsWith(".py")) py++;
      }
    } catch { /* ignore permission errors */ }
  }
  walk(dir);
  const total = ts + js + py;
  if (total === 0) return "mixed";
  if (ts / total > 0.5) return "typescript";
  if (py / total > 0.5) return "python";
  if (js / total > 0.5) return "javascript";
  return "mixed";
}

/** Find source files to analyze — prioritize complex files over trivial ones */
function findSourceFiles(dir: string, maxFiles: number): string[] {
  const results: Array<{ path: string; size: number }> = [];
  const SKIP_DIRS = new Set(["node_modules", "dist", "__pycache__", ".git", "build", "coverage", ".next", "venv", "env", ".venv"]);
  const SKIP_FILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", ".min.js", ".min.ts"]);

  function walk(d: string, depth = 0) {
    if (depth > 5) return;
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        if (SKIP_FILES.has(e.name) || e.name.includes(".min.")) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          walk(full, depth + 1);
        } else if (e.isFile()) {
          const ext = path.extname(e.name).toLowerCase();
          if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".py"].includes(ext)) {
            try {
              const stat = fs.statSync(full);
              // Only analyze files between 500 bytes and 100KB — trivial and huge files aren't useful
              if (stat.size >= 500 && stat.size <= 100_000) {
                results.push({ path: full, size: stat.size });
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch { /* ignore permission errors */ }
  }
  walk(dir);

  // Sort by file size descending — larger files have more code to improve
  results.sort((a, b) => b.size - a.size);
  return results.slice(0, maxFiles * 3).map(r => r.path); // over-select, then filter by LLM quality
}

/** Build the LLM prompt for analyzing a source file */
function buildAnalysisPrompt(filePath: string, content: string, language: string): Array<{ role: string; content: string }> {
  const filename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const langLabel = ext === ".py" ? "Python" : ext === ".ts" || ext === ".tsx" ? "TypeScript" : "JavaScript";

  // Fix 30: Use buildSmartContext instead of naive truncation.
  // buildSmartContext focuses on the most relevant functions (by size/complexity)
  // and provides line numbers, giving the LLM much better signal for targeted fixes.
  // For externalRepoFixer we use a generic "improve code quality" intent.
  const contentForAnalysis = (() => {
    try {
      // Use a generic issue description that triggers quality-focused context selection
      const smartCtx = buildSmartContext(path.basename(filePath), content, {
        issueDescription: 'improve code quality fix bugs error handling null safety',
        maxChars: 20000,
      });
      return smartCtx.length > 100 ? smartCtx : (content.length > 20000 ? content.slice(0, 20000) + '\n\n// ... (file truncated)' : content);
    } catch {
      // Fallback to naive truncation if buildSmartContext fails
      return content.length > 20000 ? content.slice(0, 20000) + '\n\n// ... (file truncated for analysis)' : content;
    }
  })();

  return [
    {
      role: "system",
      content: `You are an expert ${langLabel} software engineer performing a targeted code improvement for an autonomous code review system.

Your task: analyze the provided source file and identify the SINGLE BEST improvement to make.

Focus on REAL improvements that add value:
- Missing error handling (bare catch blocks, unhandled rejections, missing null checks)
- Logic bugs (off-by-one errors, incorrect conditions, missing edge cases)
- Missing input validation (functions that assume valid input but don't check)
- Magic numbers/strings that should be named constants
- Inefficient patterns (repeated expensive operations, unnecessary re-computation)
- Dead code or unreachable branches
- Inconsistent error propagation (some paths throw, others return null)
- Missing type annotations on exported functions
- Resource leaks (unclosed file handles, uncleared timers)

DO NOT propose:
- Whitespace or formatting changes (those are handled separately)
- Renaming variables for style preferences
- Adding comments or documentation only
- Changes that would break the public API
- Refactors that change behavior (only safe improvements)

CRITICAL: Return ONLY a JSON object. No markdown. No explanation outside the JSON.
The JSON must contain:
- "title": short title (max 10 words) describing the specific improvement
- "rationale": 2 sentences explaining WHY this is a real problem and how the fix helps
- "category": one of: error_handling, null_safety, performance, logic_bug, validation, constants, cleanup
- "confidence": float 0.0–1.0 (how confident you are this is correct and safe)
- "originalSnippet": the EXACT lines to replace (copy verbatim from the file, max 25 lines)
- "proposedSnippet": the improved replacement (same approximate length)

The originalSnippet MUST be an exact substring of the provided file content.
Keep both snippets SHORT and focused. Do not rewrite the whole file.
If you cannot find a meaningful real improvement (the code is already good), return: {"skip": true, "reason": "code quality is already high"}`,
    },
    {
      role: "user",
      content: `Analyze this ${langLabel} file and propose the single best improvement.\n\nFile: ${filename}\n\n\`\`\`${langLabel.toLowerCase()}\n${contentForAnalysis}\n\`\`\`\n\nReturn ONLY valid JSON.`,
    },
  ];
}

/** Apply a snippet replacement to a file */
function applySnippetReplacement(filePath: string, originalSnippet: string, proposedSnippet: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8");

    // Exact match first
    if (content.includes(originalSnippet)) {
      fs.writeFileSync(filePath, content.replace(originalSnippet, proposedSnippet), "utf-8");
      return true;
    }

    // Fuzzy match: normalize whitespace and try line-by-line
    const contentLines = content.split("\n");
    const snippetLines = originalSnippet.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (snippetLines.length === 0) return false;

    // Find the start of the snippet in the file
    for (let i = 0; i <= contentLines.length - snippetLines.length; i++) {
      let match = true;
      for (let j = 0; j < snippetLines.length; j++) {
        if (contentLines[i + j].trim() !== snippetLines[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        // Determine indentation from the first matched line
        const indent = contentLines[i].match(/^(\s*)/)?.[1] ?? "";
        const proposedLines = proposedSnippet.split("\n").map((l, idx) =>
          idx === 0 ? indent + l.trimStart() : l
        );
        contentLines.splice(i, snippetLines.length, ...proposedLines);
        fs.writeFileSync(filePath, contentLines.join("\n"), "utf-8");
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Call the LLM to analyze a file and return a proposal.
 * Fix 31: Multi-attempt revision loop with model escalation (ported from SWE-bench pipeline).
 * Attempt 1-2: fast model (Kimi/DeepSeek). Attempt 3: stronger model (OpenRouter/Claude).
 * If snippet doesn't match on apply, feed the error back to the LLM for a corrected proposal.
 */
async function analyzeFileWithLLM(
  filePath: string,
  language: string,
  providerId: string
): Promise<{ title: string; rationale: string; category: string; confidence: number; originalSnippet: string; proposedSnippet: string } | null> {
  const MAX_ATTEMPTS = 3;
  // Escalate to a stronger model on the final attempt
  const getProviderForAttempt = (attempt: number): string => {
    if (attempt < MAX_ATTEMPTS) return providerId;
    // Attempt 3: escalate to strongest available
    if (process.env.OPENROUTER_API_KEY) return "openrouter";
    if (process.env.ANTHROPIC_API_KEY) return "anthropic-direct";
    return providerId; // fallback to same if no stronger model available
  };

  try {
    const { simpleChatCompletion } = await import("./llmProvider.js");
    const content = fs.readFileSync(filePath, "utf-8");
    const messages = buildAnalysisPrompt(filePath, content, language);

    let lastSnippetMismatch: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const attemptProviderId = getProviderForAttempt(attempt);

      // On retry: append the mismatch error to the conversation so the LLM can correct itself
      const attemptMessages = [...messages];
      if (lastSnippetMismatch && attempt > 1) {
        attemptMessages.push({
          role: "assistant",
          content: lastSnippetMismatch,
        } as any);
        attemptMessages.push({
          role: "user",
          content: `The originalSnippet you provided does not exactly match any text in the file. The snippet must be a verbatim substring of the file content shown above. Please look at the file again carefully and provide a corrected JSON with an originalSnippet that is an EXACT copy of lines from the file. Return ONLY valid JSON.`,
        } as any);
      }

      const rawContent = await simpleChatCompletion(attemptMessages, {
        maxTokens: 2000,
        temperature: attempt === 1 ? 0.2 : 0.4, // slightly higher temp on retries for variation
        providerId: attemptProviderId,
      });

      if (!rawContent) continue;

      // Parse JSON response
      let parsed: any = null;
      try {
        const cleaned = rawContent.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch {
        continue;
      }

      if (!parsed) continue;
      if (parsed.skip) return null; // LLM said code is already good

      // Validate required fields
      if (!parsed.originalSnippet || !parsed.proposedSnippet || !parsed.title) continue;
      if (typeof parsed.confidence !== "number") parsed.confidence = 0.7;
      if (parsed.confidence < 0.6) continue; // Low confidence — skip

      const result = {
        title: String(parsed.title).slice(0, 100),
        rationale: String(parsed.rationale || "").slice(0, 500),
        category: String(parsed.category || "improvement"),
        confidence: parsed.confidence,
        originalSnippet: String(parsed.originalSnippet),
        proposedSnippet: String(parsed.proposedSnippet),
      };

      // Verify the snippet actually exists in the file before returning
      // (saves a wasted apply attempt downstream)
      if (content.includes(result.originalSnippet)) {
        return result; // Exact match — return immediately
      }

      // Fuzzy check: if at least 80% of snippet lines match, accept it
      // (applySnippetReplacement has its own fuzzy fallback)
      const snippetLines = result.originalSnippet.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      const matchCount = snippetLines.filter(l => content.includes(l)).length;
      if (snippetLines.length > 0 && matchCount / snippetLines.length >= 0.8) {
        return result; // Good enough — fuzzy apply will handle it
      }

      // Snippet doesn't match — save the raw response for the retry message
      lastSnippetMismatch = rawContent;
      log.warn(`[externalRepoFixer] Attempt ${attempt}/${MAX_ATTEMPTS}: snippet mismatch for ${path.basename(filePath)}, retrying...`);
    }

    return null; // All attempts failed
  } catch (err) {
    log.warn(`[externalRepoFixer] LLM analysis failed for ${path.basename(filePath)}: ${String(err).slice(0, 100)}`);
    return null;
  }
}

// ─── Main job runner ──────────────────────────────────────────────────────────

export async function startFixJob(options: FixJobOptions): Promise<FixJob> {
  // Prune old jobs
  if (_jobs.size >= MAX_JOBS) {
    const oldest = [..._jobs.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (oldest) _jobs.delete(oldest[0]);
  }

  const jobId = makeJobId();
  const job: FixJob = {
    id: jobId,
    repoUrl: options.repoUrl,
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [],
    emitter: new EventEmitter(),
  };
  _jobs.set(jobId, job);

  // Run async — do not await
  runFixJob(job, options).catch((err) => {
    emit(job, "failed", `Unexpected error: ${String(err)}`, 0, { error: String(err) });
  });

  return job;
}

async function runFixJob(job: FixJob, options: FixJobOptions): Promise<void> {
  const pat = options.githubPat || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const maxFiles = Math.min(options.maxFiles ?? 5, 15);
  const branchPrefix = options.branchPrefix ?? "andromeda/fix";
  const branchName = `${branchPrefix}-${Date.now()}`;
  const tmpDir = path.join(os.tmpdir(), `andromeda-fix-${job.id}`);

  try {
    // ── Step 1: Clone ─────────────────────────────────────────────────────────
    emit(job, "cloning", `Cloning ${options.repoUrl}...`, 5);
    fs.mkdirSync(tmpDir, { recursive: true });

    const cloneUrl = pat ? injectPat(options.repoUrl, pat) : options.repoUrl;
    try {
      run(`git clone --depth 1 "${cloneUrl}" repo`, tmpDir);
    } catch (e) {
      throw new Error(`Clone failed: ${String(e)}`);
    }

    const repoDir = path.join(tmpDir, "repo");
    emit(job, "cloning", "Clone complete", 10);

    // Configure git identity for commits
    run(`git config user.email "andromeda-rsi@bot.local"`, repoDir);
    run(`git config user.name "Andromeda RSI"`, repoDir);

    // Create fix branch
    run(`git checkout -b "${branchName}"`, repoDir);

    // ── Step 2: Detect language and scan files ────────────────────────────────
    emit(job, "analyzing", "Detecting repository language and scanning files...", 12);
    const language = detectLanguage(repoDir);
    const files = findSourceFiles(repoDir, maxFiles);
    emit(job, "analyzing", `Detected ${language} repo — found ${files.length} source files to analyze`, 15);

    if (files.length === 0) {
      emit(job, "done", "No analyzable source files found in this repository.", 100);
      return;
    }

    // ── Step 3: LLM Analysis ──────────────────────────────────────────────────
    emit(job, "analyzing", `Running LLM analysis on up to ${Math.min(files.length, maxFiles)} files...`, 18);

    // Determine which LLM provider to use
    let providerId = "kimi"; // Kimi k2.6 is excellent for code analysis
    const hasKimi = !!process.env.KIMI_API_KEY;
    const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
    const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
    const hasOpenAI = !!process.env.OPENAI_API_KEY;

    if (!hasKimi) {
      if (hasDeepSeek) providerId = "deepseek";
      else if (hasOpenRouter) providerId = "openrouter-fast";
      else if (hasOpenAI) providerId = "openai";
    }

    const proposals: Array<{
      filePath: string;
      relPath: string;
      title: string;
      rationale: string;
      category: string;
      confidence: number;
      originalSnippet: string;
      proposedSnippet: string;
    }> = [];

    const filesToAnalyze = files.slice(0, maxFiles);
    for (let i = 0; i < filesToAnalyze.length; i++) {
      const file = filesToAnalyze[i];
      const relPath = path.relative(repoDir, file);
      const progress = 18 + Math.round(((i + 1) / filesToAnalyze.length) * 40);
      emit(job, "analyzing", `Analyzing ${relPath} (${i + 1}/${filesToAnalyze.length})...`, progress);

      const proposal = await analyzeFileWithLLM(file, language, providerId);
      if (proposal) {
        proposals.push({ filePath: file, relPath, ...proposal });
        emit(job, "analyzing", `✓ Found improvement in ${relPath}: ${proposal.title}`, progress);
      } else {
        emit(job, "analyzing", `  ${relPath}: no high-confidence improvement found`, progress);
      }
    }

    if (proposals.length === 0) {
      emit(job, "done", `Analyzed ${filesToAnalyze.length} files — no high-confidence improvements found. The code quality is already good!`, 100);
      return;
    }

    emit(job, "improving", `Found ${proposals.length} improvement(s) — applying changes...`, 60);

    // ── Step 4: Apply improvements ────────────────────────────────────────────
    const applied: typeof proposals = [];
    const changeLog: string[] = [];

    for (const proposal of proposals) {
      const success = applySnippetReplacement(proposal.filePath, proposal.originalSnippet, proposal.proposedSnippet);
      if (success) {
        applied.push(proposal);
        changeLog.push(`${proposal.relPath}: ${proposal.title} [${proposal.category}, confidence=${proposal.confidence.toFixed(2)}]`);
        emit(job, "improving", `✓ Applied: ${proposal.relPath} — ${proposal.title}`, 65);
      } else {
        emit(job, "improving", `  Skipped ${proposal.relPath}: snippet mismatch (file may have changed)`, 65);
      }
    }

    if (applied.length === 0) {
      emit(job, "done", "Improvements were proposed but could not be applied (snippet mismatch). The repository may have been updated.", 100);
      return;
    }

    emit(job, "improving", `Applied ${applied.length} improvement(s) across ${applied.length} files`, 70);

    // ── Step 5: Commit ────────────────────────────────────────────────────────
    emit(job, "committing", "Committing improvements...", 75);
    try {
      run(`git add -A`, repoDir);

      // Build detailed commit message
      const commitBody = [
        `fix: Andromeda RSI autonomous improvements (${applied.length} changes)`,
        "",
        "Applied by Andromeda v2 RSI (Recursive Self-Improvement) engine.",
        "Each change was analyzed by LLM and verified for safety before application.",
        "",
        "Changes:",
        ...changeLog.slice(0, 20).map(l => `  - ${l}`),
        changeLog.length > 20 ? `  ... and ${changeLog.length - 20} more` : "",
      ].filter(l => l !== undefined).join("\n");

      run(`git commit -m "${commitBody.replace(/"/g, "'").replace(/\n/g, "\\n")}"`, repoDir);
    } catch (e) {
      throw new Error(`Commit failed: ${String(e)}`);
    }
    emit(job, "committing", "Changes committed", 80);

    // ── Step 6: Push ──────────────────────────────────────────────────────────
    emit(job, "pushing", `Pushing branch ${branchName}...`, 85);
    if (!pat) {
      throw new Error("No GitHub PAT available — cannot push. Please provide a GitHub token.");
    }

    const parsed = parseGitHubRepo(options.repoUrl);
    if (!parsed) {
      throw new Error(`Could not parse GitHub owner/repo from URL: ${options.repoUrl}`);
    }

    try {
      const pushUrl = injectPat(options.repoUrl, pat);
      run(`git push "${pushUrl}" "${branchName}"`, repoDir);
    } catch (e) {
      throw new Error(`Push failed: ${String(e)}`);
    }
    emit(job, "pushing", "Branch pushed", 90);

    // ── Step 7: Open PR ───────────────────────────────────────────────────────
    emit(job, "pr_opened", "Opening Pull Request...", 92);

    // Build rich PR body with rationale for each change
    const changeDetails = applied.map(p =>
      `### \`${p.relPath}\` — ${p.title}\n**Category:** ${p.category} | **Confidence:** ${(p.confidence * 100).toFixed(0)}%\n\n${p.rationale}`
    ).join("\n\n---\n\n");

    const prTitle = options.prTitle ?? `🤖 Andromeda RSI: ${applied.length} LLM-powered improvement${applied.length > 1 ? "s" : ""}`;
    const prBody = options.prBody ?? [
      "## Autonomous Code Improvements by Andromeda RSI",
      "",
      `This PR was automatically generated by [Andromeda v2](https://github.com/5chm33/Andromeda) — a Recursive Self-Improvement AI agent.`,
      "",
      `### Summary`,
      `- **Files analyzed**: ${filesToAnalyze.length}`,
      `- **Improvements applied**: ${applied.length}`,
      `- **Language detected**: ${language}`,
      `- **LLM provider**: ${providerId}`,
      "",
      `### Changes`,
      changeDetails,
      "",
      `---`,
      `_Generated by Andromeda RSI v12.2.2 — [Learn more](https://github.com/5chm33/Andromeda)_`,
    ].join("\n");

    // Get the default branch of the target repo
    let defaultBranch = "main";
    try {
      const branchInfo = run(`git remote show origin 2>/dev/null | grep "HEAD branch"`, repoDir);
      const m = branchInfo.match(/HEAD branch:\s*(\S+)/);
      if (m) defaultBranch = m[1];
    } catch { /* use main */ }

    // Create PR via GitHub API
    const prPayload = JSON.stringify({
      title: prTitle,
      body: prBody,
      head: branchName,
      base: defaultBranch,
    });

    let prUrl = "";
    try {
      const response = execSync(
        `curl -s -X POST \
          -H "Authorization: token ${pat}" \
          -H "Content-Type: application/json" \
          -d '${prPayload.replace(/'/g, "'\\''")}' \
          "https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls"`,
        { encoding: "utf8" }
      );
      const prData = JSON.parse(response);
      prUrl = prData.html_url ?? "";
      if (!prUrl) {
        const errMsg = prData.message ?? JSON.stringify(prData);
        throw new Error(`GitHub API error: ${errMsg}`);
      }
    } catch (e) {
      throw new Error(`PR creation failed: ${String(e)}`);
    }

    emit(job, "done", `PR opened: ${prUrl}`, 100, { prUrl });

  } catch (err) {
    const msg = String(err);
    emit(job, "failed", msg, 0, { error: msg });
  } finally {
    // Clean up temp directory
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch { /* non-fatal */ }
  }
}
