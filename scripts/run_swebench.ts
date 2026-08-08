/**
 * run_swebench.ts — Andromeda SWE-bench Runner (v5.4.0)
 *
 * v5.4.0: Wired BenchmarkLauncher as the mandatory scored-run gate.
 * For scored runs (SWEBENCH_SCORED=1), the runner MUST pass the 7-item
 * pre-launch checklist before dispatching any instance. The checklist:
 *   1. Smoke bundle passed for same image digest + harness revision
 *   2. No credentials in repair container
 *   3. allowRecoveryPatchApplication:false for scored runs
 *   4. Task list frozen and hashed before launch
 *   5. Non-pushing by construction (BENCHMARK_MODE=scored)
 *   6. Structured report (6 outcome categories, never collapsed)
 *   7. Canary slice before full batch with abort threshold
 *
 * Original runner (v2.2.0):
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
  createEscalatingLLMProvider,
  type SWEBenchModelConfig,
} from '../server/sweBenchModelConfig.js';
import {
  augmentWithSearch,
  type SearchAugmentation,
} from '../server/sweBenchSearchFallback.js';
import { runSOTAPipeline, PipelineConfig } from '../server/sweBenchPipeline.js';
import { pullImageSafely, ensureDiskSpace, DEFAULT_INFRA_CONFIG } from '../server/sweBenchInfra.js';
import { buildSmartContext } from '../server/sweBenchContextBuilder.js';
import { BenchmarkLauncher, type BenchmarkRunConfig, type InstanceResult, type BenchmarkReport } from '../server/benchmarkLauncher.js';
import { resolveImageDigest } from '../server/sweBenchImageResolver.js';
import { fixHunkCounts } from '../server/sweBenchTracebackLoop.js';
import { modelVisibleEvaluationArtifacts } from '../server/sweBenchEvalMode.js';

/**
 * Andromeda's LLM provider for SWE-bench.
 * Routes to Claude Sonnet 4.5 via OpenRouter.
 * v4.1: maxTokens raised to 16384 to handle multi-file complete-file outputs
 */
