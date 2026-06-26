/**
 * knowledgeBaseConsolidation.ts — v1.0 (Tier 3 Enhancement #7)
 *
 * Cross-Session Knowledge Base Consolidation: A weekly LLM-driven process that
 * operates on the selfKnowledgeBase (architecture decisions, learnings, known issues).
 *
 * This is distinct from memoryConsolidation.ts which handles runtime memory scoring/eviction.
 * This module handles the *persistent knowledge base* — the long-term institutional memory
 * that Andromeda builds about itself over time.
 *
 * Process:
 *   1. Reads selfKnowledgeBase entries (architecture decisions, learnings, known issues)
 *   2. Asks the LLM to identify redundant/outdated entries and distill new insights
 *   3. Promotes high-confidence patterns to andromeda-constitution.json
 *   4. Archives low-signal entries to data/archived_kb_entries.json
 *   5. Writes a consolidated knowledge base back to disk
 *
 * Trigger: Runs automatically once per week via initDaemons.ts (12h initial delay).
 * Manual trigger: POST /api/admin/consolidate-knowledge-base
 */

import fs from "fs";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KBConsolidationResult {
  entriesBefore: number;
  entriesAfter: number;
  redundantMerged: number;
  promotedToConstitution: number;
  archived: number;
  newInsights: string[];
  consolidatedAt: number;
  durationMs: number;
}

interface KBConsolidationState {
  lastConsolidatedAt: number;
  history: KBConsolidationResult[];
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), "data");
const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");
const KB_STATE_PATH = path.join(DATA_DIR, "kb_consolidation_state.json");
const KB_ARCHIVE_PATH = path.join(DATA_DIR, "archived_kb_entries.json");
const CONSTITUTION_PATH = path.resolve(process.cwd(), "andromeda-constitution.json");
const KB_PATH = path.join(WORKSPACE_DIR, ".andromeda_knowledge_base.json");

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ─── State ────────────────────────────────────────────────────────────────────

function loadState(): KBConsolidationState {
  try {
    if (fs.existsSync(KB_STATE_PATH)) return JSON.parse(fs.readFileSync(KB_STATE_PATH, "utf-8"));
  } catch { /* ignore */ }
  return { lastConsolidatedAt: 0, history: [] };
}

function saveState(state: KBConsolidationState): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (state.history.length > 52) state.history = state.history.slice(-52);
    fs.writeFileSync(KB_STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
  } catch { /* non-fatal */ }
}

// ─── Knowledge base I/O ───────────────────────────────────────────────────────

function readKB(): any | null {
  try {
    if (!fs.existsSync(KB_PATH)) return null;
    return JSON.parse(fs.readFileSync(KB_PATH, "utf-8"));
  } catch { return null; }
}

function writeKB(kb: any): void {
  if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  fs.writeFileSync(KB_PATH, JSON.stringify(kb, null, 2), "utf-8");
}

function readConstitution(): any {
  try {
    if (fs.existsSync(CONSTITUTION_PATH)) return JSON.parse(fs.readFileSync(CONSTITUTION_PATH, "utf-8"));
  } catch { /* ignore */ }
  return { version: "1.0", patterns: [], rules: [] };
}

function writeConstitution(c: any): void {
  try { fs.writeFileSync(CONSTITUTION_PATH, JSON.stringify(c, null, 2), "utf-8"); } catch { /* non-fatal */ }
}

function archiveEntries(entries: any[], reason: string): void {
  try {
    let archive: any[] = [];
    try { if (fs.existsSync(KB_ARCHIVE_PATH)) archive = JSON.parse(fs.readFileSync(KB_ARCHIVE_PATH, "utf-8")); } catch { /* ignore */ }
    archive.push({ archivedAt: Date.now(), reason, count: entries.length, entries });
    if (archive.length > 100) archive = archive.slice(-100);
    fs.writeFileSync(KB_ARCHIVE_PATH, JSON.stringify(archive, null, 2), "utf-8");
  } catch { /* non-fatal */ }
}

// ─── Main consolidation ───────────────────────────────────────────────────────

// ─── Main consolidation helpers ──────────────────────────────────────────────

function buildKBSummaries(allEntries: any[], archDecisions: any[], knownIssues: any[], now: number): any[] {
  return allEntries.slice(0, 80).map((e: any, i: number) => ({
    index: i,
    section: i < archDecisions.length ? "architecture" : i < archDecisions.length + knownIssues.length ? "issue" : "learning",
    title: (e.title || e.description || e.pattern || "").slice(0, 100),
    content: (e.content || e.description || e.rationale || e.context || "").slice(0, 250),
    confidence: typeof e.confidence === "number" ? e.confidence : typeof e.successRate === "number" ? e.successRate : 0.5,
    age_days: e.createdAt ? Math.floor((now - e.createdAt) / 86400000) : 0,
  }));
}

