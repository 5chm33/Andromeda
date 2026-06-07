/**
 * fileEngineAnalysis.ts — v6.25
 * Multi-pass analysis and edit engine.
 * Extracted from fileEngine.ts (god-module split).
 */
import JSZip from "jszip";
import { getActiveProvider } from "./llmProvider.js";
import { createLogger } from "./logger.js";
import type { FileEntry, FileIndex, MultiPassResult, SSEEmitter } from "./fileEngineTypes.js";
import { fileEngineTypes, js, TEXT_EXTS, compressFile, getFileEngineApiUrl, MAX_REQUESTED_FILES, getFileEngineProviderHeaders, getModelContextMaxOutput, MAX_CONTEXT_CHARS } from "./fileEngineTypes.js";
import { buildFileIndex, smartChunkFile } from "./fileEngineChunking.js";
const log = createLogger("fileEngineAnalysis");

// ─── Multi-Pass Analysis Engine ─────────────────────────────────────────────

/**
 * Pass 2: Ask the LLM which files it needs to see in full.
 */
export async function selectRelevantFiles(
  index: FileIndex,
  instruction: string,
  apiKey: string,
  model: string = "deepseek/deepseek-chat"
): Promise<string[]> {
  const systemPrompt = `You are a code analysis assistant. The user wants to analyze or edit a codebase.
You are given a FILE INDEX showing all files in the project with their sizes and key signatures.
Your job: select which files need to be read IN FULL to complete the user's request.

Rules:
- Return ONLY a JSON array of file paths, e.g. ["src/app.ts", "package.json"]
- Select the MINIMUM files needed — don't request everything
- Always include package.json or equivalent config if it exists
- For analysis tasks: select the main source files + entry points
- For edit tasks: select files that need to be changed + files they depend on
- Maximum ${MAX_REQUESTED_FILES} files
- If the project is small (<15 files), you may request all of them
- Prefer source files over test files unless the task is about tests`;

  const userPrompt = `## User Instruction
${instruction}

## File Index (${index.totalFiles} files, ${Math.round(index.totalSize / 1024)}KB total)
${index.indexText}

Return ONLY a JSON array of file paths you need to see in full.`;

  const response = await fetch(getFileEngineApiUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getFileEngineProviderHeaders() },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 2000,
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API error in file selection: ${response.status}`);
  }

  const data = (await response.json()) as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No file selection returned from AI");

  try {
    const parsed = JSON.parse(content);
    // Handle both { files: [...] } and [...] formats
    const files = Array.isArray(parsed) ? parsed : (parsed.files ?? parsed.paths ?? []);
    if (!Array.isArray(files)) return index.entries.slice(0, 15).map(e => e.path);
    return files.slice(0, MAX_REQUESTED_FILES).filter((f: any) => typeof f === "string");
  } catch {
    // Fallback: return top priority files
    return index.entries.slice(0, 15).map(e => e.path);
  }
}

/**
 * Pass 3: Load and compress the selected files.
 */
export async function loadAndCompressFiles(
  zip: JSZip,
  selectedPaths: string[],
  allPaths: string[]
): Promise<{ content: string; stats: { loaded: number; compressed: number; totalChars: number; avgRatio: number; overflowed: boolean; overflowPaths: string[] } }> {
  const parts: string[] = [];
  let totalChars = 0;
  let totalRatio = 0;
  let loaded = 0;
  const overflowPaths: string[] = [];

  // Validate paths exist in the ZIP
  const validPaths = selectedPaths.filter(p => {
    // Try exact match first
    if (zip.files[p]) return true;
    // Try with common prefixes stripped
    const match = allPaths.find(ap => ap.endsWith(p) || ap.includes(p));
    return !!match;
  });

  // v5.32: Progressive file loading with memory safety
  // Process files in batches to avoid memory exhaustion on large codebases
  const BATCH_SIZE = 50; // Process 50 files at a time
  const MAX_SINGLE_FILE_SIZE = 500_000; // Skip files > 500KB to prevent memory spikes

  for (let batchStart = 0; batchStart < validPaths.length; batchStart += BATCH_SIZE) {
    const batch = validPaths.slice(batchStart, batchStart + BATCH_SIZE);

    for (const requestedPath of batch) {
      // Resolve the actual path in the ZIP
      let actualPath = requestedPath;
      if (!zip.files[requestedPath]) {
        const match = allPaths.find(ap => ap.endsWith(requestedPath) || ap.includes(requestedPath));
        if (match) actualPath = match;
        else continue;
      }

      const file = zip.files[actualPath];
      if (!file || file.dir) continue;

      try {
        // v5.32: Check uncompressed size before loading to prevent memory exhaustion
        const fileAny = file as any;
        if (fileAny._data && typeof fileAny._data.uncompressedSize === "number") {
          if (fileAny._data.uncompressedSize > MAX_SINGLE_FILE_SIZE) {
            overflowPaths.push(actualPath);
            continue;
          }
        }

        const rawContent = await file.async("string");

        // v5.32: Double-check actual size after decompression
        if (rawContent.length > MAX_SINGLE_FILE_SIZE) {
          overflowPaths.push(actualPath);
          continue;
        }

        const { compressed, ratio } = compressFile(rawContent, actualPath);

        const chunk = `\n${"\u2550".repeat(60)}\nFILE: ${actualPath}\n${"\u2550".repeat(60)}\n${compressed}`;

        if (totalChars + chunk.length > MAX_CONTEXT_CHARS) {
          // v5.21: Track overflow files instead of just breaking
          overflowPaths.push(actualPath);
          continue; // Keep collecting overflow paths
        }

        parts.push(chunk);
        totalChars += chunk.length;
        totalRatio += ratio;
        loaded++;
      } catch {
        // Skip unreadable files
      }
    }

    // v5.32: Yield to event loop between batches to prevent blocking
    if (batchStart + BATCH_SIZE < validPaths.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  if (overflowPaths.length > 0) {
    parts.push(`\n[NOTE: ${overflowPaths.length} additional files will be analyzed in chunked passes]`);
  }

  return {
    content: parts.join("\n"),
    stats: {
      loaded,
      compressed: loaded,
      totalChars,
      avgRatio: loaded > 0 ? Math.round(totalRatio / loaded) : 0,
      overflowed: overflowPaths.length > 0,
      overflowPaths,
    },
  };
}

/**
 * Full multi-pass analysis pipeline.
 * Streams progress events via the emitter callback.
 */
export async function runMultiPassAnalysis(
  base64Zip: string,
  instruction: string,
  apiKey: string,
  model: string = "deepseek/deepseek-chat",
  emit?: SSEEmitter
): Promise<{ analysis: string; filesAnalyzed: number; tokenEstimate: number }> {
  // ─── Setup ────────────────────────────────────────────────────────────────
  const zipBuffer = Buffer.from(base64Zip, "base64");
  const zip = await JSZip.loadAsync(zipBuffer);

  // ZIP bomb protection
  let fileCount = 0;
  let totalUncompressed = 0;
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (path.includes("..") || path.startsWith("/")) {
      throw new Error(`Unsafe file path in ZIP: ${path}`);
    }
    fileCount++;
    if (fileCount > 2000) throw new Error("ZIP contains too many files (>2000)");
    totalUncompressed += (file as any)._data?.uncompressedSize ?? 0;
    if (totalUncompressed > 100 * 1024 * 1024) throw new Error("ZIP exceeds 100MB uncompressed limit");
  }

  // ─── Pass 1: Build Index ──────────────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "indexing", message: "Building file index..." });
  const index = await buildFileIndex(zip);
  emit?.({
    type: "index_built",
    fileCount: index.totalFiles,
    totalSize: `${Math.round(index.totalSize / 1024)}KB`,
    categories: {
      source: index.entries.filter(e => e.category === "source").length,
      config: index.entries.filter(e => e.category === "config").length,
      test: index.entries.filter(e => e.category === "test").length,
      docs: index.entries.filter(e => e.category === "docs").length,
    },
  });

  // ─── Pass 2: Select Relevant Files ────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "selecting", message: "AI selecting relevant files..." });

  let selectedPaths: string[];
  // v5.21: Load ALL text files for projects up to 500 files (was 20).
  // This ensures the LLM sees the entire codebase.
  if (index.totalFiles <= 500) {
    selectedPaths = index.entries.filter(e => TEXT_EXTS.test(e.path)).map(e => e.path);
    emit?.({ type: "files_selected", count: selectedPaths.length, reason: "Full codebase mode — loading all text files" });
  } else {
    // For very large projects (500+ files), use AI selection but with high limit
    selectedPaths = await selectRelevantFiles(index, instruction, apiKey, model);
    emit?.({ type: "files_selected", count: selectedPaths.length, paths: selectedPaths, reason: "AI-selected (project has 500+ files)" });
  }

  // ─── Pass 3: Load & Compress ──────────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "loading", message: `Loading ${selectedPaths.length} files with compression...` });
  const allPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir);
  const { content: fileContent, stats } = await loadAndCompressFiles(zip, selectedPaths, allPaths);
  const tokenEstimate = Math.round(fileContent.length / 4);
  emit?.({
    type: "compression_applied",
    filesLoaded: stats.loaded,
    totalChars: stats.totalChars,
    avgCompressionRatio: `${stats.avgRatio}%`,
    tokenEstimate,
  });

  // ─── Pass 4: Full Analysis ────────────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "analyzing", message: "Running full analysis..." });

  const systemPrompt = `You are Andromeda, an expert AI code analyst. You have been given a codebase to analyze.
You have access to a FILE INDEX (showing all files) and the FULL CONTENT of the most relevant files.

Produce a thorough, structured analysis covering:
1. Architecture Overview — what this project is, its tech stack, how it's organized
2. Code Quality — patterns, anti-patterns, potential bugs, type safety
3. Security — vulnerabilities, input validation, auth issues
4. Performance — bottlenecks, memory leaks, inefficient patterns
5. Recommendations — prioritized list of improvements with severity levels

Be specific: reference actual file paths, function names, and line-level issues.
If you can see something is incomplete or truncated, note it but don't speculate about what's missing.

Your context window is large. Use it fully — provide detailed, actionable analysis.`;

  const userPrompt = `## Instruction
${instruction}

## File Index (${index.totalFiles} files total)
${index.indexText.slice(0, 10000)}

## Full File Contents (${stats.loaded} files loaded, ${tokenEstimate} tokens estimated)
${fileContent}`;

  const analysisResponse = await fetch(getFileEngineApiUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getFileEngineProviderHeaders() },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 8000,
      temperature: 0.3,
    }),
  });

  if (!analysisResponse.ok) {
    const err = await analysisResponse.text();
    throw new Error(`DeepSeek API error in analysis: ${analysisResponse.status}: ${err}`);
  }

  const analysisData = (await analysisResponse.json()) as any;
  const analysis = analysisData.choices?.[0]?.message?.content || "Analysis failed — no response from AI";

  return { analysis, filesAnalyzed: stats.loaded, tokenEstimate };
}

/**
 * Full multi-pass edit pipeline.
 * Returns the edited ZIP as base64 + edit log.
 */
export async function runMultiPassEdit(
  base64Zip: string,
  instruction: string,
  apiKey: string,
  model: string = "deepseek/deepseek-chat",
  emit?: SSEEmitter
): Promise<{ editedZip: string; summary: string; editsApplied: number; log: string[] }> {
  // ─── Setup ────────────────────────────────────────────────────────────────
  const zipBuffer = Buffer.from(base64Zip, "base64");
  const zip = await JSZip.loadAsync(zipBuffer);

  // ZIP bomb protection
  let fileCount = 0;
  let totalUncompressed = 0;
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (path.includes("..") || path.startsWith("/")) throw new Error(`Unsafe path: ${path}`);
    fileCount++;
    if (fileCount > 2000) throw new Error("ZIP contains too many files (>2000)");
    totalUncompressed += (file as any)._data?.uncompressedSize ?? 0;
    if (totalUncompressed > 100 * 1024 * 1024) throw new Error("ZIP exceeds 100MB limit");
  }

  // ─── Pass 1: Build Index ──────────────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "indexing", message: "Building file index for editing..." });
  const index = await buildFileIndex(zip);
  emit?.({ type: "index_built", fileCount: index.totalFiles, totalSize: `${Math.round(index.totalSize / 1024)}KB` });

  // ─── Pass 2: Select Files to Edit (v5.21: load all for projects <500 files) ───
  emit?.({ type: "engine_phase", phase: "selecting", message: "Loading all files for editing (full codebase mode)..." });

  let selectedPaths: string[];
  if (index.totalFiles <= 500) {
    selectedPaths = index.entries.filter(e => TEXT_EXTS.test(e.path)).map(e => e.path);
  } else {
    selectedPaths = await selectRelevantFiles(index, instruction, apiKey, model);
  }
  emit?.({ type: "files_selected", count: selectedPaths.length, paths: selectedPaths });

  // ─── Pass 3: Load Files (NO compression for edits — need exact content for find/replace) ──
  emit?.({ type: "engine_phase", phase: "loading", message: `Loading ${selectedPaths.length} files for editing...` });
  const allPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir);
  const fileMap: Record<string, string> = {};
  const parts: string[] = [];
  let totalChars = 0;

  for (const requestedPath of selectedPaths) {
    let actualPath = requestedPath;
    if (!zip.files[requestedPath]) {
      const match = allPaths.find(ap => ap.endsWith(requestedPath) || ap.includes(requestedPath));
      if (match) actualPath = match;
      else continue;
    }

    const file = zip.files[actualPath];
    if (!file || file.dir) continue;

    try {
      const content = await file.async("string");
      fileMap[actualPath] = content;

      // v5.28: Smart chunking replaces windowed viewing for large files
      // For edits, we need EXACT content so find/replace works
      let displayContent = content;
      const lines = content.split("\n");
      if (lines.length > 1500) {
        // Use smart chunking by function boundaries instead of head+tail
        const _ext = actualPath.split(".").pop() || "";
        const availableTokens = Math.floor((MAX_CONTEXT_CHARS - totalChars) / 4);
        const chunked = smartChunkFile(content, actualPath, availableTokens > 0 ? availableTokens : 50000);
        displayContent = chunked.loaded;
        if (!chunked.isComplete) {
          displayContent += `\n\n// ─── [${chunked.chunksTotal - chunked.chunksLoaded} of ${chunked.chunksTotal} sections not loaded] ───\n`;
          displayContent += `// Loaded ${chunked.chunksLoaded}/${chunked.chunksTotal} function-level chunks.\n`;
          displayContent += `// To edit unloaded sections, reference them by function name.\n`;
        }
      }

      const chunk = `\n${"═".repeat(60)}\nFILE: ${actualPath} (${lines.length} lines)\n${"═".repeat(60)}\n${displayContent}`;
      if (totalChars + chunk.length > MAX_CONTEXT_CHARS) {
        parts.push(`\n[CONTEXT BUDGET REACHED — remaining files not loaded]`);
        break;
      }
      parts.push(chunk);
      totalChars += chunk.length;
    } catch { /* skip */ }
  }

  const fileContent = parts.join("\n");
  emit?.({ type: "compression_applied", filesLoaded: Object.keys(fileMap).length, totalChars, tokenEstimate: Math.round(totalChars / 4) });

  // ─── Pass 4: Generate Edit Plan ───────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "editing", message: "Generating edit plan..." });

  const editSystemPrompt = `You are an expert code editor. The user has uploaded a codebase and wants you to make changes.
Your job is to produce a precise JSON edit plan.

Return ONLY valid JSON in this exact format:
{
  "summary": "Brief description of all changes made",
  "edits": [
    {
      "file": "exact/path/to/file.ts",
      "find": "exact string to find (must exist VERBATIM in the file)",
      "replace": "replacement string",
      "reason": "why this change is needed"
    }
  ],
  "newFiles": [
    {
      "file": "path/to/new-file.ts",
      "content": "full file content",
      "reason": "why this file is needed"
    }
  ]
}

CRITICAL RULES:
- "find" must be an EXACT verbatim substring from the file content shown — copy it character-for-character
- Include enough context in "find" to be unique (at least 2-3 lines)
- Do NOT invent code that isn't in the file
- Keep edits minimal and surgical — do not rewrite entire files unless explicitly asked
- "newFiles" is optional — only include if genuinely needed
- If a file was loaded with smart chunking (some sections not shown), reference functions by name to edit them
- For each edit, the "file" path must exactly match a FILE: header shown above`;

  const editUserPrompt = `## Instructions
${instruction}

## File Index (for reference — ${index.totalFiles} files total)
${index.indexText.slice(0, 5000)}

## File Contents (${Object.keys(fileMap).length} files loaded)
${fileContent}

Produce the edit plan as JSON.`;

  // v5.13: Auto-continuation for edit plan generation
  // If the LLM hits max_tokens mid-JSON, automatically continue
  const MAX_EDIT_CONTINUATIONS = 3;
  let editContent = "";
  let editMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: editSystemPrompt },
    { role: "user", content: editUserPrompt },
  ];

  for (let attempt = 0; attempt <= MAX_EDIT_CONTINUATIONS; attempt++) {
    const editResponse = await fetch(getFileEngineApiUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getFileEngineProviderHeaders() },
      body: JSON.stringify({
        model,
        messages: editMessages,
        max_tokens: getModelContextMaxOutput(model),
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!editResponse.ok) {
      const err = await editResponse.text();
      throw new Error(`DeepSeek API error in edit: ${editResponse.status}: ${err}`);
    }

    const editData = (await editResponse.json()) as any;
    const chunk = editData.choices?.[0]?.message?.content || "";
    editContent += chunk;

    // Check if the response was truncated
    const finishReason = editData.choices?.[0]?.finish_reason;
    if (finishReason !== "length") break; // Completed naturally

    // Response was truncated — try to continue
    if (attempt < MAX_EDIT_CONTINUATIONS) {
      emit?.({ type: "engine_phase", phase: "editing", message: `Edit plan truncated, continuing (${attempt + 1}/${MAX_EDIT_CONTINUATIONS})...` });
      editMessages = [
        { role: "system", content: editSystemPrompt },
        { role: "user", content: editUserPrompt },
        { role: "assistant", content: editContent },
        { role: "user", content: "Your JSON was cut off. Continue the JSON from EXACTLY where you left off. Do not restart or repeat." },
      ];
    }
  }

  if (!editContent) throw new Error("No edit plan returned from AI");

  // Attempt to repair truncated JSON if needed
  let parsableContent = editContent.trim();
  if (!parsableContent.endsWith("}")) {
    // Try to close the JSON structure
    const lastBrace = parsableContent.lastIndexOf("}");
    const lastBracket = parsableContent.lastIndexOf("]");
    if (lastBrace > 0 || lastBracket > 0) {
      // Find the last complete edit entry and close the structure
      const cutPoint = Math.max(lastBrace, lastBracket);
      parsableContent = parsableContent.slice(0, cutPoint + 1);
      // Close any remaining open structures
      const openBraces = (parsableContent.match(/\{/g) || []).length - (parsableContent.match(/\}/g) || []).length;
      const openBrackets = (parsableContent.match(/\[/g) || []).length - (parsableContent.match(/\]/g) || []).length;
      parsableContent += "]".repeat(Math.max(0, openBrackets)) + "}".repeat(Math.max(0, openBraces));
    }
  }
  editContent = parsableContent;

  // ─── Apply Edits ──────────────────────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "applying", message: "Applying edits to files..." });

  interface EditPlan {
    summary: string;
    edits: Array<{ file: string; find: string; replace: string; reason: string }>;
    newFiles?: Array<{ file: string; content: string; reason: string }>;
  }

  let plan: EditPlan;
  try {
    plan = JSON.parse(editContent);
  } catch {
    throw new Error("AI returned invalid JSON for edit plan");
  }

  const log: string[] = [];
  let editsApplied = 0;

  // Apply find/replace edits
  if (plan.edits && Array.isArray(plan.edits)) {
    for (const edit of plan.edits) {
      // Resolve the file path
      let targetPath = edit.file;
      if (!fileMap[targetPath]) {
        // Try to find it with fuzzy matching
        const match = Object.keys(fileMap).find(p => p.endsWith(edit.file) || p.includes(edit.file));
        if (match) targetPath = match;
        else {
          // Try loading from ZIP directly
          const zipMatch = allPaths.find(p => p.endsWith(edit.file) || p.includes(edit.file));
          if (zipMatch) {
            try {
              fileMap[zipMatch] = await zip.files[zipMatch].async("string");
              targetPath = zipMatch;
            } catch {
              log.push(`SKIP: ${edit.file} — file not found in archive`);
              continue;
            }
          } else {
            log.push(`SKIP: ${edit.file} — file not found in archive`);
            continue;
          }
        }
      }

      const currentContent = fileMap[targetPath];
      if (!currentContent.includes(edit.find)) {
        // Try with normalized whitespace
        const normalizedContent = currentContent.replace(/\r\n/g, "\n");
        const normalizedFind = edit.find.replace(/\r\n/g, "\n");
        if (normalizedContent.includes(normalizedFind)) {
          fileMap[targetPath] = normalizedContent.replace(normalizedFind, edit.replace);
          editsApplied++;
          log.push(`EDIT: ${targetPath} — ${edit.reason}`);
        } else {
          log.push(`FAIL: ${targetPath} — "find" string not found verbatim (${edit.find.slice(0, 50)}...)`);
        }
      } else {
        fileMap[targetPath] = currentContent.replace(edit.find, edit.replace);
        editsApplied++;
        log.push(`EDIT: ${targetPath} — ${edit.reason}`);
      }
    }
  }

  // Add new files
  if (plan.newFiles && Array.isArray(plan.newFiles)) {
    for (const newFile of plan.newFiles) {
      // Determine the correct path prefix
      const existingPath = allPaths[0] || "";
      const prefix = existingPath.includes("/") ? existingPath.split("/").slice(0, -1).join("/") + "/" : "";
      const fullPath = newFile.file.startsWith(prefix) ? newFile.file : prefix + newFile.file;
      fileMap[fullPath] = newFile.content;
      editsApplied++;
      log.push(`NEW: ${fullPath} — ${newFile.reason}`);
    }
  }

  // ─── Validate Edits (v5.13 truncation detection) ─────────────────────────
  const { validateEditCompleteness } = await import("./truncationDetector.js");
  for (const [path, content] of Object.entries(fileMap)) {
    // Only validate files that were actually edited (compare with original)
    const originalFile = zip.files[path];
    if (!originalFile || originalFile.dir) continue;
    try {
      const originalContent = await originalFile.async("string");
      if (originalContent === content) continue; // Not edited
      const validation = validateEditCompleteness(originalContent, content, path);
      if (!validation.isComplete) {
        log.push(`WARN: ${path} — ${validation.issue} (edit may be incomplete)`);
      }
    } catch { /* skip validation for unreadable files */ }
  }

  // ─── Repack ZIP ─────────────────────────────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "repacking", message: `Repacking ZIP with ${editsApplied} changes...` }); // Start with the original ZIP and apply changes
  const newZip = await JSZip.loadAsync(zipBuffer);

  // Apply all file changes
  for (const [path, content] of Object.entries(fileMap)) {
    newZip.file(path, content);
  }

  const editedBuffer = await newZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const editedZip = editedBuffer.toString("base64");

  emit?.({ type: "edit_complete", editsApplied, summary: plan.summary });

  return {
    editedZip,
    summary: plan.summary,
    editsApplied,
    log,
  };
}

