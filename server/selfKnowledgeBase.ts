/**
 * selfKnowledgeBase.ts — v5.17
 *
 * Self-Knowledge Base Module.
 *
 * Maintains persistent knowledge about Andromeda's own evolution:
 * - Architecture Decision Records (ADRs) — why things are built the way they are
 * - Known Issues registry — tracked problems with workarounds
 * - Learning log — insights from past self-improvement attempts
 * - Capability inventory — what the system can and cannot do
 *
 * This enables the LLM to query past decisions during improvement planning,
 * avoiding repeated mistakes and building on successful patterns.
 *
 * Storage: JSON files in workspace/ directory for persistence across restarts.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ArchitectureDecision {
  id: string;
  title: string;
  context: string; // What problem were we solving?
  decision: string; // What did we decide?
  rationale: string; // Why this approach?
  alternatives: string[]; // What else was considered?
  consequences: string[]; // What are the trade-offs?
  status: "accepted" | "superseded" | "deprecated";
  supersededBy?: string; // ID of the ADR that replaces this one
  createdAt: number;
  updatedAt: number;
  relatedFiles: string[];
  tags: string[];
}

export interface KnownIssue {
  id: string;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "open" | "investigating" | "workaround" | "resolved" | "wontfix";
  workaround?: string;
  rootCause?: string;
  affectedModules: string[];
  reportedAt: number;
  resolvedAt?: number;
  resolvedBy?: string; // Proposal ID that fixed it
  attempts: Array<{ timestamp: number; approach: string; result: string }>;
}

export interface LearningEntry {
  id: string;
  category: "success" | "failure" | "insight" | "pattern" | "antipattern";
  title: string;
  description: string;
  context: string; // What was being attempted?
  outcome: string; // What happened?
  lesson: string; // What was learned?
  applicableTo: string[]; // Tags for when this learning applies
  confidence: number; // 0-1, how confident are we in this lesson?
  createdAt: number;
  relatedProposalIds: string[];
}

export interface CapabilityEntry {
  name: string;
  description: string;
  module: string;
  status: "active" | "experimental" | "disabled" | "planned";
  limitations: string[];
  dependencies: string[];
  addedInVersion: string;
}

interface KnowledgeStore {
  decisions: ArchitectureDecision[];
  issues: KnownIssue[];
  learnings: LearningEntry[];
  capabilities: CapabilityEntry[];
  _version: string;
  _lastUpdated: string;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

function getServerDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function getKnowledgeBasePath(): string {
  const workspaceDir = path.resolve(process.cwd(), "workspace");
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  return path.join(workspaceDir, ".andromeda_knowledge_base.json");
}

function createDefaultStore(): KnowledgeStore {
  return { decisions: [], issues: [], learnings: [], capabilities: [], _version: "5.17.0", _lastUpdated: new Date().toISOString() };
}

function loadStore(): KnowledgeStore {
  const p = getKnowledgeBasePath();
  if (!fs.existsSync(p)) {
    console.log("[KnowledgeBase] Knowledge base file not found, creating default.");
    return createDefaultStore();
  }
  try {
    const data = fs.readFileSync(p, "utf-8");
    return JSON.parse(data) as KnowledgeStore;
  } catch (error) {
    console.error(`[KnowledgeBase] Error loading store from ${p}, creating default:`, error);
    return createDefaultStore();
  }
}

function saveStore(store: KnowledgeStore): void {
  store._lastUpdated = new Date().toISOString();
  store._version = "5.17.0"; // Ensure version is updated on save
  try {
    fs.writeFileSync(getKnowledgeBasePath(), JSON.stringify(store, null, 2), "utf-8");
  } catch (error) {
    console.error(`[KnowledgeBase] Error saving store to ${getKnowledgeBasePath()}:`, error);
  }
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Architecture Decision Records ───────────────────────────────────────────

/**
 * Record a new architecture decision.
 */
export function recordDecision(input: {
  title: string;
  context: string;
  decision: string;
  rationale: string;
  alternatives?: string[];
  consequences?: string[];
  relatedFiles?: string[];
  tags?: string[];
}): ArchitectureDecision {
  const store = loadStore();
  const adr: ArchitectureDecision = {
    id: generateId("adr"),
    title: input.title,
    context: input.context,
    decision: input.decision,
    rationale: input.rationale,
    alternatives: input.alternatives || [],
    consequences: input.consequences || [],
    status: "accepted",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    relatedFiles: input.relatedFiles || [],
    tags: input.tags || [],
  };

  store.decisions.push(adr);
  saveStore(store);
  return adr;
}