function parseKBAnalysis(rawContent: string): any | null {
  try {
    const cleaned = rawContent.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(cleaned);
  } catch {
    const match = rawContent.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { return null; } }
    return null;
  }
}

function applyRedundancyRemovals(analysis: any, allEntries: any[]): { indicesToRemove: Set<number>; redundantMerged: number; archived: number } {
  const indicesToRemove = new Set<number>();
  let redundantMerged = 0;
  let archived = 0;
  for (const group of (analysis.redundantGroups || [])) {
    if (Array.isArray(group) && group.length > 1) {
      for (const idx of group.slice(1)) {
        if (typeof idx === "number" && idx < allEntries.length) { indicesToRemove.add(idx); redundantMerged++; }
      }
    }
  }
  for (const idx of (analysis.lowSignalIndices || [])) {
    if (typeof idx === "number" && idx < allEntries.length) { indicesToRemove.add(idx); archived++; }
  }
  return { indicesToRemove, redundantMerged, archived };
}

function rebuildKBSections(
  analysis: any,
  archDecisions: any[], knownIssues: any[], learnings: any[],
  indicesToRemove: Set<number>, now: number
): { newArchDecisions: any[]; newKnownIssues: any[]; newLearnings: any[] } {
  const archLen = archDecisions.length;
  const issLen = knownIssues.length;
  const newArchDecisions = archDecisions.filter((_, i) => !indicesToRemove.has(i));
  const newKnownIssues = knownIssues.filter((_, i) => !indicesToRemove.has(archLen + i));
  const newLearnings = learnings.filter((_, i) => !indicesToRemove.has(archLen + issLen + i));
  for (const ce of (analysis.consolidatedEntries || [])) {
    if (!ce.title || !ce.content) continue;
    const entry = { id: `consolidated_${now}_${Math.random().toString(36).slice(2, 6)}`, title: ce.title, content: ce.content, confidence: typeof ce.confidence === "number" ? ce.confidence : 0.8, category: "consolidated", createdAt: now };
    if (ce.section === "architecture") newArchDecisions.push(entry);
    else if (ce.section === "issue") newKnownIssues.push(entry);
    else newLearnings.push(entry);
  }
  for (const insight of ((analysis.newInsights || []).filter((s: any) => typeof s === "string"))) {
    newLearnings.push({ id: `insight_${now}_${Math.random().toString(36).slice(2, 6)}`, title: insight.slice(0, 80), content: insight, confidence: 0.75, category: "insight", createdAt: now });
  }
  return { newArchDecisions, newKnownIssues, newLearnings };
}

function promoteToConstitution(analysis: any): number {
  const constitution = readConstitution();
  let count = 0;
  for (const pattern of (analysis.constitutionPatterns || [])) {
    if (typeof pattern !== "string" || pattern.length < 5) continue;
    if (!constitution.patterns) constitution.patterns = [];
    if (!constitution.patterns.find((p: string) => p === pattern)) {
      constitution.patterns.push(pattern);
      count++;
    }
  }
  if (count > 0) writeConstitution(constitution);
  return count;
}

