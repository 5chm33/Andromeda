/**
 * multiFileProposalPlanner.ts — v1.0 (Tier 2 Enhancement #4)
 *
 * Multi-File Atomic Proposal Planner: Generates coordinated improvement proposals
 * that span 2-3 files atomically. When a change to one file requires corresponding
 * changes in caller files (e.g., function signature changes, new exports, interface
 * updates), this planner generates a single proposal that covers all affected files.
 *
 * Architecture:
 *   1. planMultiFileImprovement() asks the LLM to identify a cross-file improvement
 *      opportunity given a primary file and its import graph context
 *   2. The LLM returns a primary change + array of secondary changes
 *   3. The result is stored as a single ImprovementProposal with secondaryChanges populated
 *   4. The existing applyProposal() path already handles secondaryChanges atomically (v6.29)
 *
 * This is distinct from single-file proposals: the planner explicitly asks the LLM
 * to think about cross-file consistency rather than just improving one file in isolation.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MultiFileProposalPlan {
  title: string;
  rationale: string;
  category: "performance" | "reliability" | "security" | "readability" | "feature";
  impact: "high" | "medium" | "low";
  confidence: number;
  primaryFile: string;
  primaryOriginalSnippet: string;
  primaryProposedSnippet: string;
  secondaryChanges: Array<{
    targetFile: string;
    originalSnippet: string;
    proposedSnippet: string;
    reason: string;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveServerFile(filename: string): string | null {
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(serverDir, filename),
    path.join(serverDir, path.basename(filename)),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function readFileSafe(filePath: string, maxChars = 8000): string {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.length > maxChars ? content.slice(0, maxChars) + "\n// ... (truncated)" : content;
  } catch {
    return "";
  }
}

// ─── Main planner ─────────────────────────────────────────────────────────────

/**
 * Plan a multi-file improvement starting from a primary file.
 * Returns null if no cross-file opportunity is found or if the LLM fails.
 */
export async function planMultiFileImprovement(
  primaryFile: string,
  relatedFiles: string[]
): Promise<MultiFileProposalPlan | null> {
  try {
    const primaryPath = resolveServerFile(primaryFile);
    if (!primaryPath) {
      console.warn(`[MultiFilePlanner] Primary file not found: ${primaryFile}`);
      return null;
    }

    const primaryContent = readFileSafe(primaryPath);
    if (!primaryContent) return null;

    // Read related files (limit to 2 to keep prompt size manageable)
    const relatedContents: Array<{ file: string; content: string }> = [];
    for (const rf of relatedFiles.slice(0, 2)) {
      const rfPath = resolveServerFile(rf);
      if (rfPath) {
        const content = readFileSafe(rfPath, 4000);
        if (content) relatedContents.push({ file: path.basename(rf), content });
      }
    }

    if (relatedContents.length === 0) {
      console.log(`[MultiFilePlanner] No related files available for ${primaryFile}`);
      return null;
    }

    const { simpleChatCompletion } = await import("./llmProvider.js");

    const relatedSection = relatedContents
      .map(r => `\n### Related file: ${r.file}\n\`\`\`typescript\n${r.content}\n\`\`\``)
      .join("\n");

    const messages = [
      {
        role: "system" as const,
        content: `You are an expert TypeScript software engineer performing a MULTI-FILE code improvement.
You will receive a primary file and 1-2 related files that import from or are imported by the primary file.
Your task: identify ONE improvement that requires coordinated changes across these files.

Examples of good multi-file improvements:
- Extract a utility function from the primary file and update all callers
- Add a new optional parameter to a function and update all call sites
- Improve an interface/type definition and update all implementations
- Add error handling to a function and update all callers to handle the new error

CRITICAL: Return ONLY a JSON object with this exact structure:
{
  "title": "short title (max 10 words)",
  "rationale": "2 sentences explaining why this cross-file change improves the codebase",
  "category": "one of: performance, reliability, security, readability, feature",
  "impact": "one of: high, medium, low",
  "confidence": 0.0-1.0,
  "primaryFile": "filename.ts",
  "primaryOriginalSnippet": "EXACT verbatim lines from primary file to replace (max 15 lines)",
  "primaryProposedSnippet": "replacement code (same approximate length)",
  "secondaryChanges": [
    {
      "targetFile": "other-file.ts",
      "originalSnippet": "EXACT verbatim lines from that file to replace (max 10 lines)",
      "proposedSnippet": "replacement code",
      "reason": "one sentence why this file needs to change"
    }
  ]
}

If no meaningful cross-file improvement exists, return: {"noOpportunity": true}
Keep ALL snippets SHORT and surgical. Do NOT rewrite entire files.`,
      },
      {
        role: "user" as const,
        content: `Primary file: ${path.basename(primaryFile)}\n\`\`\`typescript\n${primaryContent}\n\`\`\`${relatedSection}\n\nIdentify the best coordinated improvement across these files. Return ONLY valid JSON.`,
      },
    ];

    const rawContent = await simpleChatCompletion(messages, {
      maxTokens: 3000,
      temperature: 0.3,
      providerId: "deepseek",
    });

    if (!rawContent) return null;

    // Parse response
    let parsed: any = null;
    try {
      const cleaned = rawContent.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch { return null; }
      } else {
        return null;
      }
    }

    if (!parsed || parsed.noOpportunity) {
      console.log(`[MultiFilePlanner] No cross-file opportunity found for ${primaryFile}`);
      return null;
    }

    // Validate required fields
    if (!parsed.title || !parsed.primaryOriginalSnippet || !parsed.primaryProposedSnippet) {
      console.warn(`[MultiFilePlanner] Response missing required fields for ${primaryFile}`);
      return null;
    }

    if (!parsed.secondaryChanges || parsed.secondaryChanges.length === 0) {
      console.log(`[MultiFilePlanner] No secondary changes in response for ${primaryFile}`);
      return null;
    }

    // Normalize confidence
    let confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.6;
    if (confidence > 1.0) confidence = confidence / 100;
    confidence = Math.max(0, Math.min(1, confidence));

    const plan: MultiFileProposalPlan = {
      title: parsed.title,
      rationale: parsed.rationale || "Multi-file improvement",
      category: parsed.category || "readability",
      impact: parsed.impact || "medium",
      confidence,
      primaryFile: path.basename(primaryFile),
      primaryOriginalSnippet: parsed.primaryOriginalSnippet,
      primaryProposedSnippet: parsed.primaryProposedSnippet,
      secondaryChanges: (parsed.secondaryChanges || []).map((sc: any) => ({
        targetFile: path.basename(sc.targetFile || sc.file || ""),
        originalSnippet: sc.originalSnippet || "",
        proposedSnippet: sc.proposedSnippet || "",
        reason: sc.reason || "",
      })).filter((sc: any) => sc.targetFile && sc.originalSnippet && sc.proposedSnippet),
    };

    console.log(`[MultiFilePlanner] Plan created: "${plan.title}" — ${plan.secondaryChanges.length} secondary change(s)`);
    return plan;
  } catch (err) {
    console.warn("[MultiFilePlanner] planMultiFileImprovement failed:", (err as Error).message);
    return null;
  }
}

