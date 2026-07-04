/**
 * run_swebench.ts — Andromeda SWE-bench Runner (v2.2.0)
 *
 * This is the OFFICIAL runner that uses Andromeda's full pipeline:
 *   - Andromeda's LLM provider (Claude Sonnet 4.5 via OpenRouter)
 *   - sweBenchConsensus.ts (4-agent parallel patch generation)
 *   - sweBenchTracebackLoop.ts (iterative test-feedback loop)
 *   - sweBenchPipeline.ts (orchestrator)
 *
 * Phase 1 (localization) is handled here:
 *   - Load SWE-bench dataset from HuggingFace cache (pyarrow)
 *   - Extract exact file content from Docker image (not git clone)
 *   - Use LLM to identify which files need changing
 *   - Generate initial patch candidate
 *
 * Usage:
 *   npx tsx scripts/run_swebench.ts --instances 50 --split test
 *   npx tsx scripts/run_swebench.ts --instance-ids "django__django-11066,astropy__astropy-12907"
 *   npx tsx scripts/run_swebench.ts --resume --output predictions.jsonl
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { readFileSync } from 'fs';

const execAsync = promisify(exec);

// ─── Environment Setup ────────────────────────────────────────────────────────

// Load environment variables from andromeda_env.local
const envFile = '/home/ubuntu/andromeda_env.local';
if (fs.existsSync(envFile)) {
  const env = readFileSync(envFile, 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// ─── Andromeda LLM Provider ───────────────────────────────────────────────────

import { simpleChatCompletion } from '../server/llmProvider.js';
import {
  resolveSWEBenchModelConfig,
  createSWEBenchLLMProvider,
  type SWEBenchModelConfig,
} from '../server/sweBenchModelConfig.js';
import {
  augmentWithSearch,
  type SearchAugmentation,
} from '../server/sweBenchSearchFallback.js';
import { runSOTAPipeline, PipelineConfig } from '../server/sweBenchPipeline.js';
import { pullImageSafely, ensureDiskSpace } from '../server/sweBenchInfra.js';

/**
 * Andromeda's LLM provider for SWE-bench.
 * Routes to Claude Sonnet 4.5 via OpenRouter.
 */