async function andromedaLLM(prompt: string, temperature = 0.0): Promise<string> {
  // Use a 180-second hard timeout to allow for large file responses
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000);  // 5 min — allow for large contexts
  try {
    return await simpleChatCompletion(
      [{ role: 'user', content: prompt }],
      {
        maxTokens: 16384,  // v4.1: raised for multi-file complete-file outputs (was 8192)
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
  // NOTE: patch (gold/reference patch) is intentionally absent from this
  // interface. Scored runs must not carry any reference to the gold patch,
  // even as a latent data path. Oracle experiments belong in a separate,
  // explicitly unscored development command.
  test_patch: string;
  FAIL_TO_PASS: string;  // JSON array string
  PASS_TO_PASS: string;  // JSON array string
  environment_setup_commit: string;
  version: string;
}

/**
  * Loads SWE-bench instances from the HuggingFace datasets library using an
 * explicit dataset name, revision (git commit), and split. This replaces the
 * previous cache-glob approach, which loaded the first Arrow file found
 * anywhere in the cache without verifying which dataset release or split it
 * came from.
 *
 * Required env vars for scored runs:
 *   SWEBENCH_DATASET_NAME     (default: princeton-nlp/SWE-bench_Verified)
 *   SWEBENCH_DATASET_REVISION (default: main — MUST be pinned for scored runs)
 *   SWEBENCH_DATASET_SPLIT    (default: test)
 *
 * Returns instances plus dataset provenance metadata for the run manifest.
 */
export interface DatasetProvenance {
  datasetName: string;
  datasetRevision: string;
  datasetSplit: string;
  /** SHA-256 of the canonical sorted JSON of instance_id values. */
  instanceIdHash: string;
  /** Number of instances loaded. */
  instanceCount: number;
  /** Required schema columns that were verified present. */
  schemaVerified: boolean;
}

async function loadSWEBenchInstances(
  instanceIds?: string[],
  maxInstances?: number,
  split?: string
): Promise<{ instances: SWEBenchInstance[]; provenance: DatasetProvenance }> {
  const datasetName = process.env.SWEBENCH_DATASET_NAME ?? 'princeton-nlp/SWE-bench_Verified';
  const datasetRevision = process.env.SWEBENCH_DATASET_REVISION ?? 'main';
  const datasetSplit = split ?? process.env.SWEBENCH_DATASET_SPLIT ?? 'test';

  const scriptPath = `/tmp/load_swebench_${crypto.randomBytes(4).toString('hex')}.py`;
  const filterClause = instanceIds && instanceIds.length > 0
    ? `instance_ids = ${JSON.stringify(instanceIds)}\ndf = df[df['instance_id'].isin(instance_ids)]`
    : maxInstances
    ? `df = df.head(${maxInstances})`
    : '';
  const script = `
import json
import hashlib
import sys
try:
    from datasets import load_dataset
except ImportError:
    print(json.dumps({'error': 'datasets library not installed. Run: pip install datasets'}))
    sys.exit(1)

dataset_name = ${JSON.stringify(datasetName)}
revision = ${JSON.stringify(datasetRevision)}
split = ${JSON.stringify(datasetSplit)}

try:
    ds = load_dataset(dataset_name, split=split, revision=revision, trust_remote_code=False)
except Exception as e:
    print(json.dumps({'error': f'Failed to load dataset: {e}'}))
    sys.exit(1)

# Verify required schema columns are present
REQUIRED_COLUMNS = ['instance_id', 'problem_statement', 'repo', 'base_commit',
                    'FAIL_TO_PASS', 'PASS_TO_PASS', 'test_patch']
missing = [c for c in REQUIRED_COLUMNS if c not in ds.column_names]
if missing:
    print(json.dumps({'error': f'Missing required columns: {missing}. Got: {ds.column_names}'}))
    sys.exit(1)

import pandas as pd
df = ds.to_pandas()
${filterClause}

# Compute a canonical hash of the sorted instance_id list to prove which records were used
all_ids = sorted(df['instance_id'].tolist())
instance_id_hash = hashlib.sha256(json.dumps(all_ids, sort_keys=True).encode()).hexdigest()

records = df.to_dict('records')
result = {
    'records': records,
    'provenance': {
        'datasetName': dataset_name,
        'datasetRevision': revision,
        'datasetSplit': split,
        'instanceIdHash': instance_id_hash,
        'instanceCount': len(records),
        'schemaVerified': True,
    }
}
print(json.dumps(result))
`;
  fs.writeFileSync(scriptPath, script);
  try {
    const result = await execAsync(`python3 "${scriptPath}" 2>&1`, { maxBuffer: 50 * 1024 * 1024 });
    let parsed: { error?: string; records?: SWEBenchInstance[]; provenance?: DatasetProvenance };
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error(`Dataset loader produced non-JSON output: ${result.stdout.slice(0, 500)}`);
    }
    if (parsed.error) {
      throw new Error(`Dataset loader error: ${parsed.error}`);
    }
    if (!parsed.records || !parsed.provenance) {
      throw new Error(`Dataset loader returned incomplete result: ${result.stdout.slice(0, 500)}`);
    }
    return { instances: parsed.records, provenance: parsed.provenance };
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
 * Extracts file content directly from the Docker image using a network-disabled,
 * read-only inspection container. Uses the resolved digest reference when
 * available to ensure the exact image is inspected.
 */
async function extractFileFromDocker(dockerImage: string, filePath: string): Promise<string | null> {
  try {
    const result = await execAsync(
      // --network none: no outbound network access during file inspection
      // --read-only: root filesystem is read-only (inspection only, no writes)
      // --rm: container is removed immediately after the command exits
      `docker run --rm --network none --read-only "${dockerImage}" cat "/testbed/${filePath}" 2>/dev/null`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
    return result.stdout;
  } catch {
    return null;
  }
}
/**
 * Lists Python files in the Docker image's testbed directory using a
 * network-disabled, read-only inspection container.
 */
async function listRepoFiles(dockerImage: string): Promise<string[]> {
  try {
    const result = await execAsync(
      // --network none: no outbound network access during file listing
      // --read-only: root filesystem is read-only (inspection only, no writes)
      `docker run --rm --network none --read-only "${dockerImage}" bash -c "cd /testbed && git ls-files '*.py' 2>/dev/null"`,
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
  // Detect if this is a feature request (new file creation) vs bug fix
  const isFeatureRequest = /feature request|new.*transform|add.*support|implement|create.*new|introduce/i.test(issueDescription.slice(0, 500));
  const featureHint = isFeatureRequest
    ? `\nNOTE: This may be a feature request requiring a NEW file to be created. If so, include the __init__.py or similar registry file that would need to import the new module.\n`
    : '';
  const prompt = `You are an expert software engineer. Given this GitHub issue and list of files, identify ALL files (up to 6) that likely need modification to fix the bug or implement the feature. Many issues require changes to multiple files.
## Issue: ${instanceId}
${issueDescription.slice(0, 4000)}
${testHint}${featureHint}
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
  // Cap total context size to avoid LLM timeout on huge files (e.g., representation.py = 142k)
  // buildSmartContext will truncate each file, but we still need a total budget
  const TOTAL_CHAR_BUDGET = 200_000;
  let totalChars = Object.values(fileContents).reduce((s, c) => s + c.length, 0);
  for (const fp of newFiles) {
    if (totalChars >= TOTAL_CHAR_BUDGET) {
      console.log(`[Runner]   (skipping ${fp} — total char budget ${TOTAL_CHAR_BUDGET} reached)`);
      continue;
    }
    const content = await extractFileFromDocker(dockerImage, fp);
    if (content) {
      // Skip if adding this file would push us over budget
      if (totalChars + content.length > TOTAL_CHAR_BUDGET) {
        console.log(`[Runner]   (skipping ${fp} — would exceed char budget: ${totalChars + content.length} > ${TOTAL_CHAR_BUDGET})`);
        continue;
      }
      result[fp] = content;
      totalChars += content.length;
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
  searchContext: string = '',
  llmProvider?: (prompt: string, temperature?: number) => Promise<string>,
  testContextSnippets: string = ''
): Promise<string> {
  const callLLM = llmProvider ?? andromedaLLM;
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
    // Use buildSmartContext (with line numbers) instead of buildSkeletonContext
    // so the model generates correct @@ -line,count headers in unified diffs
    const contextView = buildSmartContext(fp, content, {
      issueDescription,
      failToPassTests,
      keywords: contextKeywords,
    });
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
    ? `Output a unified diff patch (git diff format) with ONLY the changed lines.

CRITICAL: Use REAL line numbers in the @@ header. Count from the file content shown above.
NEVER use 'x', 'N', or placeholder values. Example: @@ -42,7 +42,8 @@ (not @@ -x,7 +x,8 @@)

\`\`\`diff
--- a/path/to/file.py
+++ b/path/to/file.py
@@ -42,7 +42,8 @@
 context line
 context line
-old line to remove
+new line to add
 context line
\`\`\`

Rules:
- @@ -START,COUNT +START,COUNT @@ where START is the actual line number in the file
- Include 3 context lines before and after the change
- Output ONLY the diff block. No explanation. Make MINIMAL changes.`
    : `Output the COMPLETE corrected content for each file you need to change:

<file path="path/to/file.py">
[complete corrected file content]
</file>

Output ONLY the file blocks. No explanation.`;

  const searchSection = searchContext ? `\n${searchContext}` : '';

  // ── Fix 29: Extract error/exception hint from issue description ───────────────────────
  // Many hard instances mention a specific exception or expected behavior in the
  // issue text. Surfacing this prominently helps the LLM target the exact fix.
  const errorHintMatch = issueDescription.match(
    /(?:raises?|throws?|error:|exception:|AssertionError|ValueError|TypeError|AttributeError|KeyError|IndexError|RuntimeError|NotImplementedError|DeprecationWarning|\w+Error)[^.\n]{0,200}/i
  );
  const errorHint = errorHintMatch
    ? `\n## Key Error Signal (from issue)\n> ${errorHintMatch[0].trim()}\n`
    : '';
  const prompt = `You are an expert Python software engineer solving a GitHub issue.
## Instance: ${instanceId}
## Issue Description
${issueDescription}${errorHint}
${testContext}${testContextSnippets}${searchSection}
## Files to Modify
${fileSections}
## Task
Fix the bug or implement the feature described in the issue.
- For bug fixes: make MINIMAL changes to existing files.
- For feature requests: you may need to CREATE a new file (use <file path="new/path.py"> with complete content) AND update an existing __init__.py or registry file to import it.
- Your fix must make the failing tests pass.
${outputInstructions}
`;

  console.log('[Runner] Phase 1d: Calling LLM for initial patch...');
  fs.writeFileSync('/tmp/debug_prompt.txt', prompt, 'utf-8');
  console.log('[DEBUG] Full prompt written to /tmp/debug_prompt.txt');
  let response = await callLLM(prompt, 0.0);
  console.log(`[Runner] Phase 1d: LLM responded (${response.length} chars)`);

  // If the response looks like prose (no diff markers, no file blocks), retry once
  // with a more forceful prompt that strips all context and just asks for the diff.
  const hasDiffMarkers = response.includes('@@') || response.includes('--- a/') || response.includes('<file path=');
  if (!hasDiffMarkers && response.length > 100) {
    console.log('[Runner] Phase 1d: Response is prose, retrying with forceful diff prompt...');
    const forcePrompt = `You are a Python engineer. Output ONLY a unified diff patch. No prose, no explanation.

Fix this issue in ${instanceId}:
${issueDescription.slice(0, 500)}

Files to change:
${Object.keys(fileContents).join(', ')}

Format:
\`\`\`diff\n--- a/file.py\n+++ b/file.py\n@@ -N,M +N,M @@\n-old\n+new\n\`\`\`

Output ONLY the diff block.`;
    response = await callLLM(forcePrompt, 0.0);
    console.log(`[Runner] Phase 1d: Retry responded (${response.length} chars)`);
  }

  // Extract file contents and generate diff
  const fileMatches = [...response.matchAll(/<file path="([^"]+)">([\s\S]*?)<\/file>/g)];
  // Also handle truncated responses: <file path="..."> with no closing </file>
  // This happens when the LLM outputs a huge file and the API truncates the response
  const truncatedFileMatch = fileMatches.length === 0
    ? response.match(/<file path="([^"]+)">([\s\S]+)$/)
    : null;
  const effectiveMatches: RegExpMatchArray[] = fileMatches.length > 0
    ? [...fileMatches]
    : truncatedFileMatch ? [truncatedFileMatch] : [];
  console.log(`[Runner] Phase 1d: Found ${fileMatches.length} file blocks${truncatedFileMatch ? ' (1 truncated)' : ''}`);
  if (effectiveMatches.length === 0) {
    // Fallback: try to extract a raw diff from the response
    const diffMatch = response.match(/\`\`\`diff\n([\s\S]*?)\`\`\`/);
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
  for (const match of effectiveMatches) {
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
  const { instances: allInstances, provenance: datasetProvenance } = await loadSWEBenchInstances(opts.instanceIds, opts.maxInstances);
  const instances = allInstances.filter(i => !processedIds.has(i.instance_id));
  console.log(`[Runner] Processing ${instances.length} instances (${processedIds.size} already done)`);
  console.log(`[Runner] Dataset: ${datasetProvenance.datasetName}@${datasetProvenance.datasetRevision} split=${datasetProvenance.datasetSplit} instances=${datasetProvenance.instanceCount} idHash=${datasetProvenance.instanceIdHash.slice(0, 16)}...`);

  // ── v5.4: BenchmarkLauncher pre-flight gate (scored runs only) ──────────────
  // SWEBENCH_SCORED=1 activates the full 7-item checklist.
  // Without it, the runner operates in development mode (no gate).
  const isScoredRun = process.env.SWEBENCH_SCORED === '1';
    let _benchLauncher: BenchmarkLauncher | null = null;
  let _benchReport: BenchmarkReport | null = null;
  let _benchRunStartMs = Date.now();
  // Hoisted so the instance loop can use the resolved digest in InstanceResult.
  // Populated inside the isScoredRun block; falls back to the image tag.
  let _resolvedImageRef: string = instances.length > 0
    ? getDockerImageName(instances[0].instance_id)
    : 'unknown';
  if (isScoredRun) {
    console.log('[Runner] SWEBENCH_SCORED=1 — running pre-flight checklist...');
    // Step 1: Resolve the image digest for the first instance (all instances share the same registry).
    // For a scored run, the image must be pinned to a digest.
    const firstDockerImage = instances.length > 0 ? getDockerImageName(instances[0].instance_id) : 'unknown';
    let resolvedImageRef = firstDockerImage;
    try {
      const ri = resolveImageDigest(firstDockerImage, 'trusted_local', false);
      resolvedImageRef = ri.resolvedRef;
      _resolvedImageRef = ri.resolvedRef; // hoist to outer scope for instance loop
      console.log(`[Runner] Resolved image: ${resolvedImageRef}`);
    } catch (e) {
      console.warn(`[Runner] Image resolution failed (proceeding with tag): ${(e as Error).message}`);
    }

    // Step 2: Resolve model config for metadata
    const _preflightModelConfig = resolveSWEBenchModelConfig();

    // Step 3: Build the task list file (write instances to a temp file for hashing)
    const taskListPath = path.join(process.env.HOME!, 'andromeda/data/swebench/scored_task_list.json');
    fs.mkdirSync(path.dirname(taskListPath), { recursive: true });
    fs.writeFileSync(taskListPath, JSON.stringify(instances.map(i => i.instance_id), null, 2));

    // Step 4: Build the run bundle path
    const runBundlePath = path.join(
      process.env.HOME!,
      `andromeda/data/swebench/run_bundle_${Date.now()}.json`
    );

    // Step 5: Construct BenchmarkLauncher and call preflight()
    const launcherConfig: BenchmarkRunConfig = {
      imageRef: resolvedImageRef,
      taskListPath,
      modelId: _preflightModelConfig.modelId,
      promptTemplateHash: process.env.SWEBENCH_PROMPT_HASH ?? 'unset',
      temperature: _preflightModelConfig.temperature ?? 0.0,
      topP: 1.0,
      maxRetries: 5,
      instanceTimeoutMs: 25 * 60 * 1000,
      concurrency: 1,
      spendCapUsd: parseFloat(process.env.SWEBENCH_SPEND_CAP ?? '500'),
      canarySliceSize: parseInt(process.env.SWEBENCH_CANARY_SIZE ?? '5', 10),
      canaryAbortThreshold: parseFloat(process.env.SWEBENCH_CANARY_THRESHOLD ?? '0.6'),
      scoredRun: true,
      externalSearch: false,
      runBundlePath,
      // agentVersion: read from git describe so it reflects the actual build.
      // Uses execAsync (already imported) to avoid ESM require() issues.
      agentVersion: await (async () => { try { const r = await execAsync('git describe --tags --always --dirty', { cwd: process.cwd() }); return r.stdout.trim(); } catch { return 'unknown'; } })(),
      harnessRevision: process.env.SWEBENCH_HARNESS_REVISION ?? 'unset',
      // Dataset provenance from the pinned loader
      datasetName: datasetProvenance.datasetName,
      datasetRevision: datasetProvenance.datasetRevision,
      datasetSplit: datasetProvenance.datasetSplit,
      instanceIdHash: datasetProvenance.instanceIdHash,
      // P0.1: Exclusion registry — required for scored runs
      // Set SWEBENCH_EXCLUSION_REGISTRY to the path of the exclusions.jsonl file.
      // If set, any selected instance_id that appears in the registry causes an
      // immediate launch abort before any image pull or model invocation.
      ...(process.env.SWEBENCH_EXCLUSION_REGISTRY ? (() => {
        const regPath = process.env.SWEBENCH_EXCLUSION_REGISTRY!;
        let regHash = 'unknown';
        try {
          const regContent = fs.readFileSync(regPath, 'utf-8');
          regHash = crypto.createHash('sha256').update(regContent, 'utf8').digest('hex');
        } catch { /* will be caught in preflight */ }
        const selectedIds = instances.map(i => i.instance_id).sort();
        const selectedIdsHash = crypto.createHash('sha256')
          .update(JSON.stringify(selectedIds), 'utf8').digest('hex');
        return {
          exclusionRegistryPath: regPath,
          exclusionRegistryHash: regHash,
          selectedIdsHash,
          selectedInstanceIds: selectedIds,
        };
      })() : {}),
      // P5: Evaluation protocol — required for scored runs
      // Set SWEBENCH_EVAL_PROTOCOL to the path of the eval_protocol_v1.json file.
      ...(process.env.SWEBENCH_EVAL_PROTOCOL ? (() => {
        const protocolPath = process.env.SWEBENCH_EVAL_PROTOCOL!;
        let protocolHash = 'unknown';
        try {
          const protocolContent = fs.readFileSync(protocolPath, 'utf-8');
          protocolHash = crypto.createHash('sha256').update(protocolContent, 'utf8').digest('hex');
        } catch { /* will be caught in preflight */ }
        return {
          evalProtocolPath: protocolPath,
          evalProtocolHash: protocolHash,
        };
      })() : {}),
    };

    _benchLauncher = new BenchmarkLauncher(launcherConfig);

    // preflight() throws if any blocking check fails — the run cannot start
    const preflightResult = _benchLauncher.preflight();

    // Step 6: Set BENCHMARK_MODE=scored BEFORE any worker imports/starts
    process.env.BENCHMARK_MODE = 'scored';
    console.log('[Runner] BENCHMARK_MODE=scored set — git mutations are now blocked.');

    // Step 7: Write the run manifest before dispatching the canary
    _benchLauncher.writeRunBundle(preflightResult.runMetadata!);
    _benchReport = BenchmarkLauncher.buildEmptyReport(preflightResult.runMetadata!);
    _benchRunStartMs = Date.now();
    console.log(`[Runner] Run manifest written. Canary slice: ${launcherConfig.canarySliceSize} instances.`);
  }

  // Resolve model config from environment variables
  const sweBenchModelConfig = resolveSWEBenchModelConfig();
  const sweBenchLLM = createSWEBenchLLMProvider(sweBenchModelConfig);
  console.log(`[Runner] Model: ${sweBenchModelConfig.modelName} (${sweBenchModelConfig.modelId})`);
  if (sweBenchModelConfig.extendedThinking) {
    console.log(`[Runner] Extended thinking enabled (budget: ${sweBenchModelConfig.thinkingBudget} tokens)`);
  }

  // ── Tiered model escalation ──────────────────────────────────────────────────
  // SWEBENCH_ESCALATION=1  enables escalation.
  // SWEBENCH_MID_PROVIDER   mid-tier model for attempts 3-4 (default: claude-sonnet-5)
  // SWEBENCH_STRONG_PROVIDER strong model for attempt 5 only (default: claude-fable-5)
  //
  // 3-tier schedule (with SWEBENCH_MID_PROVIDER set):
  //   attempts 1-2 → base (Sonnet 4.5 via OpenRouter, cheap)
  //   attempts 3-4 → mid  (Sonnet 5 direct Anthropic, smart+affordable)
  //   attempt  5   → strong (Fable 5 direct Anthropic, SOTA, last resort)
  //
  // 2-tier schedule (SWEBENCH_MID_PROVIDER not set):
  //   attempts 1-2 → base
  //   attempts 3+  → strong
  let escalatingLLMProvider: PipelineConfig['escalatingLLMProvider'] | undefined;
  if (process.env.SWEBENCH_ESCALATION === '1') {
    const resolveConfig = (providerKey: string): SWEBenchModelConfig => {
      const savedProvider = process.env.SWEBENCH_PROVIDER;
      process.env.SWEBENCH_PROVIDER = providerKey;
      const cfg = resolveSWEBenchModelConfig();
      if (savedProvider !== undefined) process.env.SWEBENCH_PROVIDER = savedProvider;
      else delete process.env.SWEBENCH_PROVIDER;
      return cfg;
    };

    const strongProviderKey = process.env.SWEBENCH_STRONG_PROVIDER ?? 'claude-fable-5';
    const strongConfig = resolveConfig(strongProviderKey);

    const midProviderKey = process.env.SWEBENCH_MID_PROVIDER ?? 'claude-sonnet-5';
    const midConfig = resolveConfig(midProviderKey);

    // 3-tier: base → mid (attempt 3) → strong (attempt 5)
    escalatingLLMProvider = createEscalatingLLMProvider(
      sweBenchModelConfig, strongConfig, 3, midConfig, 5
    );
    console.log(
      `[Runner] Escalation (3-tier): ` +
      `attempts 1-2 → ${sweBenchModelConfig.modelId}, ` +
      `attempts 3-4 → ${midConfig.modelId}, ` +
      `attempt 5 → ${strongConfig.modelId}`
    );
  }

  // Pipeline config using the configured LLM
  const pipelineConfig: PipelineConfig = {
    llmProvider: sweBenchLLM,
    agentCount: 4,
    maxTracebackAttempts: 5,
    useConsensus: true,
    useTracebackLoop: true,
    escalatingLLMProvider,
    // scored_strict: model sees only issue text + repo state.
    // test_patch and FAIL_TO_PASS names are blocked from all prompts.
    // test_aware: test hints inserted (development only — NOT comparable
    // with published SWE-bench scores; label results separately).
    evalMode: isScoredRun ? 'scored_strict' : 'test_aware',
  };

  let resolved = 0;
  let total = 0;

  /**
   * Thrown by Phase 1e when the git apply --check container cannot start in
   * a scored run. Maps to infra_failure in the run bundle.
   */
  class PreflightInfraError extends Error {
    readonly patchHash: string;
    readonly diagnostic: string;
    constructor(msg: string, patchHash: string, diagnostic: string) {
      super(msg);
      this.name = 'PreflightInfraError';
      this.patchHash = patchHash;
      this.diagnostic = diagnostic;
    }
  }

  /**
   * Thrown by Phase 1e when the initial patch (and its one format-only repair)
   * both fail git apply --check in a scored run. Maps to exact_apply_failure.
   * No prediction is submitted to the evaluator.
   */
  class PreflightApplyError extends Error {
    readonly patchHash: string;
    readonly diagnostic: string;
    constructor(msg: string, patchHash: string, diagnostic: string) {
      super(msg);
      this.name = 'PreflightApplyError';
      this.patchHash = patchHash;
      this.diagnostic = diagnostic;
    }
  }

  for (const instance of instances) {
    const { instance_id, repo, base_commit, problem_statement, hints_text, test_patch, FAIL_TO_PASS, PASS_TO_PASS } = instance;
    const dockerImage = getDockerImageName(instance_id);

    console.log(`\n[Runner] ── Instance ${total + 1}/${instances.length}: ${instance_id} ──`);
        const instanceStart = Date.now();
    // Hoisted so the catch (infra_failure) block can record the per-instance digest.
    let instanceImageRef = dockerImage; // updated after pull+resolve inside try
    try {
      // ── Ensure disk space ────────────────────────────────────────────────
      await ensureDiskSpace(10, true);

      // ── Pull Docker image (skip if already available locally) ────────────
      console.log(`[Runner] Pulling image: ${dockerImage}`);
      try {
        // Check if image exists locally first
        const { stdout: imgCheck } = await execAsync(
          `docker images -q "${dockerImage}" 2>/dev/null`
        );
        if (!imgCheck.trim()) {
          await pullImageSafely(dockerImage, {
            ...DEFAULT_INFRA_CONFIG,
            minFreeDiskGb: 10,
            testTimeoutSeconds: 300,
            datasetName: 'princeton-nlp/SWE-bench_Verified',
            harnessPath: '/tmp',
            batchSize: 1,
          });
        } else {
          console.log('[Runner] Image already available locally');
        }
      } catch (pullErr: any) {
        console.warn(`[Runner] Image pull failed: ${pullErr.message} — trying anyway`);
      }

      // ── Resolve per-instance image digest ──────────────────────────────
      // Resolve immediately after pull so every discovery and repair operation
      // uses the immutable digest reference, not the mutable :latest tag.
      // instanceImageRef is hoisted above the try block so the catch can use it.
      try {
        const resolved = resolveImageDigest(dockerImage, 'trusted_local', false);
        instanceImageRef = resolved.resolvedRef;
        console.log(`[Runner] Per-instance digest: ${instanceImageRef}`);
      } catch (resolveErr: any) {
        if (isScoredRun) {
          // In scored mode, digest resolution failure is an infrastructure
          // failure — do not proceed with a mutable tag reference.
          throw new Error(
            `Scored run: digest resolution failed for ${dockerImage}: ${(resolveErr as Error).message}. ` +
            `Ensure the image is pulled and docker inspect is available.`
          );
        }
        console.warn(`[Runner] Digest resolution failed for ${dockerImage}: ${(resolveErr as Error).message} — using tag (dev mode only)`);
      }

      // ── Phase 1a: List repo files ────────────────────────────────────────
      console.log('[Runner] Phase 1a: Listing repo files...');
      const allFiles = await listRepoFiles(instanceImageRef);
      console.log(`[Runner] Found ${allFiles.length} Python files`);

      // ── Phase 1b: Localize relevant files ───────────────────────────────
      // scored_strict: use only problem_statement.
      // hints_text consists of post-issue comments collected before the solution
      // PR; SWE-bench leaderboard rules prohibit its use for scored evaluation.
      // test_aware: retain hints_text for development/debugging.
      const issueDescription = isScoredRun
        ? problem_statement.trim()
        : `${problem_statement}\n\n${hints_text || ''}`.trim();
      const failToPassList: string[] = JSON.parse(FAIL_TO_PASS || '[]');
      // Central fail-closed boundary: strict scored runs do not use
      // evaluator-provided test names or patches for retrieval, prompts, or
      // pipeline calls. Test-aware development runs retain that behavior.
      const evaluatorArtifacts = modelVisibleEvaluationArtifacts(
        isScoredRun ? 'scored_strict' : 'test_aware',
        test_patch,
        failToPassList,
      );
      const promptFailToPassList = evaluatorArtifacts.promptFailToPassTests;
      const promptTestPatch = evaluatorArtifacts.promptTestPatch;
      console.log('[Runner] Phase 1b: Localizing relevant files...');
      const relevantFiles = await localizeFiles(instance_id, issueDescription, allFiles, promptFailToPassList);
      console.log(`[Runner] Relevant files: ${relevantFiles.join(', ')}`);

      // ── Phase 1c: Extract file content from Docker ───────────────────────
      console.log('[Runner] Phase 1c: Extracting file content from Docker...');
      const fileContents: Record<string, string> = {};
      for (const fp of relevantFiles) {
        const content = await extractFileFromDocker(instanceImageRef, fp);
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
        relevantFiles, fileContents, allFiles, instanceImageRef
      );
      // Use expanded set for all downstream phases
      Object.assign(fileContents, expandedFileContents);

      // ── Phase 1c-test: Extract relevant test function snippets ───────────
      // This is a test-aware-development aid only. In scored_strict mode,
      // evaluator-provided test identifiers must not drive repository retrieval.
      let testContextSnippets = '';
      if (evaluatorArtifacts.allowTargetedTestContext) {
        const testFilePaths = [...new Set(failToPassList.map(t => t.split('::')[0]))];
        const testSnippets: string[] = [];
        for (const testFilePath of testFilePaths.slice(0, 2)) {
          const testContent = await extractFileFromDocker(instanceImageRef, testFilePath);
          if (testContent) {
            // Extract only the relevant test functions (not the whole file)
            const testFuncNames = failToPassList
              .filter(t => t.startsWith(testFilePath))
              .map(t => t.split('::').pop() || '');
            const lines = testContent.split('\n');
            const snippets: string[] = [];
            for (const funcName of testFuncNames.slice(0, 3)) {
              // Find the function definition
              const startIdx = lines.findIndex(l => l.match(new RegExp(`^def ${funcName}\\b|^    def ${funcName}\\b`)));
              if (startIdx >= 0) {
                // Extract until next def or end of file (max 50 lines)
                let endIdx = startIdx + 1;
                while (endIdx < lines.length && endIdx < startIdx + 50) {
                  if (endIdx > startIdx + 2 && lines[endIdx].match(/^def |^class /)) break;
                  endIdx++;
                }
                snippets.push(`# ${testFilePath}::${funcName}\n` + lines.slice(startIdx, endIdx).join('\n'));
              }
            }
            if (snippets.length > 0) {
              testSnippets.push(`### Test: ${testFilePath}\n\`\`\`python\n${snippets.join('\n\n')}\n\`\`\``);
            }
          }
        }
        if (testSnippets.length > 0) {
          testContextSnippets = `\n## Existing Test Functions (shows expected behavior — read these to understand what your fix must do)\n${testSnippets.join('\n\n')}\n`;
          console.log(`[Runner] Phase 1c-test: Extracted ${testSnippets.length} test snippet(s)`);
        }
      }

      // ── Phase 1d: Generate initial patch ────────────────────────────────
      console.log('[Runner] Phase 1d: Generating initial patch...');
      // Phase 1d-pre: Search augmentation (Fix 25b)
      // In scored_strict mode, web search is DISABLED. Fetching external
      // snippets would make the result dependent on changing online information
      // (including potentially indexed issue/solution material) rather than
      // solely the issue text and repository state. The preflight check also
      // rejects SWEBENCH_SEARCH=1 in scored mode.
      let searchContextBlock = '';
      if (!isScoredRun) {
        try {
          const searchAugmentation = await augmentWithSearch(instance_id, issueDescription);
          if (searchAugmentation.searched && searchAugmentation.contextBlock) {
            searchContextBlock = searchAugmentation.contextBlock;
            console.log(`[Runner] Search augmentation: ${searchAugmentation.snippets.length} snippets from ${searchAugmentation.queries.length} queries`);
          }
        } catch (searchErr: any) {
          console.warn(`[Runner] Search augmentation failed (non-fatal): ${searchErr.message}`);
        }
      } else {
        console.log('[Runner] scored_strict: web search disabled (externalSearch: false)');
      }

      let initialPatch = await generateInitialPatch(instance_id, issueDescription, fileContents, promptFailToPassList, promptTestPatch, searchContextBlock, sweBenchLLM, testContextSnippets);
      // Post-generation validation: detect x-placeholder hunk headers and retry
      // @@ -x,N +x,N @@ means the LLM used a placeholder instead of a real line number
      const hasPlaceholderHunks = /^@@ -[^\d\s,][^\s,]*[,\s]/m.test(initialPatch);
      if (hasPlaceholderHunks && initialPatch.length > 0) {
        console.warn('[Runner] Phase 1d: Patch has placeholder line numbers (@@ -x,...) — retrying with forceful prompt');
        const retryPrompt = `You are a Python engineer. Fix this issue with a CORRECT unified diff.

IMPORTANT: Your previous response used placeholder line numbers like @@ -x,7 +x,7 @@.
You MUST use REAL line numbers. Count the lines in the file content below.

Issue: ${issueDescription.slice(0, 500)}

Files:
${Object.entries(fileContents).map(([fp, c]) => `### ${fp}\n\`\`\`python\n${c.slice(0, 3000)}\n\`\`\``).join('\n\n')}

Output ONLY a unified diff with REAL line numbers:
\`\`\`diff
--- a/file.py
+++ b/file.py
@@ -42,7 +42,8 @@
 context
-old
+new
 context
\`\`\``;
        const retryResponse = await sweBenchLLM(retryPrompt, 0.0);
        const retryDiff = retryResponse.match(/\`\`\`diff\n([\s\S]*?)\`\`\`/);
        if (retryDiff && !/^@@ -[^\d\s,]/m.test(retryDiff[1])) {
          initialPatch = retryDiff[1].trim();
          console.log('[Runner] Phase 1d: Retry produced valid patch');
        } else {
          console.warn('[Runner] Phase 1d: Retry still has placeholder hunks — proceeding with fixHunkCounts fallback');
        }
      }
      console.log(`[Runner] Initial patch: ${initialPatch.length} chars`);

      // ── Phase 1e: git apply --check preflight (fail-closed for scored runs) ─────────────────────────────────────────────────────────────────────────────────────
      // Run git apply --check in a short-lived read-only inspection container.
      // If it fails, make ONE format-only repair call using only the git apply
      // diagnostic output. The repair turn MUST NOT see evaluator test names or
      // test_patch content (scored_strict boundary is maintained).
      //
      // Fail-closed contract (scored runs only):
      //   • Container cannot start → throw PreflightInfraError → infra_failure, no submission
      //   • Repair fails --check  → throw PreflightApplyError → exact_apply_failure, no submission
      //   • Both errors record patchHash and diagnostic in the run bundle.
      // Non-scored runs: advisory only (warn and continue).
      if (initialPatch.length > 0) {
        // v5.20: Normalize before preflight so the bytes validated by git apply
        // --check are the same bytes that will eventually be submitted. The
        // traceback loop also normalizes via fixHunkCounts, so this ensures the
        // preflight and the final submission operate on the same canonical form.
        initialPatch = fixHunkCounts(initialPatch);
        const patchHashForPreflight = crypto.createHash('sha256').update(initialPatch).digest('hex');
        const checkContainerName = `andromeda-check-${instance_id.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}`;
        let checkContainerStarted = false;
        try {
          const { spawnSync } = await import('child_process');
          const { exec } = await import('child_process');
          // Start a short-lived read-only container for the check
          // v5.28: Writable disposable checkout — no --read-only so git apply --reject
          // and patch can write to /testbed. Still isolated: no network, no caps.
          const startResult = spawnSync('docker', [
            'run', '-d',
            '--name', checkContainerName,
            '--network', 'none',
            '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true',
            // No --read-only: git apply --reject and patch need to write to /testbed
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
            instanceImageRef,
            'tail', '-f', '/dev/null',
          ], { encoding: 'utf-8', stdio: 'pipe', timeout: 30_000 });

          if (startResult.status !== 0) {
            const startDiag = (startResult.stderr || startResult.stdout || 'docker run failed').slice(0, 300);
            if (isScoredRun) {
              throw new PreflightInfraError(
                `Phase 1e: check container failed to start: ${startDiag}`,
                patchHashForPreflight,
                startDiag,
              );
            } else {
              console.warn(`[Runner] Phase 1e: Could not start check container — skipping preflight (non-scored run)`);
            }
          } else {
            checkContainerStarted = true;
            try {
              // Inject the patch into /tmp/check.diff via stdin
              await new Promise<void>((resolve) => {
                const child = exec(
                  `docker exec -i ${checkContainerName} sh -c 'cat > /tmp/check.diff'`,
                  (err) => { resolve(); void err; },
                );
                child.stdin!.write(initialPatch);
                child.stdin!.end();
              });
              // v5.28: Evaluator-exact three-command sequence on a writable disposable checkout.
              // Mirrors the official SWE-bench evaluator (swebench/harness/run_evaluation.py):
              //   CMD1: git apply --verbose
              //   CMD2: git apply --verbose --reject  (stateful: applies hunk 1, writes .rej for hunk 2)
              //   CMD3: patch --batch --fuzz=5 -p1    (stateful: runs on worktree modified by CMD2)
              // After all three commands, inspect git diff --stat to verify actual changes.
              // Accept if and only if: git diff shows non-empty changes.
              // This correctly handles the partial multi-hunk case where CMD2 partially applies
              // and CMD3 reverses the partial application (net result: empty worktree → reject).
              const cmd1Result = spawnSync('docker', [
                'exec', checkContainerName,
                'sh', '-c', 'cd /testbed && git apply --verbose /tmp/check.diff 2>&1',
              ], { encoding: 'utf-8', stdio: 'pipe', timeout: 15_000 });
              const cmd1Output = (cmd1Result.stdout || cmd1Result.stderr || '').slice(0, 400);
              const cmd1Exit = cmd1Result.status;

              let cmd2Output = '';
              let cmd2Exit = -1;
              if (cmd1Exit !== 0) {
                // CMD1 failed — try CMD2 (git apply --reject)
                const cmd2Result = spawnSync('docker', [
                  'exec', checkContainerName,
                  'sh', '-c', 'cd /testbed && git apply --verbose --reject /tmp/check.diff 2>&1',
                ], { encoding: 'utf-8', stdio: 'pipe', timeout: 15_000 });
                cmd2Output = (cmd2Result.stdout || cmd2Result.stderr || '').slice(0, 400);
                cmd2Exit = cmd2Result.status ?? -1;
              }

              // CMD3: always run patch --fuzz=5 on the current worktree state
              // (may be pristine if CMD1/CMD2 applied nothing, or partially modified by CMD2)
              const cmd3Result = spawnSync('docker', [
                'exec', checkContainerName,
                'sh', '-c', 'cd /testbed && patch --batch --fuzz=5 -p1 -i /tmp/check.diff 2>&1',
              ], { encoding: 'utf-8', stdio: 'pipe', timeout: 15_000 });
              const cmd3Output = (cmd3Result.stdout || cmd3Result.stderr || '').slice(0, 400);
              const cmd3Exit = cmd3Result.status ?? -1;

              // Inspect the final worktree state — the definitive acceptance criterion
              const diffStatResult = spawnSync('docker', [
                'exec', checkContainerName,
                'sh', '-c', 'cd /testbed && git diff --stat',
              ], { encoding: 'utf-8', stdio: 'pipe', timeout: 10_000 });
              const diffStatOutput = (diffStatResult.stdout || '').trim();
              const worktreeHasChanges = diffStatOutput.length > 0;

              let preflightPassed = worktreeHasChanges;
              let preflightDiagnostic = [
                `CMD1(git apply): exit=${cmd1Exit} ${cmd1Output.slice(0, 80)}`,
                cmd1Exit !== 0 ? `CMD2(git apply --reject): exit=${cmd2Exit} ${cmd2Output.slice(0, 80)}` : '',
                `CMD3(patch --fuzz=5): exit=${cmd3Exit} ${cmd3Output.slice(0, 80)}`,
                `worktree_changes=${worktreeHasChanges ? diffStatOutput.slice(0, 100) : 'NONE'}`,
              ].filter(Boolean).join(' | ');

              if (preflightPassed) {
                console.log(`[Runner] Phase 1e: Evaluator-sequence preflight passed — worktree has changes: ${diffStatOutput.slice(0, 80)}`);
              } else {
                console.warn(`[Runner] Phase 1e: Evaluator-sequence preflight failed — worktree empty after all three commands`);
                console.warn(`[Runner] Phase 1e: Diagnostic: ${preflightDiagnostic.slice(0, 300)}`);
              }

              if (!preflightPassed) {
                const diagnostic = preflightDiagnostic;
                console.warn(`[Runner] Phase 1e: Both preflight stages failed — making one format-only repair turn`);
                console.warn(`[Runner] Phase 1e: Diagnostic: ${diagnostic.slice(0, 200)}`);
                // ONE format-only repair turn: only the diagnostic, no evaluator artifacts
                const repairPrompt = `You are a Python engineer fixing a unified diff patch format error.

The following patch failed git apply --check with this error:
${diagnostic}

Original patch:
\`\`\`diff
${initialPatch.slice(0, 4000)}
\`\`\`

Fix ONLY the patch format (hunk headers, context lines, line counts).
Do NOT change the semantic content of the fix.
Do NOT add, remove, or modify any code logic.
Output ONLY the corrected unified diff:
\`\`\`diff`;
                let repairSucceeded = false;
                try {
                  const repairResponse = await sweBenchLLM(repairPrompt, 0.0);
                  const repairMatch = repairResponse.match(/\`\`\`diff\n?([\s\S]*?)\`\`\`/);
                  if (repairMatch) {
                    const repairedPatch = fixHunkCounts(repairMatch[1].trim());
                    // Verify the repaired patch also passes --check
                    await new Promise<void>((resolve) => {
                      const child2 = exec(
                        `docker exec -i ${checkContainerName} sh -c 'cat > /tmp/check2.diff'`,
                        (err) => { resolve(); void err; },
                      );
                      child2.stdin!.write(repairedPatch);
                      child2.stdin!.end();
                    });
                    // Recheck: run the full evaluator sequence on the repaired patch
                    // First reset the worktree (CMD2 may have partially applied the original patch)
                    spawnSync('docker', [
                      'exec', checkContainerName,
                      'sh', '-c', 'cd /testbed && git checkout -- . && git clean -fd 2>&1',
                    ], { encoding: 'utf-8', stdio: 'pipe', timeout: 15_000 });
                    const recheck1 = spawnSync('docker', [
                      'exec', checkContainerName,
                      'sh', '-c', 'cd /testbed && git apply --verbose /tmp/check2.diff 2>&1',
                    ], { encoding: 'utf-8', stdio: 'pipe', timeout: 15_000 });
                    if (recheck1.status !== 0) {
                      spawnSync('docker', [
                        'exec', checkContainerName,
                        'sh', '-c', 'cd /testbed && git apply --verbose --reject /tmp/check2.diff 2>&1',
                      ], { encoding: 'utf-8', stdio: 'pipe', timeout: 15_000 });
                    }
                    spawnSync('docker', [
                      'exec', checkContainerName,
                      'sh', '-c', 'cd /testbed && patch --batch --fuzz=5 -p1 -i /tmp/check2.diff 2>&1',
                    ], { encoding: 'utf-8', stdio: 'pipe', timeout: 15_000 });
                    const recheckDiffStat = spawnSync('docker', [
                      'exec', checkContainerName,
                      'sh', '-c', 'cd /testbed && git diff --stat',
                    ], { encoding: 'utf-8', stdio: 'pipe', timeout: 10_000 });
                    const recheckHasChanges = (recheckDiffStat.stdout || '').trim().length > 0;
                    let recheckPassed = recheckHasChanges;
                    let recheckDiag = recheckHasChanges
                      ? `worktree_changes=${(recheckDiffStat.stdout || '').trim().slice(0, 100)}`
                      : 'worktree empty after evaluator sequence on repaired patch';
                    if (recheckPassed) {
                      initialPatch = repairedPatch;
                      repairSucceeded = true;
                      console.log('[Runner] Phase 1e: Format repair succeeded — patch now passes preflight');
                    } else {
                      console.warn(`[Runner] Phase 1e: Format repair did not fix the issue. Recheck: ${recheckDiag.slice(0, 100)}`);
                      if (isScoredRun) {
                        throw new PreflightApplyError(
                          `Phase 1e: patch failed both preflight stages after one repair attempt`,
                          patchHashForPreflight,
                          `Original: ${diagnostic.slice(0, 200)} | After repair: ${recheckDiag.slice(0, 200)}`,
                        );
                      }
                    }
                  } else {
                    console.warn('[Runner] Phase 1e: Repair response contained no diff block');
                    if (isScoredRun) {
                      throw new PreflightApplyError(
                        `Phase 1e: patch failed git apply --check; repair produced no diff`,
                        patchHashForPreflight,
                        diagnostic.slice(0, 400),
                      );
                    }
                  }
                } catch (repairErr) {
                  // Re-throw PreflightApplyError directly; wrap other errors
                  if (repairErr instanceof PreflightApplyError) throw repairErr;
                  const repairErrMsg = repairErr instanceof Error ? repairErr.message : String(repairErr);
                  console.warn(`[Runner] Phase 1e: Format repair call failed: ${repairErrMsg}`);
                  if (isScoredRun && !repairSucceeded) {
                    throw new PreflightApplyError(
                      `Phase 1e: patch failed --check; repair call threw: ${repairErrMsg.slice(0, 100)}`,
                      patchHashForPreflight,
                      diagnostic.slice(0, 400),
                    );
                  }
                }
              } else {
                // preflightPassed was already logged above with worktree details
                void 0; // no-op: success already logged at line 1399
              }
            } finally {
              if (checkContainerStarted) {
                spawnSync('docker', ['rm', '-f', checkContainerName], { encoding: 'utf-8', stdio: 'pipe' });
              }
            }
          }
        } catch (checkErr) {
          // Re-throw typed preflight errors directly to the instance catch block
          if (checkErr instanceof PreflightInfraError || checkErr instanceof PreflightApplyError) throw checkErr;
          const checkErrMsg = checkErr instanceof Error ? checkErr.message : String(checkErr);
          console.warn(`[Runner] Phase 1e: Unexpected preflight error: ${checkErrMsg}`);
          // Always clean up the check container on unexpected errors
          if (checkContainerStarted) {
            try {
              const { spawnSync } = await import('child_process');
              spawnSync('docker', ['rm', '-f', checkContainerName], { encoding: 'utf-8', stdio: 'pipe' });
            } catch { /* ignore cleanup errors */ }
          }
          if (isScoredRun) {
            throw new PreflightInfraError(
              `Phase 1e: unexpected preflight error: ${checkErrMsg.slice(0, 150)}`,
              patchHashForPreflight,
              checkErrMsg.slice(0, 400),
            );
          }
        }
      }

      // ── Parse FAIL_TO_PASS tests ─────────────────────────────────────────────────────────────────────────────────────
      let failToPassTests: string[] = [];
      try {
        failToPassTests = JSON.parse(FAIL_TO_PASS);
      } catch { /* ignore */ }

      // ── Phases 2+3: Andromeda Pipeline (Consensus + Traceback Loop) ──────
      console.log('[Runner] Phase 2+3: Running Andromeda pipeline...');
      // Fix 26: Proper instance timeout that:
      //   1. Clears the timer when pipeline resolves first (prevents Node.js hang)
      //   2. Silently catches the background pipeline rejection after timeout
      //      (prevents unhandled rejection crash that was killing the process)
      const INSTANCE_TIMEOUT_MS = 25 * 60 * 1000;  // 25min: allows 5 traceback attempts × 300s each
      let instanceTimeoutId: ReturnType<typeof setTimeout> | null = null;
      const pipelinePromise = runSOTAPipeline(
        instance_id,
        instanceImageRef,
        issueDescription,
        fileContents,
        initialPatch,
        pipelineConfig,
        {
          testPatch: evaluatorArtifacts.pipelineTestPatch,
          failToPassTests: evaluatorArtifacts.pipelineFailToPassTests,
          // goldPatchHint intentionally absent: scored runs must not carry
          // any reference to the gold patch. Oracle experiments belong in a
          // separate, explicitly unscored development command.
        }
      );
      // Suppress unhandled rejection from background pipeline after timeout
      pipelinePromise.catch(() => { /* silently ignore — timeout already handled */ });
      const result = await Promise.race([
        pipelinePromise,
        new Promise<never>((_, reject) => {
          instanceTimeoutId = setTimeout(
            () => reject(new Error(`Instance timeout after ${INSTANCE_TIMEOUT_MS / 1000}s`)),
            INSTANCE_TIMEOUT_MS
          );
        }),
      ]).finally(() => {
        // Always clear the timeout timer to prevent Node.js from hanging
        if (instanceTimeoutId !== null) clearTimeout(instanceTimeoutId);
      });

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

      // v5.20: finalPatch is already canonical (fixHunkCounts applied once in
      // sweBenchTracebackLoop.ts before the hash is computed). Do NOT apply
      // fixHunkCounts again — that would produce a different byte string than
      // what patchHash covers, breaking the identity invariant.
      const cleanPatch = result.finalPatch ?? '';
      // Hash identity assertion: the bytes we are about to serialize must match
      // the hash recorded in the run bundle. If they diverge, something in the
      // pipeline mutated the patch after the hash was computed — block submission.
      if (cleanPatch.length > 0 && result.patchHash) {
        const serializedHash = crypto.createHash('sha256').update(cleanPatch, 'utf8').digest('hex');
        if (serializedHash !== result.patchHash) {
          console.error(`[Runner] PATCH IDENTITY VIOLATION for ${instance_id}: ` +
            `serialized hash ${serializedHash} !== recorded patchHash ${result.patchHash}. ` +
            `Blocking submission.`);
          // Write empty JSONL row
          fs.appendFileSync(opts.outputPath, JSON.stringify({
            instance_id,
            model_patch: '',
            model_name_or_path: sweBenchModelConfig.modelName,
          }) + '\n');
          total++;
          const rate = (resolved / total * 100).toFixed(1);
          console.log(`[Runner] Running score: ${resolved}/${total} = ${rate}%`);
          // v5.21: Also record exact_apply_failure in the benchmark report so
          // the JSONL and internal report stay consistent. Without this, a hash
          // violation would produce an empty JSONL row with no corresponding
          // report entry, making the two artifacts disagree.
          if (_benchReport && _benchLauncher) {
            const violationResult: InstanceResult = {
              instanceId: instance_id,
              outcome: 'exact_apply_failure',
              imageDigest: result.resolvedImageDigest ?? instanceImageRef,
              patchHash: result.patchHash,
              exactApply: false,
              fuzzyRecoveryAttempted: false,
              durationMs: Date.now() - instanceStart,
              errorMessage: `Hash identity violation: serialized=${serializedHash} recorded=${result.patchHash}`,
            };
            BenchmarkLauncher.recordInstance(_benchReport, violationResult);
          }
          continue;
        }
      }
      fs.appendFileSync(opts.outputPath, JSON.stringify({
        instance_id,
        model_patch: cleanPatch,
        model_name_or_path: sweBenchModelConfig.modelName,
      }) + '\n');

      if (result.resolved) resolved++;
      total++;

      const rate = (resolved / total * 100).toFixed(1);
      console.log(`[Runner] Running score: ${resolved}/${total} = ${rate}%`);

      // v5.8: Record per-instance outcome from structured runtime fields.
      // outcome classification:
      //   resolved           — validation passed
      //   exact_apply_failure — git apply failed (PATCH_APPLY_FAILED in output)
      //   timed_out          — instance timeout fired
      //   test_failure       — patch applied, tests ran, tests failed
      if (_benchReport && _benchLauncher) {
        const lastAttemptOutput = result.phases.tracebackLoop
          ? (result as any)._lastAttemptOutput as string | undefined
          : undefined;
        const patchApplyFailed = !result.resolved &&
          (result.exactApply === false);
        const timedOutInstance = !result.resolved && (result.timedOut === true);
        // scored_strict: predictionReady means patch applied cleanly but no
        // hidden tests ran. This is NOT a test failure. The external evaluator
        // determines whether the patch resolves the issue.
        const instanceOutcome: InstanceResult['outcome'] = result.resolved
          ? 'resolved'
          : result.predictionReady
          ? 'prediction_ready'
          : patchApplyFailed
          ? 'exact_apply_failure'
          : timedOutInstance
          ? 'timed_out'
          : 'test_failure';
        const instanceResult: InstanceResult = {
          instanceId: instance_id,
          outcome: instanceOutcome,
          // Use the digest resolved from the traceback loop (immutable sha256:...)
          // if available; fall back to the pre-flight resolved ref.
          // Use the per-instance resolved digest (immutable sha256:...) from
          // the traceback loop if available; fall back to instanceImageRef
          // (resolved immediately after pull for this instance).
          imageDigest: result.resolvedImageDigest ?? instanceImageRef,
          patchHash: result.patchHash,
          exactApply: result.exactApply ?? true,
          fuzzyRecoveryAttempted: false,
          durationMs: Date.now() - instanceStart,
        };
        BenchmarkLauncher.recordInstance(_benchReport, instanceResult);

        // v5.4: Canary abort check — after canary slice, check infra failure rate
        const canarySize = parseInt(process.env.SWEBENCH_CANARY_SIZE ?? '5', 10);
        if (total === canarySize && _benchLauncher.shouldAbortAfterCanary(_benchReport.instances)) {
          console.error(`[Runner] Canary abort triggered after ${canarySize} instances. Stopping run.`);
          _benchReport.completedAt = new Date().toISOString();
          _benchReport.wallClockMs = Date.now() - _benchRunStartMs;
          _benchLauncher.writeReport(_benchReport);
          process.exit(1);
        }
      }

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

      // v5.8+v5.18: Record outcome — PreflightApplyError → exact_apply_failure;
      // all other errors → infra_failure. Both record patchHash and diagnostic.
      if (_benchReport && _benchLauncher) {
        const isApplyFailure = err instanceof PreflightApplyError;
        const instanceResult: InstanceResult = {
          instanceId: instance_id,
          outcome: isApplyFailure ? 'exact_apply_failure' : 'infra_failure',
          imageDigest: instanceImageRef,
          exactApply: false,
          fuzzyRecoveryAttempted: false,
          durationMs: Date.now() - instanceStart,
          errorMessage: err.message?.slice(0, 200),
          // Record patchHash and diagnostic for preflight failures
          ...(err instanceof PreflightApplyError || err instanceof PreflightInfraError
            ? { patchHash: err.patchHash, preflightDiagnostic: err.diagnostic }
            : {}),
        };
        BenchmarkLauncher.recordInstance(_benchReport, instanceResult);

        // v5.4: Canary abort check for infra failures too
        const canarySize = parseInt(process.env.SWEBENCH_CANARY_SIZE ?? '5', 10);
        if (total === canarySize && _benchLauncher.shouldAbortAfterCanary(_benchReport.instances)) {
          console.error(`[Runner] Canary abort triggered after ${canarySize} instances. Stopping run.`);
          _benchReport.completedAt = new Date().toISOString();
          _benchReport.wallClockMs = Date.now() - _benchRunStartMs;
          _benchLauncher.writeReport(_benchReport);
          process.exit(1);
        }
      }
    }
  }

    console.log(`\n[Runner] ══ COMPLETE ══`);
  if (_benchReport) {
    const s = _benchReport.summary;
    console.log(`[Runner] ══ BENCHMARK SUMMARY ══`);
    console.log(`[Runner]   Total instances:          ${s.total}`);
    if (s.predictionReady > 0) {
      console.log(`[Runner]   Prediction ready:         ${s.predictionReady}  ← awaiting external evaluator (NOT the benchmark score)`);
    }
    if (s.resolved > 0) {
      console.log(`[Runner]   Resolved (internal):      ${s.resolved}  ← test_aware mode only; do NOT report as SWE-bench score`);
    }
    console.log(`[Runner]   Exact-apply failures:     ${s.exactApplyFailures}`);
    console.log(`[Runner]   Test failures:            ${s.testFailures}`);
    console.log(`[Runner]   Infrastructure failures:  ${s.infraFailures}`);
    console.log(`[Runner]   Timed out:               ${s.timedOut}`);
    console.log(`[Runner]   Invalid instances:        ${s.invalidInstances}`);
    console.log(`[Runner]   Total cost:               $${_benchReport.totalCostUsd.toFixed(2)}`);
    if (s.predictionReady > 0) {
      console.log(`[Runner] ══ Run the external SWE-bench evaluator on ${opts.outputPath} to obtain the official score. ══`);
    }
  } else {
    console.log(`[Runner] Resolved: ${resolved}/${total} = ${(resolved / total * 100).toFixed(1)}%`);
  }
  console.log(`[Runner] Predictions: ${opts.outputPath}`);
  // v5.4: Write the final benchmark report for scored runs
  if (_benchReport && _benchLauncher) {
    _benchReport.completedAt = new Date().toISOString();
    _benchReport.wallClockMs = Date.now() - _benchRunStartMs;
    _benchLauncher.writeReport(_benchReport);
  }
}

main().catch(err => {
  console.error('[Runner] Fatal error:', err);
  process.exit(1);
});