/**
 * Convert a MultiFileProposalPlan into an ImprovementProposal and save it.
 * Returns the proposal ID if successful, null otherwise.
 */
export async function submitMultiFileProposal(plan: MultiFileProposalPlan): Promise<string | null> {
  try {
    const { analyzeAndPropose } = await import("./selfImprove.js");
    // We can't call analyzeAndPropose directly with a plan, so we use the proposal store API
    const { listProposals } = await import("./selfImprove.js");

    // Build the proposal directly using the store
    const primaryPath = resolveServerFile(plan.primaryFile);
    if (!primaryPath) return null;

    const originalContent = fs.readFileSync(primaryPath, "utf-8");
    let proposedContent = originalContent;
    let snippetApplied = false;

    if (originalContent.includes(plan.primaryOriginalSnippet)) {
      proposedContent = originalContent.replace(plan.primaryOriginalSnippet, plan.primaryProposedSnippet);
      snippetApplied = true;
    }

    if (!snippetApplied) {
      console.warn(`[MultiFilePlanner] Primary snippet not found in ${plan.primaryFile} — skipping`);
      return null;
    }

    // Import proposal store functions
    const selfImprove = await import("./selfImprove.js");
    const proposals = selfImprove.listProposals();

    // Check for duplicate
    const existingTitle = proposals.find(p => p.title === plan.title && p.targetFile === plan.primaryFile);
    if (existingTitle) {
      console.log(`[MultiFilePlanner] Duplicate proposal skipped: "${plan.title}"`);
      return null;
    }

    // Use the internal proposal creation path via a special marker
    // We create the proposal object and inject it via the store
    const workspaceDir = path.resolve(__dirname, "..", "workspace");
    const storePath = path.join(workspaceDir, ".andromeda_proposals.json");

    let store: { proposals: any[] } = { proposals: [] };
    try {
      if (fs.existsSync(storePath)) {
        store = JSON.parse(fs.readFileSync(storePath, "utf-8"));
      }
    } catch { /* ignore */ }

    const proposalId = `prop_multi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const proposal = {
      id: proposalId,
      targetFile: plan.primaryFile,
      title: `[Multi-file] ${plan.title}`,
      rationale: plan.rationale,
      category: plan.category,
      impact: plan.impact,
      confidence: plan.confidence,
      originalSnippet: plan.primaryOriginalSnippet,
      proposedSnippet: plan.primaryProposedSnippet,
      originalContent,
      proposedContent,
      secondaryChanges: plan.secondaryChanges,
      createdAt: Date.now(),
      status: "pending",
      _multiFile: true,
      _secondaryFileCount: plan.secondaryChanges.length,
    };

    store.proposals.push(proposal);
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");

    console.log(`[MultiFilePlanner] Submitted multi-file proposal ${proposalId}: "${plan.title}"`);
    return proposalId;
  } catch (err) {
    console.warn("[MultiFilePlanner] submitMultiFileProposal failed:", (err as Error).message);
    return null;
  }
}

/**
 * Find files that are likely related to a given primary file via import analysis.
 * Returns up to 3 related filenames.
 */
export async function findRelatedFiles(primaryFile: string): Promise<string[]> {
  try {
    const { findSymbolUsages, getExportedSymbols } = await import("./importGraph.js");
    const primaryPath = resolveServerFile(primaryFile);
    if (!primaryPath) return [];

    const symbols = await getExportedSymbols(primaryPath);
    const relatedSet = new Set<string>();

    for (const sym of symbols.slice(0, 5)) {
      const usages = await findSymbolUsages(primaryPath, sym);
      for (const u of usages.slice(0, 3)) {
        const basename = path.basename(u);
        if (basename !== path.basename(primaryFile) && !basename.includes(".test.")) {
          relatedSet.add(basename);
        }
      }
    }

    return Array.from(relatedSet).slice(0, 3);
  } catch {
    return [];
  }
}