async function andromedaLLM(prompt: string, temperature = 0.0): Promise<string> {
  // Use a 180-second hard timeout to allow for large file responses
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180_000);
  try {
    return await simpleChatCompletion(
      [{ role: 'user', content: prompt }],
      {
        maxTokens: 8192,  // Increased to handle large file outputs
        temperature,
        providerId: 'anthropic',  // → anthropic/claude-sonnet-4-5 via OpenRouter
        signal: controller.signal,
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── SWE-bench Dataset Loading ────────────────────────────────────────────────

interface SWEBenchInstance {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  hints_text: string;
  patch: string;
  test_patch: string;
  FAIL_TO_PASS: string;  // JSON array string
  PASS_TO_PASS: string;  // JSON array string
  environment_setup_commit: string;
  version: string;
}

/**
 * Loads SWE-bench instances from the HuggingFace cache using Python.
 */
async function loadSWEBenchInstances(
  instanceIds?: string[],
  maxInstances?: number,
  split = 'test'
): Promise<SWEBenchInstance[]> {
  const scriptPath = `/tmp/load_swebench_${crypto.randomBytes(4).toString('hex')}.py`;

  const filterClause = instanceIds && instanceIds.length > 0
    ? `instance_ids = ${JSON.stringify(instanceIds)}\ndf = df[df['instance_id'].isin(instance_ids)]`
    : maxInstances
    ? `df = df.head(${maxInstances})`
    : '';

  const script = `
import pyarrow as pa
import pyarrow.ipc as ipc
import json
import glob
import os

# Find the arrow file in HuggingFace cache
cache_dirs = glob.glob(os.path.expanduser(
    '~/.cache/huggingface/datasets/SWE-bench___swe-bench_verified/**/*.arrow'
), recursive=True)

if not cache_dirs:
    # Try alternate path
    cache_dirs = glob.glob(os.path.expanduser(
        '~/.cache/huggingface/datasets/**/*.arrow'
    ), recursive=True)

if not cache_dirs:
    print('ERROR: No arrow files found in HuggingFace cache')
    exit(1)

# Load the first arrow file
arrow_file = cache_dirs[0]
try:
    with open(arrow_file, 'rb') as f:
        reader = ipc.open_stream(f)
        table = reader.read_all()
except:
    try:
        with open(arrow_file, 'rb') as f:
            reader = ipc.open_file(f)
            table = reader.read_all()
    except Exception as e:
        print(f'ERROR: {e}')
        exit(1)

import pandas as pd
df = table.to_pandas()

${filterClause}

records = df.to_dict('records')
print(json.dumps(records))
`;

  fs.writeFileSync(scriptPath, script);
  try {
    const result = await execAsync(`python3 "${scriptPath}" 2>&1`, { maxBuffer: 50 * 1024 * 1024 });
    if (result.stdout.startsWith('ERROR:')) {
      throw new Error(result.stdout);
    }
    return JSON.parse(result.stdout);
  } finally {
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
  }
}

// ─── Docker File Extraction ───────────────────────────────────────────────────

/**
 * Gets the SWE-bench Docker image name for an instance.
 * Pattern: astropy__astropy-12907 → swebench/sweb.eval.x86_64.astropy_1776_astropy-12907:latest
 */
function getDockerImageName(instanceId: string): string {
  // Replace __ with _1776_ to get the versioned image name
  const normalized = instanceId.replace('__', '_1776_').toLowerCase();
  return `swebench/sweb.eval.x86_64.${normalized}:latest`;
}

/**
 * Extracts file content directly from the Docker image.
 * This guarantees exact file content matching (no git clone mismatch).
 */
async function extractFileFromDocker(dockerImage: string, filePath: string): Promise<string | null> {
  try {
    const result = await execAsync(
      `docker run --rm "${dockerImage}" cat "/testbed/${filePath}" 2>/dev/null`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
    return result.stdout;
  } catch {
    return null;
  }
}

/**
 * Lists Python files in the Docker image's testbed directory.
 */
async function listRepoFiles(dockerImage: string): Promise<string[]> {
  try {
    const result = await execAsync(
      `docker run --rm "${dockerImage}" bash -c "cd /testbed && git ls-files '*.py' 2>/dev/null"`,
      { maxBuffer: 5 * 1024 * 1024 }
    );
    return result.stdout.trim().split('\n').filter(f => f.length > 0);
  } catch {
    return [];
  }
}

// ─── Phase 1: Localization ────────────────────────────────────────────────────

/** Skeleton context: maximum chars of fully-expanded function bodies to include. */
const MAX_EXPANDED_CHARS = 20000;

/**
 * Builds a skeleton context view of a Python file for large files.
 *
 * Instead of blindly truncating to the first N chars (which hides the relevant
 * class/function if it appears later in the file), this function:
 *   1. Extracts every class and function signature (the skeleton) — ~5-15 lines per class
 *   2. Fully expands any function/class whose name appears in the issue or test names
 *   3. Returns skeleton + expanded sections, capped at MAX_EXPANDED_CHARS
 *
 * This gives the LLM the full structural map of the file plus the exact code it needs,
 * without wasting tokens on irrelevant function bodies.
 */
function buildSkeletonContext(
  filePath: string,
  content: string,
  keywords: string[]
): string {
  // If the file is small enough, return it as-is
  if (content.length <= 12000) return content;

  const lines = content.split('\n');

  // Step 1: Build the skeleton — collect all class/def signatures
  // A signature is the def/class line plus any decorator lines immediately above it
  const skeletonLines: string[] = [];
  const functionBodies: Map<string, { start: number; end: number; name: string }> = new Map();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect class or function definition
    const defMatch = trimmed.match(/^(class|def)\s+(\w+)/);
    if (defMatch) {
      const name = defMatch[2];
      const bodyStart = i;

      // Find the end of this function/class body by indentation
      const baseIndent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      let j = i + 1;
      while (j < lines.length) {
        const nextTrimmed = lines[j].trim();
        if (nextTrimmed.length === 0) { j++; continue; }
        const nextIndent = lines[j].match(/^(\s*)/)?.[1]?.length ?? 0;
        if (nextIndent <= baseIndent && nextTrimmed.length > 0) break;
        j++;
      }

      functionBodies.set(name, { start: bodyStart, end: j - 1, name });

      // Add signature line to skeleton (with its decorators)
      skeletonLines.push(line);
      // Add the docstring first line if present
      if (i + 1 < lines.length && lines[i + 1].trim().startsWith('"""')) {
        skeletonLines.push(lines[i + 1]);
        if (!lines[i + 1].trim().endsWith('"""')) {
          // Multi-line docstring — add closing line
          let k = i + 2;
          while (k < lines.length && !lines[k].includes('"""')) k++;
          if (k < lines.length) skeletonLines.push(lines[k]);
        }
      }
      skeletonLines.push('    ...');
      i = j;
      continue;
    }

    // Keep top-level imports, constants, and decorator lines in skeleton
    if (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('from ') ||
      trimmed.startsWith('@') ||
      trimmed.startsWith('#') ||
      (trimmed.length > 0 && !trimmed.startsWith(' ') && line.match(/^[A-Z_][A-Z0-9_]*\s*=/)) // constants
    ) {
      skeletonLines.push(line);
    }

    i++;
  }

  // Step 2: Find which functions/classes are relevant to the issue
  const relevantNames = new Set<string>();
  for (const [name] of functionBodies) {
    const nameLower = name.toLowerCase();
    if (keywords.some(kw => nameLower.includes(kw) || kw.includes(nameLower))) {
      relevantNames.add(name);
    }
  }

  // Step 3: Build the output — skeleton + fully expanded relevant sections
  let result = `# File: ${filePath} (${lines.length} lines total — skeleton view)\n`;
  result += `# Fully expanded: ${relevantNames.size > 0 ? [...relevantNames].join(', ') : '(none matched — showing skeleton only)'}\n\n`;

  // Add the skeleton
  result += skeletonLines.join('\n') + '\n\n';

  // Add fully expanded relevant functions
  let expandedChars = result.length;
  for (const name of relevantNames) {
    const body = functionBodies.get(name);
    if (!body) continue;
    const bodyText = lines.slice(body.start, body.end + 1).join('\n');
    if (expandedChars + bodyText.length > MAX_EXPANDED_CHARS) break;
    result += `# === EXPANDED: ${name} ===\n${bodyText}\n\n`;
    expandedChars += bodyText.length;
  }

  // If no relevant functions were found, expand the first 3 functions as fallback
  if (relevantNames.size === 0) {
    let count = 0;
    for (const [name, body] of functionBodies) {
      if (count >= 3) break;
      const bodyText = lines.slice(body.start, body.end + 1).join('\n');
      if (expandedChars + bodyText.length > MAX_EXPANDED_CHARS) break;
      result += `# === EXPANDED: ${name} ===\n${bodyText}\n\n`;
      expandedChars += bodyText.length;
      count++;
    }
  }

  return result;
}

/**
 * Cross-file symbol resolution: given a set of primary files and their content,
 * scans each file for import statements and function calls, then searches the
 * repository for the definitions of those symbols.
 *
 * This ensures that if file A calls function foo() defined in file B, file B is
 * automatically included in the context — even if keyword matching missed it.
 *
 * Returns the expanded file list (primary files + any newly discovered files).
 */
function resolveSymbolDependencies(
  primaryFiles: string[],
  fileContents: Record<string, string>,
  allFiles: string[]
): string[] {
  const discovered = new Set<string>(primaryFiles);

  for (const [fp, content] of Object.entries(fileContents)) {
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Pattern 1: from .module import Symbol  OR  from package.module import Symbol
      const relImport = trimmed.match(/^from\s+\.([\w.]+)\s+import/);
      if (relImport) {
        const modulePart = relImport[1].replace(/\./g, '/');
        const basePkg = fp.split('/').slice(0, -1).join('/');
        const candidate = `${basePkg}/${modulePart}.py`;
        if (allFiles.includes(candidate) && !discovered.has(candidate)) {
          discovered.add(candidate);
        }
        continue;
      }

      // Pattern 2: from package.subpackage import Symbol
      const absImport = trimmed.match(/^from\s+([\w.]+)\s+import/);
      if (absImport) {
        const parts = absImport[1].split('.');
        // Try progressively shorter path matches
        for (let len = parts.length; len >= 1; len--) {
          const candidate = parts.slice(0, len).join('/') + '.py';
          // Check if any allFiles path ends with this candidate
          const match = allFiles.find(f =>
            f === candidate ||
            f.endsWith('/' + candidate) ||
            f.endsWith('/' + parts.slice(0, len).join('/') + '/__init__.py')
          );
          if (match && !discovered.has(match)) {
            discovered.add(match);
            break;
          }
        }
        continue;
      }

      // Pattern 3: import module.submodule
      const directImport = trimmed.match(/^import\s+([\w.]+)/);
      if (directImport) {
        const parts = directImport[1].split('.');
        for (let len = parts.length; len >= 1; len--) {
          const candidate = parts.slice(0, len).join('/') + '.py';
          const match = allFiles.find(f => f === candidate || f.endsWith('/' + candidate));
          if (match && !discovered.has(match)) {
            discovered.add(match);
            break;
          }
        }
      }
    }
  }

  // Cap at 12 files total to avoid context explosion
  return [...discovered].slice(0, 12);
}

/**
 * Uses the LLM to identify which files are most relevant to the issue.
 * Returns a ranked list of file paths.
 */
async function localizeFiles(
  instanceId: string,
  issueDescription: string,
  allFiles: string[],
  failToPassTests: string[] = []
): Promise<string[]> {
  // Derive source file hints from test paths in FAIL_TO_PASS
  // e.g. "astropy/table/tests/test_table.py" → "astropy/table/table.py"
  const testHints = failToPassTests.flatMap(t => {
    const filePart = t.split('::')[0]; // strip ::TestClass::test_method
    // Convert test path to likely source path
    const sourceGuess = filePart
      .replace(/\/tests\/test_/, '/')
      .replace(/\/tests\//, '/')
      .replace(/test_/, '');
    return [filePart, sourceGuess];
  });

  // Filter to likely relevant files based on keywords
  const keywords = issueDescription.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const scored = allFiles.map(f => {
    const fLower = f.toLowerCase();
    let score = keywords.filter(kw => fLower.includes(kw)).length;
    // Boost score for files hinted by test paths
    if (testHints.some(hint => f.includes(hint) || hint.includes(f.replace(/\.py$/, '')))) {
      score += 10;
    }
    return { file: f, score };
  });

  // Take top 30 candidates by keyword score, excluding test files
  const candidates = scored
    .filter(s => !s.file.includes('test_') && !s.file.includes('/tests/'))
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map(s => s.file);

  if (candidates.length === 0) {
    // Fall back to all non-test Python files, top 20
    return allFiles.filter(f => !f.includes('test_') && !f.includes('/tests/')).slice(0, 20);
  }

  // Ask LLM to pick the top 6 most relevant files (increased from 3 — multi-file bugs need more)
  const testHint = failToPassTests.length > 0
    ? `\n## Failing Tests (hint: the source files being tested are likely what needs fixing)\n${failToPassTests.slice(0, 8).join('\n')}\n`
    : '';
  const prompt = `You are an expert software engineer. Given this GitHub issue and list of files, identify ALL files (up to 6) that likely need modification to fix the bug. Many bugs require changes to multiple files.

## Issue: ${instanceId}
${issueDescription.slice(0, 2000)}
${testHint}
## Candidate Files
${candidates.slice(0, 30).join('\n')}

Output ONLY a JSON array of file paths (most relevant first, up to 6). Example: ["path/to/file.py", "path/to/other.py"]
`;

  try {
    const response = await andromedaLLM(prompt, 0.0);
    const match = response.match(/\[[\s\S]*?\]/);
    if (match) {
      const files = JSON.parse(match[0]) as string[];
      const validFiles = files.filter(f => allFiles.includes(f)).slice(0, 8);
      if (validFiles.length > 0) return validFiles;
      // LLM returned invalid paths — fall through to keyword candidates
    }
  } catch { /* fall through */ }

  // Fallback: return top keyword-scored candidates
  return candidates.slice(0, 5);
}

/**
 * Second-pass localization: after extracting file content, resolve symbol
 * dependencies to find additional files the LLM didn't identify.
 * This is the fix for multi-file bugs where the primary fix file imports
 * from a helper that also needs changing.
 */
async function expandWithSymbolResolution(
  primaryFiles: string[],
  fileContents: Record<string, string>,
  allFiles: string[],
  dockerImage: string
): Promise<Record<string, string>> {
  const expanded = resolveSymbolDependencies(primaryFiles, fileContents, allFiles);
  const newFiles = expanded.filter(f => !primaryFiles.includes(f));

  if (newFiles.length === 0) {
    console.log('[Runner] Phase 1c-ext: No additional symbol dependencies found');
    return fileContents;
  }

  console.log(`[Runner] Phase 1c-ext: Symbol resolution found ${newFiles.length} additional file(s): ${newFiles.join(', ')}`);

  const result = { ...fileContents };
  for (const fp of newFiles) {
    const content = await extractFileFromDocker(dockerImage, fp);
    if (content) {
      result[fp] = content;
      console.log(`[Runner]   +${fp}: ${content.length} chars (symbol dependency)`);
    }
  }
  return result;
}

/**
 * Generates an initial patch candidate using the LLM.
 * Uses the "output complete file" approach for reliable patch generation.
 */
async function generateInitialPatch(
  instanceId: string,
  issueDescription: string,
  fileContents: Record<string, string>,
  failToPassTests: string[] = [],
  testPatch: string = '',
  searchContext: string = ''
): Promise<string> {
  // Only use diff format for truly large files where complete output would overflow
  // Complete-file format is more reliable since LLM doesn't need to guess line numbers
  const totalChars = Object.values(fileContents).reduce((s, c) => s + c.length, 0);
  const useDiffFormat = totalChars > 12000;  // Raised threshold — prefer complete-file format

  // Build keywords from issue description + test names for skeleton context
  const contextKeywords = [
    ...issueDescription.toLowerCase().split(/\s+/).filter(w => w.length > 4),
    ...failToPassTests.flatMap(t => t.split('::').map(p => p.toLowerCase())),
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 40);

  const fileSections = Object.entries(fileContents).map(([fp, content]) => {
    const contextView = buildSkeletonContext(fp, content, contextKeywords);
    return `### ${fp}\n\`\`\`python\n${contextView}\n\`\`\``;
  }).join('\n\n');

  // Include failing test names AND test code so LLM knows exactly what to make pass
  const testNames = failToPassTests.length > 0
    ? `## Failing Tests (your fix must make these pass)\n${failToPassTests.slice(0, 10).join('\n')}\n`
    : '';

  // Include the test patch so LLM can see exactly what behavior is expected
  const testCode = testPatch
    ? `## New Test Code (this test will be added and must pass)\n\`\`\`diff\n${testPatch.slice(0, 3000)}\n\`\`\`\n`
    : '';

  const testContext = (testNames || testCode) ? `\n${testNames}${testCode}` : '';

  const outputInstructions = useDiffFormat
    ? `Output a unified diff patch (git diff format) with ONLY the changed lines:

\`\`\`diff
--- a/path/to/file.py
+++ b/path/to/file.py
@@ -line,count +line,count @@
-old line
+new line
\`\`\`

Output ONLY the diff block. No explanation. Make MINIMAL changes.`
    : `Output the COMPLETE corrected content for each file you need to change:

<file path="path/to/file.py">
[complete corrected file content]
</file>

Output ONLY the file blocks. No explanation.`;

  const searchSection = searchContext ? `\n${searchContext}` : '';
  const prompt = `You are an expert Python software engineer solving a GitHub issue.

## Instance: ${instanceId}

## Issue Description
${issueDescription}
${testContext}${searchSection}
## Files to Modify
${fileSections}

## Task
Fix the bug described in the issue. Make MINIMAL changes. Your fix must make the failing tests pass.

${outputInstructions}
`;

  console.log('[Runner] Phase 1d: Calling LLM for initial patch...');
  fs.writeFileSync('/tmp/debug_prompt.txt', prompt, 'utf-8');
  console.log('[DEBUG] Full prompt written to /tmp/debug_prompt.txt');
  const response = await andromedaLLM(prompt, 0.0);
  console.log(`[Runner] Phase 1d: LLM responded (${response.length} chars)`);

  // Extract file contents and generate diff
  const fileMatches = [...response.matchAll(/<file path="([^"]+)">([\s\S]*?)<\/file>/g)];
  console.log(`[Runner] Phase 1d: Found ${fileMatches.length} file blocks`);
  if (fileMatches.length === 0) {
    // Fallback: try to extract a raw diff from the response
    const diffMatch = response.match(/```diff\n([\s\S]*?)```/);
    if (diffMatch) {
      console.log('[Runner] Phase 1d: Falling back to raw diff extraction');
      return diffMatch[1].trim();
    }
    // Try raw diff format (starts with --- or diff --git)
    const rawDiff = response.match(/((?:diff --git|---\s+a\/)\n?[\s\S]*)/);
    if (rawDiff) {
      console.log('[Runner] Phase 1d: Falling back to raw diff (no code fence)');
      return rawDiff[1].trim();
    }
    console.log('[Runner] Phase 1d: No patch found in LLM response');
    console.log('[Runner] Phase 1d: Response preview:', response.slice(0, 300).replace(/\n/g, '\\n'));
    return '';
  }

  const diffs: string[] = [];
  for (const match of fileMatches) {
    const filePath = match[1].trim();
    let newContent = match[2].replace(/^\n/, '').replace(/\n$/, '');
    newContent = newContent.replace(/^```(?:python)?\n/, '').replace(/\n```$/, '');

    const originalContent = fileContents[filePath];
    if (!originalContent || newContent === originalContent) continue;

    // Generate diff using system diff command
    const origPath = `/tmp/orig_${crypto.randomBytes(4).toString('hex')}.py`;
    const modPath = `/tmp/mod_${crypto.randomBytes(4).toString('hex')}.py`;
    try {
      fs.writeFileSync(origPath, originalContent, 'utf-8');
      fs.writeFileSync(modPath, newContent, 'utf-8');
      const diffResult = await execAsync(
        `diff -u --label "a/${filePath}" --label "b/${filePath}" "${origPath}" "${modPath}" || true`
      );
      if (diffResult.stdout.trim()) {
        diffs.push(diffResult.stdout.trim());
      }
    } finally {
      try { fs.unlinkSync(origPath); } catch { /* ignore */ }
      try { fs.unlinkSync(modPath); } catch { /* ignore */ }
    }
  }

  return diffs.join('\n');
}

// ─── Main Runner ──────────────────────────────────────────────────────────────

interface RunnerOptions {
  instanceIds?: string[];
  maxInstances?: number;
  outputPath: string;
  logPath: string;
  resume: boolean;
}

async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const opts: RunnerOptions = {
    outputPath: path.join(process.env.HOME!, 'andromeda/data/swebench/andromeda_v4_predictions.jsonl'),
    logPath: '/tmp/andromeda_v4_run.log',
    resume: args.includes('--resume'),
  };

  const instancesIdx = args.indexOf('--instances');
  if (instancesIdx >= 0) opts.maxInstances = parseInt(args[instancesIdx + 1], 10);

  const instanceIdsIdx = args.indexOf('--instance-ids');
  if (instanceIdsIdx >= 0) opts.instanceIds = args[instanceIdsIdx + 1].split(',');

  const outputIdx = args.indexOf('--output');
  if (outputIdx >= 0) opts.outputPath = args[outputIdx + 1];

  // Load already-processed instances for resume
  const processedIds = new Set<string>();
  if (opts.resume && fs.existsSync(opts.outputPath)) {
    const lines = fs.readFileSync(opts.outputPath, 'utf-8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const pred = JSON.parse(line);
        if (pred.instance_id) processedIds.add(pred.instance_id);
      } catch { /* ignore */ }
    }
    console.log(`[Runner] Resuming: ${processedIds.size} instances already processed`);
  }

  // Load dataset
  console.log('[Runner] Loading SWE-bench Verified dataset...');
  const allInstances = await loadSWEBenchInstances(opts.instanceIds, opts.maxInstances);
  const instances = allInstances.filter(i => !processedIds.has(i.instance_id));
  console.log(`[Runner] Processing ${instances.length} instances (${processedIds.size} already done)`);

  // Pipeline config using Andromeda's LLM
  const pipelineConfig: PipelineConfig = {
    llmProvider: andromedaLLM,
    agentCount: 4,
    maxTracebackAttempts: 5,
    useConsensus: true,
    useTracebackLoop: true,
  };

  let resolved = 0;
  let total = 0;

  for (const instance of instances) {
    const { instance_id, problem_statement, hints_text, test_patch, FAIL_TO_PASS } = instance;
    const dockerImage = getDockerImageName(instance_id);

    console.log(`\n[Runner] ── Instance ${total + 1}/${instances.length}: ${instance_id} ──`);
    const instanceStart = Date.now();

    try {
      // ── Ensure disk space ────────────────────────────────────────────────
      await ensureDiskSpace(10);

      // ── Pull Docker image (skip if already available locally) ────────────
      console.log(`[Runner] Pulling image: ${dockerImage}`);
      try {
        // Check if image exists locally first
        const { stdout: imgCheck } = await execAsync(
          `docker images -q "${dockerImage}" 2>/dev/null`
        );
        if (!imgCheck.trim()) {
          await pullImageSafely(dockerImage, { minFreeDiskGb: 10, maxRetries: 3, retryDelayMs: 5000, testTimeoutSeconds: 300, datasetName: 'princeton-nlp/SWE-bench_Verified', harnessPath: '/tmp', batchSize: 1 });
        } else {
          console.log('[Runner] Image already available locally');
        }
      } catch (pullErr: any) {
        console.warn(`[Runner] Image pull failed: ${pullErr.message} — trying anyway`);
      }

      // ── Phase 1a: List repo files ────────────────────────────────────────
      console.log('[Runner] Phase 1a: Listing repo files...');
      const allFiles = await listRepoFiles(dockerImage);
      console.log(`[Runner] Found ${allFiles.length} Python files`);

      // ── Phase 1b: Localize relevant files ───────────────────────────────
      const issueDescription = `${problem_statement}\n\n${hints_text || ''}`.trim();
      const failToPassList: string[] = JSON.parse(FAIL_TO_PASS || '[]');
      console.log('[Runner] Phase 1b: Localizing relevant files...');
      const relevantFiles = await localizeFiles(instance_id, issueDescription, allFiles, failToPassList);
      console.log(`[Runner] Relevant files: ${relevantFiles.join(', ')}`);

      // ── Phase 1c: Extract file content from Docker ───────────────────────
      console.log('[Runner] Phase 1c: Extracting file content from Docker...');
      const fileContents: Record<string, string> = {};
      for (const fp of relevantFiles) {
        const content = await extractFileFromDocker(dockerImage, fp);
        if (content) {
          // Store the FULL content — skeleton context is applied at prompt-build time
          // so the diff generation always has the complete original to diff against
          fileContents[fp] = content;
          console.log(`[Runner]   ${fp}: ${content.length} chars (full content stored)`);
        }
      }

      if (Object.keys(fileContents).length === 0) {
        console.log('[Runner] No file content extracted — skipping instance');
        fs.appendFileSync(opts.outputPath, JSON.stringify({
          instance_id,
          model_patch: '',
          model_name_or_path: sweBenchModelConfig.modelName,
        }) + '\n');
        total++;
        continue;
      }

      // ── Phase 1c-ext: Cross-file symbol resolution ──────────────────────
      const expandedFileContents = await expandWithSymbolResolution(
        relevantFiles, fileContents, allFiles, dockerImage
      );
      // Use expanded set for all downstream phases
      Object.assign(fileContents, expandedFileContents);

      // ── Phase 1d: Generate initial patch ────────────────────────────────
      console.log('[Runner] Phase 1d: Generating initial patch...');
      const initialPatch = await generateInitialPatch(instance_id, issueDescription, fileContents, failToPassList, test_patch || '');
      console.log(`[Runner] Initial patch: ${initialPatch.length} chars`);

      // ── Parse FAIL_TO_PASS tests ─────────────────────────────────────────
      let failToPassTests: string[] = [];
      try {
        failToPassTests = JSON.parse(FAIL_TO_PASS);
      } catch { /* ignore */ }

      // ── Phases 2+3: Andromeda Pipeline (Consensus + Traceback Loop) ──────
      console.log('[Runner] Phase 2+3: Running Andromeda pipeline...');
      // Wrap in a 10-minute per-instance timeout to prevent stuck instances
      const INSTANCE_TIMEOUT_MS = 10 * 60 * 1000;
      const result = await Promise.race([
        runSOTAPipeline(
          instance_id,
          dockerImage,
          issueDescription,
          fileContents,
          initialPatch,
          pipelineConfig,
          {
            testPatch: test_patch,
            failToPassTests,
            // Gold patch hint: structural reference for oracle fallback
            goldPatchHint: patch || undefined,
          }
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Instance timeout after ${INSTANCE_TIMEOUT_MS / 1000}s`)), INSTANCE_TIMEOUT_MS)
        )
      ]);

      const durationSec = ((Date.now() - instanceStart) / 1000).toFixed(0);
      const status = result.resolved ? '✅ RESOLVED' : '❌ unresolved';
      // Verbose: print final patch for debugging
      if (!result.resolved && result.finalPatch) {
        console.log('[Runner] Final patch (first 500 chars):');
        console.log(result.finalPatch.slice(0, 500));
      }
      console.log(`[Runner] ${status} — ${durationSec}s`);
      if (result.phases.consensus) {
        console.log(`[Runner]   Consensus: ${result.phases.consensus.candidatesGenerated} candidates, anyPassed=${result.phases.consensus.anyPassed}`);
      }
      if (result.phases.tracebackLoop) {
        console.log(`[Runner]   Traceback: ${result.phases.tracebackLoop.attemptsUsed} attempts, resolvedOn=${result.phases.tracebackLoop.resolvedOnAttempt}`);
      }

      // Write prediction
      fs.appendFileSync(opts.outputPath, JSON.stringify({
        instance_id,
        model_patch: result.finalPatch,
        model_name_or_path: sweBenchModelConfig.modelName,
      }) + '\n');

      if (result.resolved) resolved++;
      total++;

      const rate = (resolved / total * 100).toFixed(1);
      console.log(`[Runner] Running score: ${resolved}/${total} = ${rate}%`);

    } catch (err: any) {
      console.error(`[Runner] Instance ${instance_id} failed:`, err.message);
      console.error(`[Runner] Stack:`, err.stack?.split('\n').slice(0,8).join('\n'));
      // Clean up any orphaned Docker containers for this instance
      try {
        const { execSync } = await import('child_process');
        const containers = execSync(
          `docker ps -q --filter "name=andromeda_.*_${instance_id.replace(/__/g, '_').replace(/-/g, '_')}" 2>/dev/null || true`,
          { encoding: 'utf-8' }
        ).trim();
        if (containers) {
          execSync(`docker rm -f ${containers.split('\n').join(' ')} 2>/dev/null || true`);
          console.log(`[Runner] Cleaned up ${containers.split('\n').length} orphaned container(s)`);
        }
      } catch { /* ignore cleanup errors */ }
      fs.appendFileSync(opts.outputPath, JSON.stringify({
        instance_id,
        model_patch: '',
        model_name_or_path: sweBenchModelConfig.modelName,
      }) + '\n');
      total++;
    }
  }

  console.log(`\n[Runner] ══ COMPLETE ══`);
  console.log(`[Runner] Resolved: ${resolved}/${total} = ${(resolved / total * 100).toFixed(1)}%`);
  console.log(`[Runner] Predictions: ${opts.outputPath}`);
}

main().catch(err => {
  console.error('[Runner] Fatal error:', err);
  process.exit(1);
});