export async function runKBConsolidation(force = false): Promise<KBConsolidationResult | null> {
  const state = loadState();
  const now = Date.now();
  if (!force && now - state.lastConsolidatedAt < ONE_WEEK_MS) {
    const daysLeft = Math.ceil((ONE_WEEK_MS - (now - state.lastConsolidatedAt)) / (24 * 60 * 60 * 1000));
    console.log(`[KBConsolidation] Next run in ${daysLeft} day(s).`);
    return null;
  }
  const startMs = Date.now();
  console.log("[KBConsolidation] Starting weekly knowledge base consolidation...");
  const kb = readKB();
  if (!kb) { console.log("[KBConsolidation] No knowledge base found — skipping"); return null; }
  const archDecisions: any[] = kb.architectureDecisions || [];
  const knownIssues: any[] = kb.knownIssues || [];
  const learnings: any[] = kb.learnings || [];
  const allEntries = [...archDecisions, ...knownIssues, ...learnings];
  const entriesBefore = allEntries.length;
  if (entriesBefore < 5) { console.log(`[KBConsolidation] Only ${entriesBefore} entries — too few to consolidate`); return null; }
  const summaries = buildKBSummaries(allEntries, archDecisions, knownIssues, now);
  try {
    const { simpleChatCompletion } = await import("./llmProvider.js");
    const prompt = `You are an AI knowledge base curator for an autonomous coding agent called Andromeda.
You will receive a list of knowledge entries from Andromeda's long-term memory.

Analyze these entries and return a JSON object with exactly these fields:
{
  "redundantGroups": [[0, 3], [1, 5, 8]],
  "lowSignalIndices": [2, 9],
  "constitutionPatterns": ["never use eval()", "always wrap JSON.parse in try/catch"],
  "newInsights": ["Andromeda performs best when...", "The most common failure mode is..."],
  "consolidatedEntries": [{"title": "...", "content": "...", "section": "learning", "confidence": 0.85}]
}

Rules:
- redundantGroups: groups of indices that say the same thing (keep first, remove rest)
- lowSignalIndices: entries that are too vague, outdated (>30 days old with low confidence), or superseded
- constitutionPatterns: code patterns that should be permanently forbidden (short, specific strings)
- newInsights: 2-4 high-level lessons distilled from the full set
- consolidatedEntries: merged versions of redundant groups (one entry per group)

Return ONLY valid JSON. No markdown, no explanation.`;
    const rawContent = await simpleChatCompletion(
      [{ role: "system" as const, content: prompt }, { role: "user" as const, content: `Entries (${summaries.length} of ${entriesBefore} total):\n${JSON.stringify(summaries, null, 2)}` }],
      { maxTokens: 2500, temperature: 0.15, providerId: "deepseek" }
    );
    if (!rawContent) { console.warn("[KBConsolidation] LLM returned empty response"); return null; }
    const analysis = parseKBAnalysis(rawContent);
    if (!analysis) return null;
    const { indicesToRemove, redundantMerged, archived } = applyRedundancyRemovals(analysis, allEntries);
    if (indicesToRemove.size > 0) archiveEntries(allEntries.filter((_, i) => indicesToRemove.has(i)), "Weekly KB consolidation");
    const { newArchDecisions, newKnownIssues, newLearnings } = rebuildKBSections(analysis, archDecisions, knownIssues, learnings, indicesToRemove, now);
    const promotedToConstitution = promoteToConstitution(analysis);
    const newInsights: string[] = (analysis.newInsights || []).filter((s: any) => typeof s === "string");
    writeKB({ ...kb, architectureDecisions: newArchDecisions, knownIssues: newKnownIssues, learnings: newLearnings, lastConsolidatedAt: now });
    const entriesAfter = newArchDecisions.length + newKnownIssues.length + newLearnings.length;
    const result: KBConsolidationResult = { entriesBefore, entriesAfter, redundantMerged, promotedToConstitution, archived, newInsights, consolidatedAt: now, durationMs: Date.now() - startMs };
    state.lastConsolidatedAt = now;
    state.history.push(result);
    saveState(state);
    console.log(`[KBConsolidation] Done in ${result.durationMs}ms: ${entriesBefore}→${entriesAfter} entries | merged=${redundantMerged} archived=${archived} constitution+=${promotedToConstitution} insights=${newInsights.length}`);
    return result;
  } catch (err) {
    console.warn("[KBConsolidation] Failed:", (err as Error).message);
    return null;
  }
}


export function isKBConsolidationDue(): boolean {
  const state = loadState();
  return Date.now() - state.lastConsolidatedAt >= ONE_WEEK_MS;
}

export function getKBConsolidationSummary(): string {
  const state = loadState();
  if (state.history.length === 0) return "No KB consolidation has run yet.";
  const last = state.history[state.history.length - 1];
  const date = new Date(last.consolidatedAt).toISOString().slice(0, 10);
  return `Last: ${date} | ${last.entriesBefore}→${last.entriesAfter} entries | merged=${last.redundantMerged} archived=${last.archived} constitution+=${last.promotedToConstitution}`;
}

/**
 * Start the weekly KB consolidation daemon.
 * Initial delay: 12 hours (avoids startup load).
 * Check interval: 6 hours.
 */
export function startKBConsolidationDaemon(): void {
  const INITIAL_DELAY_MS = 12 * 60 * 60 * 1000;
  const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

  setTimeout(() => {
    if (isKBConsolidationDue()) {
      runKBConsolidation().catch(err =>
        console.warn("[KBConsolidation] Daemon run failed:", (err as Error).message)
      );
    }
    const interval = setInterval(() => {
      if (isKBConsolidationDue()) {
        runKBConsolidation().catch(err =>
          console.warn("[KBConsolidation] Daemon run failed:", (err as Error).message)
        );
      }
    }, CHECK_INTERVAL_MS);
    interval.unref();
  }, INITIAL_DELAY_MS).unref();

  console.log("[KBConsolidation] Daemon started — checks every 6h, runs weekly");
}