/**
 * Supersede an existing decision with a new one.
 */
export function supersedeDecision(oldId: string, newDecision: Parameters<typeof recordDecision>[0]): ArchitectureDecision | null {
  const store = loadStore();
  const old = store.decisions.find(d => d.id === oldId);
  if (!old) return null;

  const newAdr = recordDecision(newDecision);
  old.status = "superseded";
  old.supersededBy = newAdr.id;
  old.updatedAt = Date.now();
  saveStore(store);
  return newAdr;
}

/**
 * Query decisions by tag or keyword.
 */
export function queryDecisions(query: string): ArchitectureDecision[] {
  const store = loadStore();
  const lowerQuery = query.toLowerCase();
  return store.decisions.filter(d =>
    d.status === "accepted" && (
      d.title.toLowerCase().includes(lowerQuery) ||
      d.tags.some(t => t.toLowerCase().includes(lowerQuery)) ||
      d.context.toLowerCase().includes(lowerQuery) ||
      d.decision.toLowerCase().includes(lowerQuery)
    )
  );
}

/**
 * List all active decisions.
 */
export function listDecisions(status?: ArchitectureDecision["status"]): ArchitectureDecision[] {
  const store = loadStore();
  if (status) return store.decisions.filter(d => d.status === status);
  return store.decisions;
}

// ─── Known Issues ─────────────────────────────────────────────────────────────

/**
 * Report a new known issue.
 */
export function reportIssue(input: {
  title: string;
  description: string;
  severity: KnownIssue["severity"];
  affectedModules: string[];
  workaround?: string;
}): KnownIssue {
  const store = loadStore();
  const issue: KnownIssue = {
    id: generateId("issue"),
    title: input.title,
    description: input.description,
    severity: input.severity,
    status: "open",
    workaround: input.workaround,
    affectedModules: input.affectedModules,
    reportedAt: Date.now(),
    attempts: [],
  };

  store.issues.push(issue);
  saveStore(store);
  return issue;
}

/**
 * Record an attempt to fix an issue.
 */
export function recordFixAttempt(issueId: string, approach: string, result: string): boolean {
  const store = loadStore();
  const issue = store.issues.find(i => i.id === issueId);
  if (!issue) return false;

  issue.attempts.push({ timestamp: Date.now(), approach, result });
  issue.status = "investigating";
  saveStore(store);
  return true;
}

/**
 * Mark an issue as resolved.
 */
export function resolveIssue(issueId: string, rootCause: string, resolvedBy?: string): boolean {
  const store = loadStore();
  const issue = store.issues.find(i => i.id === issueId);
  if (!issue) return false;

  issue.status = "resolved";
  issue.rootCause = rootCause;
  issue.resolvedAt = Date.now();
  issue.resolvedBy = resolvedBy;
  saveStore(store);
  return true;
}

/**
 * Get open issues, optionally filtered by severity or module.
 */
export function getOpenIssues(filter?: { severity?: KnownIssue["severity"]; module?: string }): KnownIssue[] {
  const store = loadStore();
  let issues = (store.issues || []).filter(i => i.status !== "resolved" && i.status !== "wontfix");

  if (filter?.severity) issues = issues.filter(i => i.severity === filter.severity);
  if (filter?.module) issues = issues.filter(i => i.affectedModules.includes(filter.module!));

  return issues.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

/**
 * Check if a similar issue already exists (to avoid duplicates).
 */
export function findSimilarIssue(title: string): KnownIssue | null {
  const store = loadStore();
  const lowerTitle = title.toLowerCase();
  return store.issues.find(i =>
    i.status !== "resolved" &&
    (i.title.toLowerCase().includes(lowerTitle) || lowerTitle.includes(i.title.toLowerCase()))
  ) || null;
}

// ─── Learning Log ─────────────────────────────────────────────────────────────

/**
 * Record a learning from a self-improvement attempt.
 */
export function recordLearning(input: {
  category: LearningEntry["category"];
  title: string;
  description: string;
  context: string;
  outcome: string;
  lesson: string;
  applicableTo?: string[];
  confidence?: number;
  relatedProposalIds?: string[];
}): LearningEntry {
  const store = loadStore();
  const entry: LearningEntry = {
    id: generateId("learn"),
    category: input.category,
    title: input.title,
    description: input.description,
    context: input.context,
    outcome: input.outcome,
    lesson: input.lesson,
    applicableTo: input.applicableTo || [],
    confidence: input.confidence ?? 0.7,
    createdAt: Date.now(),
    relatedProposalIds: input.relatedProposalIds || [],
  };

  store.learnings.push(entry);
  saveStore(store);
  return entry;
}

/**
 * Query learnings relevant to a given context.
 */
export function queryLearnings(context: string, category?: LearningEntry["category"]): LearningEntry[] {
  const store = loadStore();
  const lowerContext = context.toLowerCase();

  let learnings = store.learnings;
  if (category) learnings = learnings.filter(l => l.category === category);

  return learnings
    .filter(l =>
      l.applicableTo.some(tag => lowerContext.includes(tag.toLowerCase())) ||
      l.title.toLowerCase().includes(lowerContext) ||
      l.context.toLowerCase().includes(lowerContext)
    )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);
}

