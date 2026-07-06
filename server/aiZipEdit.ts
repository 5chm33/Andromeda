/**
 * aiZipEdit.ts — ZIP File Editing Capability
 * Andromeda v6.19 — extracted from ai.ts (was lines 1012-1225)
 *
 * LLM-driven file editing within ZIP archives. Used for self-modification
 * when the agent needs to edit its own source files packaged as a ZIP.
 *
 * The LLM analyzes the ZIP contents, proposes a structured edit plan,
 * and this module applies the edits with full integrity verification.
 */

import JSZip from "jszip";
import { backgroundSimpleCompletion } from "./llmProvider.js";
import { createLogger } from "./logger.js";

const log = createLogger("aiZipEdit");

// ─── Types ────────────────────────────────────────────────────────────────────

interface EditInstruction {
  file: string;
  find: string;
  replace: string;
  reason: string;
}

interface EditPlan {
  summary: string;
  edits: EditInstruction[];
  newFiles?: { file: string; content: string; reason: string }[];
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Edit files within a ZIP archive using LLM-generated instructions.
 * Returns the modified ZIP as a base64 string.
 */
export async function editFilesInZip(
  base64Zip: string,
  fileName: string,
  instructions: string
): Promise<{ base64Zip: string; summary: string; editsApplied: number; errors: string[] }> {
  const errors: string[] = [];

  // Decode and load the ZIP
  const zipBuffer = Buffer.from(base64Zip, "base64");
  const zip = await JSZip.loadAsync(zipBuffer);

  // Build a manifest of ZIP contents for the LLM
  const manifest: string[] = [];
  zip.forEach((relativePath, file) => {
    if (!file.dir) {
      manifest.push(relativePath);
    }
  });

  // Ask LLM to generate an edit plan
  const systemPrompt = `You are a code editor. Given a ZIP file manifest and edit instructions, generate a structured edit plan.
Return ONLY valid JSON, no markdown.

Format:
{
  "summary": "Brief description of changes",
  "edits": [
    { "file": "path/in/zip.ts", "find": "exact text to find", "replace": "replacement text", "reason": "why" }
  ],
  "newFiles": [
    { "file": "new/file.ts", "content": "full file content", "reason": "why" }
  ]
}`;

  const MAX_MANIFEST_ENTRIES = 50;

  const userPrompt = `ZIP file: ${fileName}
Files in ZIP:
${manifest.slice(0, MAX_MANIFEST_ENTRIES).join("\n")}${manifest.length > MAX_MANIFEST_ENTRIES ? `\n... and ${manifest.length - MAX_MANIFEST_ENTRIES} more` : ""}

Instructions: ${instructions}`;

  let plan: EditPlan = { summary: "No changes", edits: [], newFiles: [] };
  try {
    const response = await backgroundSimpleCompletion([{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]);
    const cleaned = response.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    plan = JSON.parse(cleaned);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    errors.push(`Failed to generate edit plan: ${errMsg}`);
    log.error("Edit plan generation failed:", errMsg);
    return { base64Zip, summary: "Failed to generate edit plan", editsApplied: 0, errors };
  }

  let editsApplied = 0;

  // Apply edits
  for (const edit of plan.edits ?? []) {
    const file = zip.file(edit.file);
    if (!file) {
      errors.push(`File not found in ZIP: ${edit.file}`);
      continue;
    }

    try {
      const content = await file.async("string");
      if (content == null || !content.includes(edit.find)) {
        errors.push(`Find text not found in ${edit.file}: "${edit.find.slice(0, 50)}..."`);
        continue;
      }
      const updated = content.replace(edit.find, edit.replace);
      zip.file(edit.file, updated);
      editsApplied++;
      log.info(`Applied edit to ${edit.file}: ${edit.reason}`);
    } catch (err) {
      errors.push(`Failed to edit ${edit.file}: ${err}`);
    }
  }

  // Add new files
  for (const newFile of plan.newFiles ?? []) {
    zip.file(newFile.file, newFile.content);
    editsApplied++;
    log.info(`Added new file ${newFile.file}: ${newFile.reason}`);
  }

  // Re-encode the ZIP
  const updatedBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const updatedBase64 = updatedBuffer.toString("base64");

  return {
    base64Zip: updatedBase64,
    summary: plan.summary,
    editsApplied,
    errors,
  };
}