/**
 * Streaming wrapper for multi-pass analysis.
 * Sends SSE events for each phase, then streams the final analysis token-by-token.
 */
export async function streamMultiPassAnalysis(
  base64Zip: string,
  instruction: string,
  apiKey: string,
  model: string,
  res: any // Express Response
): Promise<void> {
  const emit: SSEEmitter = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    // Run passes 1-3 (index, select, compress)
    const zipBuffer = Buffer.from(base64Zip, "base64");
    const zip = await JSZip.loadAsync(zipBuffer);

    // ZIP bomb protection
    let fileCount = 0;
    let totalUncompressed = 0;
    for (const [path, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      if (path.includes("..") || path.startsWith("/")) throw new Error(`Unsafe path: ${path}`);
      fileCount++;
      if (fileCount > 2000) throw new Error("ZIP too large (>2000 files)");
      totalUncompressed += (file as any)._data?.uncompressedSize ?? 0;
      if (totalUncompressed > 100 * 1024 * 1024) throw new Error("ZIP exceeds 100MB");
    }

    // Pass 1
    emit({ type: "engine_phase", phase: "indexing", message: "Building file index..." });
    const index = await buildFileIndex(zip);
    emit({
      type: "index_built",
      fileCount: index.totalFiles,
      totalSize: `${Math.round(index.totalSize / 1024)}KB`,
    });

    // Pass 2 — v5.21: Load ALL text files for projects up to 500 files
    emit({ type: "engine_phase", phase: "selecting", message: "Loading all project files (full codebase mode)..." });
    let selectedPaths: string[];
    if (index.totalFiles <= 500) {
      selectedPaths = index.entries.filter(e => TEXT_EXTS.test(e.path)).map(e => e.path);
      emit({ type: "files_selected", count: selectedPaths.length, reason: "Full codebase mode — all text files" });
    } else {
      selectedPaths = await selectRelevantFiles(index, instruction, apiKey, model);
      emit({ type: "files_selected", count: selectedPaths.length, paths: selectedPaths.slice(0, 10), reason: "AI-selected (500+ files)" });
    }

    // Pass 3 — v5.21: Load all files, track overflow for chunked analysis
    emit({ type: "engine_phase", phase: "loading", message: `Loading ${selectedPaths.length} files (full codebase mode)...` });
    const allPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir);
    const { content: fileContent, stats } = await loadAndCompressFiles(zip, selectedPaths, allPaths);
    const tokenEstimate = Math.round(fileContent.length / 4);
    emit({ type: "compression_applied", filesLoaded: stats.loaded, tokenEstimate, overflowFiles: stats.overflowPaths.length });

    // v5.21: If there are overflow files, analyze them in additional chunked passes
    let overflowAnalysis = "";
    if (stats.overflowed && stats.overflowPaths.length > 0) {
      emit({ type: "engine_phase", phase: "chunked_overflow", message: `Analyzing ${stats.overflowPaths.length} additional files in chunks...` });
      
      // Process overflow files in chunks of MAX_CONTEXT_CHARS
      const overflowChunks: string[][] = [];
      let currentChunk: string[] = [];
      let currentChunkSize = 0;
      
      for (const path of stats.overflowPaths) {
        const file = zip.files[path];
        if (!file || file.dir) continue;
        try {
          const content = await file.async("string");
          const { compressed } = compressFile(content, path);
          const chunkStr = `\nFILE: ${path}\n${compressed}`;
          if (currentChunkSize + chunkStr.length > MAX_CONTEXT_CHARS && currentChunk.length > 0) {
            overflowChunks.push(currentChunk);
            currentChunk = [chunkStr];
            currentChunkSize = chunkStr.length;
          } else {
            currentChunk.push(chunkStr);
            currentChunkSize += chunkStr.length;
          }
        } catch { /* skip */ }
      }
      if (currentChunk.length > 0) overflowChunks.push(currentChunk);

      // Analyze each overflow chunk
      const chunkSummaries: string[] = [];
      for (let i = 0; i < overflowChunks.length; i++) {
        emit({ type: "engine_phase", phase: "chunked_overflow", message: `Analyzing overflow chunk ${i + 1}/${overflowChunks.length}...` });
        const chunkContent = overflowChunks[i].join("\n");
        try {
          const chunkResp = await fetch(getFileEngineApiUrl(), {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getFileEngineProviderHeaders() },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: "You are a code analyst. Analyze these additional files concisely. Focus on key findings, issues, and how they relate to the overall project." },
                { role: "user", content: `Instruction: ${instruction}\n\nAdditional files (chunk ${i + 1}/${overflowChunks.length}):\n${chunkContent}` },
              ],
              max_tokens: 4000,
              temperature: 0.3,
            }),
          });
          if (chunkResp.ok) {
            const chunkData = (await chunkResp.json()) as any;
            const summary = chunkData.choices?.[0]?.message?.content || "";
            chunkSummaries.push(summary);
          }
        } catch { /* skip failed chunks */ }
      }
      if (chunkSummaries.length > 0) {
        overflowAnalysis = `\n\n## Additional Files Analysis (${stats.overflowPaths.length} files in ${overflowChunks.length} chunks)\n${chunkSummaries.join("\n\n")}`;
      }
    }

    // Pass 4: Stream the analysis with auto-continuation (v5.13)
    emit({ type: "engine_phase", phase: "analyzing", message: "Streaming analysis..." });

    const systemPrompt = `You are Andromeda, an expert AI code analyst and autonomous agent.
You have been given a COMPLETE codebase to analyze — ALL files have been loaded in full (no truncation).

Produce a thorough, structured analysis. Be specific — reference actual file paths, function names, and line-level issues.
Your analysis should be actionable and prioritized by severity.
Do NOT truncate your response — if you have more to say, keep going.
You have the ENTIRE codebase available — analyze ALL files comprehensively.

Context: You are analyzing ${index.totalFiles} files total, with ${stats.loaded} loaded in full (${tokenEstimate} tokens). No files were truncated or omitted.`;

    const overflowSection = overflowAnalysis ? `\n\n## Overflow Analysis (files that didn't fit in primary context)\n${overflowAnalysis}` : "";

    const userPrompt = `## Instruction
${instruction}

## Project Index (${index.totalFiles} files)
${index.indexText.slice(0, 50000)}

## Full File Contents (${stats.loaded} files loaded directly${stats.overflowed ? `, ${stats.overflowPaths.length} analyzed in chunks` : ""})
${fileContent}${overflowSection}`;

    // Auto-continuation loop: if the LLM hits max_tokens, automatically continue
    const MAX_CONTINUATIONS = 4;
    let continuationCount = 0;
    let fullAnswer = "";
    let messages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    while (continuationCount <= MAX_CONTINUATIONS) {
      const streamResponse = await fetch(getFileEngineApiUrl(), {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getFileEngineProviderHeaders() },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: getModelContextMaxOutput(model),
          temperature: 0.3,
          stream: true,
        }),
      });

      if (!streamResponse.ok) {
        const err = await streamResponse.text();
        throw new Error(`DeepSeek API error: ${streamResponse.status}: ${err}`);
      }

      let wasTruncated = false;
      let chunkAnswer = "";

      // Parse SSE stream from DeepSeek and forward as deltas
      const reader = streamResponse.body as any;
      if (reader && reader[Symbol.asyncIterator]) {
        let buffer = "";
        for await (const chunk of reader) {
          buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                emit({ type: "delta", content: delta });
                chunkAnswer += delta;
              }
              if (parsed.choices?.[0]?.finish_reason === "length") {
                wasTruncated = true;
              }
            } catch { /* skip malformed SSE lines */ }
          }
        }
      } else {
        // Fallback for non-streaming response
        const data = (await streamResponse.json()) as any;
        const content = data.choices?.[0]?.message?.content || "";
        emit({ type: "delta", content });
        chunkAnswer = content;
        if (data.choices?.[0]?.finish_reason === "length") wasTruncated = true;
      }

      fullAnswer += chunkAnswer;

      if (!wasTruncated) {
        // Response completed naturally
        emit({ type: "done", fullAnswer });
        break;
      }

      // Auto-continue: append the partial response and ask to continue
      continuationCount++;
      if (continuationCount > MAX_CONTINUATIONS) {
        emit({ type: "truncated" });
        emit({ type: "done", fullAnswer });
        break;
      }

      emit({ type: "engine_phase", phase: "continuing", message: `Auto-continuing (${continuationCount}/${MAX_CONTINUATIONS})...` });

      // Build continuation messages
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
        { role: "assistant", content: fullAnswer },
        { role: "user", content: "Continue your analysis from where you left off. Do not repeat what you've already said." },
      ];
    }
  } catch (err: any) {
    emit({ type: "error", message: err.message || "Multi-pass analysis failed" });
  }
}