/**
 * Get anti-patterns to avoid (failed approaches).
 */
export function getAntiPatterns(): LearningEntry[] {
  const store = loadStore();
  return store.learnings
    .filter(l => l.category === "antipattern" || l.category === "failure")
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get successful patterns to replicate.
 */
export function getSuccessPatterns(): LearningEntry[] {
  const store = loadStore();
  return store.learnings
    .filter(l => l.category === "success" || l.category === "pattern")
    .sort((a, b) => b.confidence - a.confidence);
}

// ─── Capability Inventory ─────────────────────────────────────────────────────

/**
 * Register a capability in the inventory.
 */
export function registerCapability(cap: CapabilityEntry): void {
  const store = loadStore();
  const existing = store.capabilities.findIndex(c => c.name === cap.name);
  if (existing >= 0) {
    store.capabilities[existing] = cap;
  } else {
    store.capabilities.push(cap);
  }
  saveStore(store);
}

/**
 * Get all capabilities, optionally filtered by status.
 */
export function getCapabilities(status?: CapabilityEntry["status"]): CapabilityEntry[] {
  const store = loadStore();
  if (status) return store.capabilities.filter(c => c.status === status);
  return store.capabilities;
}

/**
 * Get limitations for a specific capability.
 */
export function getLimitations(capabilityName: string): string[] {
  const store = loadStore();
  const cap = store.capabilities.find(c => c.name === capabilityName);
  return cap?.limitations || [];
}

// ─── Context Injection ────────────────────────────────────────────────────────

/**
 * Generate a context summary for the LLM when planning self-improvements.
 * This is injected into the system prompt during self-improvement sessions.
 */
export function getImprovementContext(targetModule?: string): string {
  const store = loadStore();
  const sections: string[] = [];

  // Relevant decisions
  const decisions = targetModule
    ? store.decisions.filter(d => d.status === "accepted" && d.relatedFiles.some(f => f.includes(targetModule)))
    : store.decisions.filter(d => d.status === "accepted").slice(-5);

  if (decisions.length > 0) {
    sections.push("## Architecture Decisions");
    for (const d of decisions) {
      sections.push(`- **${d.title}**: ${d.decision} (Rationale: ${d.rationale})`);
    }
  }

  // Open issues
  const issues = targetModule
    ? store.issues.filter(i => i.status !== "resolved" && i.affectedModules.includes(targetModule))
    : getOpenIssues().slice(0, 5);

  if (issues.length > 0) {
    sections.push("\n## Known Issues");
    for (const i of issues) {
      sections.push(`- [${i.severity}] **${i.title}**: ${i.description}${i.workaround ? ` (Workaround: ${i.workaround})` : ""}`);
    }
  }

  // Relevant learnings
  const learnings = targetModule
    ? queryLearnings(targetModule)
    : store.learnings.filter(l => l.confidence > 0.7).slice(-5);

  if (learnings.length > 0) {
    sections.push("\n## Learnings");
    for (const l of learnings) {
      sections.push(`- [${l.category}] **${l.title}**: ${l.lesson}`);
    }
  }

  // Anti-patterns
  const antiPatterns = getAntiPatterns().slice(0, 3);
  if (antiPatterns.length > 0) {
    sections.push("\n## Avoid These Patterns");
    for (const ap of antiPatterns) {
      sections.push(`- ❌ ${ap.title}: ${ap.lesson}`);
    }
  }

  return sections.join("\n");
}

/**
 * Get a full knowledge base summary for the self-report endpoint.
 */
export function getKnowledgeBaseSummary(): {
  totalDecisions: number;
  activeDecisions: number;
  openIssues: number;
  criticalIssues: number;
  totalLearnings: number;
  capabilities: number;
  lastUpdated: string;
} {
  const store = loadStore();
  return {
    totalDecisions: store.decisions.length,
    activeDecisions: store.decisions.filter(d => d.status === "accepted").length,
    openIssues: store.issues.filter(i => i.status !== "resolved" && i.status !== "wontfix").length,
    criticalIssues: store.issues.filter(i => i.severity === "critical" && i.status !== "resolved").length,
    totalLearnings: store.learnings.length,
    capabilities: store.capabilities.length,
    lastUpdated: store._lastUpdated,
  };
}

/**
 * Initialize the knowledge base with seed data on first run.
 */
export function initKnowledgeBase(): void {
  const store = loadStore();

  // Seed with initial architecture decisions if empty
  if (store.decisions.length === 0) {
    store.decisions.push({
      id: "adr_seed_001",
      title: "DeepSeek as Primary LLM Provider",
      context: "Need a capable LLM with large context window and competitive pricing",
      decision: "Use DeepSeek Chat (131K context) as primary, with configurable fallbacks",
      rationale: "Best cost/performance ratio, 131K context window, fast inference, tool support",
      alternatives: ["OpenAI GPT-4o (expensive)", "Claude 3.5 (limited availability)", "Local models (quality concerns)"],
      consequences: ["Dependent on DeepSeek API availability", "No native vision support", "Need fallback for outages"],
      status: "accepted",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      relatedFiles: ["server/ai.ts", "server/llmProvider.ts"],
      tags: ["llm", "infrastructure", "cost"],
    });

    store.decisions.push({
      id: "adr_seed_002",
      title: "Multi-Pass File Analysis Engine",
      context: "Naive file analysis truncated at 80K chars, losing critical context for large codebases",
      decision: "Implement index→relevance→fetch→analyze pipeline with auto-continuation",
      rationale: "Enables full codebase analysis without artificial limits, uses context window efficiently",
      alternatives: ["Simple truncation (loses context)", "Chunked summarization (loses detail)", "RAG-only (misses structure)"],
      consequences: ["Higher token usage per analysis", "More complex code", "Better results for large files"],
      status: "accepted",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      relatedFiles: ["server/fileEngine.ts"],
      tags: ["file-analysis", "architecture", "context-window"],
    });

    store.decisions.push({
      id: "adr_seed_003",
      title: "Self-Improvement with Guard Rails",
      context: "System needs to modify its own code safely without breaking itself",
      decision: "Multi-layer safety: proposal → review → guard → type check → test → rollback",
      rationale: "Each layer catches different failure modes; rollback ensures recoverability",
      alternatives: ["Direct apply (dangerous)", "Human-only approval (slow)", "Sandbox-only (complex)"],
      consequences: ["Slower self-improvement cycle", "Higher safety", "Can enable auto-apply for high-confidence changes"],
      status: "accepted",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      relatedFiles: ["server/selfImprove.ts", "server/selfImproveGuard.ts", "server/selfRollback.ts"],
      tags: ["self-improvement", "safety", "autonomy"],
    });

    saveStore(store);
  }

  // Seed capabilities if empty
  if (store.capabilities.length === 0) {
    const seedCapabilities: CapabilityEntry[] = [
      { name: "web_search", description: "Search the web via Brave/SearXNG", module: "search.ts", status: "active", limitations: ["Rate limited", "No real-time data"], dependencies: ["BRAVE_SEARCH_API_KEY or SEARXNG_URL"], addedInVersion: "5.0" },
      { name: "code_execution", description: "Execute code in sandboxed environment", module: "codeRunner.ts", status: "active", limitations: ["Timeout limits", "No GPU access"], dependencies: ["Docker (optional)"], addedInVersion: "5.0" },
      { name: "file_analysis", description: "Multi-pass analysis of ZIP/code files", module: "fileEngine.ts", status: "active", limitations: ["Token budget per pass"], dependencies: ["LLM API"], addedInVersion: "5.12" },
      { name: "self_improvement", description: "Analyze and modify own source code", module: "selfImprove.ts", status: "active", limitations: ["Requires type check pass", "Rate limited"], dependencies: ["TypeScript compiler"], addedInVersion: "5.3" },
      { name: "hot_reload", description: "Reload modules without restart", module: "hotReload.ts", status: "experimental", limitations: ["ESM cache busting unreliable", "State may be lost"], dependencies: [], addedInVersion: "5.17" },
      { name: "self_healing", description: "Detect and auto-fix degradation", module: "selfHeal.ts", status: "experimental", limitations: ["Limited to known health checks", "LLM diagnosis may be inaccurate"], dependencies: ["LLM API"], addedInVersion: "5.17" },
      { name: "vector_memory", description: "Semantic search over stored memories", module: "vectorMemory.ts", status: "active", limitations: ["Embedding quality depends on provider"], dependencies: ["Embedding API"], addedInVersion: "5.8" },
      { name: "multi_agent", description: "Coordinate multiple AI agents for complex tasks", module: "multiAgent.ts", status: "active", limitations: ["Higher token cost", "Coordination overhead"], dependencies: ["LLM API"], addedInVersion: "5.5" },
      { name: "goal_management", description: "Create, track, and decompose goals", module: "goalManager.ts", status: "active", limitations: ["No autonomous goal creation yet"], dependencies: ["Database"], addedInVersion: "5.10" },
      { name: "model_optimization", description: "Auto-select optimal model per task type", module: "modelRegistry.ts", status: "experimental", limitations: ["Needs performance history to be effective"], dependencies: [], addedInVersion: "5.17" },
    ];

    store.capabilities = seedCapabilities;
    saveStore(store);
  }

  console.log(`[KnowledgeBase] Initialized. ${store.decisions.length} decisions, ${store.issues.length} issues, ${store.learnings.length} learnings, ${store.capabilities.length} capabilities.`);
}

// ─── v5.25: Cross-Session Learning ───────────────────────────────────────────

/**
 * Record the outcome of a self-modification attempt for cross-session learning.
 * This builds a feedback loop: successful patterns get reinforced, failed patterns get avoided.
 */
export function recordModificationOutcome(input: {
  targetFile: string;
  proposalTitle: string;
  category: string;
  success: boolean;
  rollbackReason?: string;
  healthImpact?: "improved" | "degraded" | "neutral";
}): void {
  if (!input || typeof input.targetFile !== "string" || typeof input.proposalTitle !== "string" || typeof input.category !== "string" || typeof input.success !== "boolean") {
    console.warn("[KnowledgeBase] Invalid input to recordModificationOutcome, skipping.");
    return;
  }
  const category = input.success ? "success" : "antipattern";
  const confidence = input.success ? 0.8 : 0.9; // High confidence in anti-patterns

  recordLearning({
    title: `${input.success ? "Success" : "Failure"}: ${input.proposalTitle}`,
    description: input.success
      ? `Successfully applied "${input.proposalTitle}" to ${input.targetFile} (${input.category}). Health: ${input.healthImpact || "neutral"}.`
      : `Failed to apply "${input.proposalTitle}" to ${input.targetFile}. Reason: ${input.rollbackReason || "unknown"}. Avoid similar changes.`,
    category,
    confidence,
    context: `self-modify ${input.targetFile} ${input.category}`,
    outcome: input.success ? "success" : `failure: ${input.rollbackReason || "unknown"}`,
    lesson: input.success
      ? `Pattern works for ${input.targetFile}: ${input.proposalTitle}`
      : `Avoid for ${input.targetFile}: ${input.proposalTitle} — causes ${input.rollbackReason || "issues"}`,
    applicableTo: [input.targetFile, input.category],
  });
}

/**
 * Get cross-session learning summary for a specific file or category.
 * Returns success rate and key patterns to follow/avoid.
 */
export function getCrossSessionInsights(targetFile?: string): {
  totalAttempts: number;
  successRate: number;
  topPatterns: string[];
  topAntiPatterns: string[];
} {
  const store = loadStore();
  const relevant = store.learnings.filter(l =>
    targetFile ? l.context.includes(targetFile) : l.applicableTo.some((t: string) => t === "success" || t === "failure")
  );

  const successes = relevant.filter(l => l.category === "success");
  const failures = relevant.filter(l => l.category === "antipattern");

  return {
    totalAttempts: relevant.length,
    successRate: relevant.length > 0 ? successes.length / relevant.length : 0,
    topPatterns: successes.slice(-5).map(l => l.description),
    topAntiPatterns: failures.slice(-5).map(l => l.description),
  };
}
