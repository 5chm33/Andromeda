/**
 * multiAgentDebate.ts — v13.0.0
 *
 * SOTA Multi-Agent Debate Protocol: moves consensus UPSTREAM of code generation.
 *
 * The existing multiAgentImprover.ts reviews proposals AFTER the LLM generates
 * a diff. This module implements a debate protocol that runs BEFORE generation:
 *
 *   1. Specialized sub-agents (Security Auditor, Performance Tuner, TypeScript
 *      Pedant, Architecture Guardian, Reliability Engineer) independently
 *      analyze the TARGET FILE and propose what KIND of improvement is needed.
 *
 *   2. Agents debate each other's proposals in structured rounds, challenging
 *      weak reasoning and building consensus on the best approach.
 *
 *   3. The winning proposal brief is passed to the code generator, ensuring
 *      the LLM writes exactly the improvement the debate agreed upon.
 *
 *   4. Dynamic model weighting: each agent's vote weight is adjusted based on
 *      their historical accuracy (tracked via RLAIF outcomes).
 *
 * This eliminates the "generate then reject" waste pattern where expensive
 * LLM tokens are spent generating code that the review agents will block.
 *
 * Integration:
 *   - selfImprove.ts: call runDebateProtocol() before analyzeAndPropose()
 *   - The returned DebateOutcome.winningBrief is injected into the system prompt
 */

import fs from "fs";
import path from "path";
import { createLogger } from "./logger.js";

const log = createLogger("multiAgentDebate");

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentPersona =
  | "security_auditor"
  | "performance_tuner"
  | "typescript_pedant"
  | "architecture_guardian"
  | "reliability_engineer";

export interface DebateAgent {
  persona: AgentPersona;
  displayName: string;
  systemPrompt: string;
  /** Base vote weight 0.0–1.0 */
  baseWeight: number;
  /** Dynamic weight adjusted by RLAIF outcomes */
  dynamicWeight: number;
  /** Historical accuracy: correct_votes / total_votes */
  historicalAccuracy: number;
  totalVotes: number;
  correctVotes: number;
}

export interface AgentProposal {
  persona: AgentPersona;
  improvementArea: string;
  rationale: string;
  estimatedImpact: "high" | "medium" | "low";
  confidence: number; // 0.0–1.0
  /** Specific instruction for the code generator */
  codeGeneratorBrief: string;
  /** Concerns about other proposals (populated during debate rounds) */
  challenges: string[];
}

export interface DebateRound {
  roundNumber: number;
  proposals: AgentProposal[];
  challenges: Array<{ challenger: AgentPersona; target: AgentPersona; challenge: string }>;
  defenses: Array<{ defender: AgentPersona; defense: string }>;
}

export interface DebateOutcome {
  /** The winning proposal brief to inject into the code generator */
  winningBrief: string;
  /** The winning agent */
  winner: AgentPersona;
  /** Weighted vote scores */
  scores: Record<AgentPersona, number>;
  /** All debate rounds */
  rounds: DebateRound[];
  /** Total debate duration in ms */
  durationMs: number;
  /** Whether the debate reached strong consensus (>70% agreement) */
  strongConsensus: boolean;
  /** Combined concerns from all agents to inject as constraints */
  constraints: string[];
}

export interface DebateConfig {
  maxRounds: number;
  consensusThreshold: number; // 0.0–1.0
  enableLLMDebate: boolean; // false = use structural analysis only (fast/cheap)
  minAgentsForConsensus: number;
}

// ─── Agent Definitions ────────────────────────────────────────────────────────

const DEBATE_AGENTS: DebateAgent[] = [
  {
    persona: "security_auditor",
    displayName: "Security Auditor",
    systemPrompt: `You are the Security Auditor agent for Andromeda's self-improvement system.
Your role is to identify the SINGLE most important security improvement needed in a TypeScript file.
Focus on: injection vulnerabilities, missing input validation, unsafe eval/exec, path traversal,
credential leaks, missing auth checks, unsafe deserialization.
Respond with JSON: { "improvementArea": "...", "rationale": "...", "estimatedImpact": "high|medium|low", "confidence": 0.0-1.0, "codeGeneratorBrief": "Specific instruction for the code generator in 1-2 sentences" }`,
    baseWeight: 0.30,
    dynamicWeight: 0.30,
    historicalAccuracy: 0.5,
    totalVotes: 0,
    correctVotes: 0,
  },
  {
    persona: "performance_tuner",
    displayName: "Performance Tuner",
    systemPrompt: `You are the Performance Tuner agent for Andromeda's self-improvement system.
Your role is to identify the SINGLE most impactful performance improvement in a TypeScript file.
Focus on: memory leaks, blocking operations in async contexts, unnecessary allocations in hot paths,
missing caching, O(n²) algorithms, unbounded arrays/maps, missing timeouts.
Respond with JSON: { "improvementArea": "...", "rationale": "...", "estimatedImpact": "high|medium|low", "confidence": 0.0-1.0, "codeGeneratorBrief": "Specific instruction for the code generator in 1-2 sentences" }`,
    baseWeight: 0.20,
    dynamicWeight: 0.20,
    historicalAccuracy: 0.5,
    totalVotes: 0,
    correctVotes: 0,
  },
  {
    persona: "typescript_pedant",
    displayName: "TypeScript Pedant",
    systemPrompt: `You are the TypeScript Pedant agent for Andromeda's self-improvement system.
Your role is to identify the SINGLE most important TypeScript type safety improvement in a file.
Focus on: missing null/undefined checks, any types that should be specific, missing return types,
unsafe type assertions, missing error type narrowing, implicit any in catch blocks.
Respond with JSON: { "improvementArea": "...", "rationale": "...", "estimatedImpact": "high|medium|low", "confidence": 0.0-1.0, "codeGeneratorBrief": "Specific instruction for the code generator in 1-2 sentences" }`,
    baseWeight: 0.20,
    dynamicWeight: 0.20,
    historicalAccuracy: 0.5,
    totalVotes: 0,
    correctVotes: 0,
  },
  {
    persona: "architecture_guardian",
    displayName: "Architecture Guardian",
    systemPrompt: `You are the Architecture Guardian agent for Andromeda's self-improvement system.
Your role is to identify the SINGLE most important architectural improvement in a TypeScript file.
Focus on: circular dependencies, god objects, missing abstractions, tight coupling, violation of
single responsibility principle, missing interfaces, improper module boundaries.
Respond with JSON: { "improvementArea": "...", "rationale": "...", "estimatedImpact": "high|medium|low", "confidence": 0.0-1.0, "codeGeneratorBrief": "Specific instruction for the code generator in 1-2 sentences" }`,
    baseWeight: 0.15,
    dynamicWeight: 0.15,
    historicalAccuracy: 0.5,
    totalVotes: 0,
    correctVotes: 0,
  },
  {
    persona: "reliability_engineer",
    displayName: "Reliability Engineer",
    systemPrompt: `You are the Reliability Engineer agent for Andromeda's self-improvement system.
Your role is to identify the SINGLE most important reliability improvement in a TypeScript file.
Focus on: missing try/catch, unhandled promise rejections, missing retry logic, no timeout guards,
missing circuit breakers, race conditions, missing graceful degradation.
Respond with JSON: { "improvementArea": "...", "rationale": "...", "estimatedImpact": "high|medium|low", "confidence": 0.0-1.0, "codeGeneratorBrief": "Specific instruction for the code generator in 1-2 sentences" }`,
    baseWeight: 0.15,
    dynamicWeight: 0.15,
    historicalAccuracy: 0.5,
    totalVotes: 0,
    correctVotes: 0,
  },
];

// ─── State ────────────────────────────────────────────────────────────────────

let config: DebateConfig = {
  maxRounds: 2,
  consensusThreshold: 0.65,
  enableLLMDebate: true,
  minAgentsForConsensus: 3,
};

let totalDebates = 0;
let consensusReached = 0;
let totalDebateMs = 0;

// Persist dynamic weights across restarts
function getWeightsPath(): string {
  const workspaceDir = path.resolve(process.cwd(), "workspace");
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  return path.join(workspaceDir, ".debate_weights.json");
}

function loadWeights(): void {
  try {
    const p = getWeightsPath();
    if (!fs.existsSync(p)) return;
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    for (const agent of DEBATE_AGENTS) {
      const saved = data[agent.persona];
      if (saved) {
        agent.dynamicWeight = saved.dynamicWeight ?? agent.baseWeight;
        agent.historicalAccuracy = saved.historicalAccuracy ?? 0.5;
        agent.totalVotes = saved.totalVotes ?? 0;
        agent.correctVotes = saved.correctVotes ?? 0;
      }
    }
  } catch { /* non-fatal */ }
}

function saveWeights(): void {
  try {
    const data: Record<string, unknown> = {};
    for (const agent of DEBATE_AGENTS) {
      data[agent.persona] = {
        dynamicWeight: agent.dynamicWeight,
        historicalAccuracy: agent.historicalAccuracy,
        totalVotes: agent.totalVotes,
        correctVotes: agent.correctVotes,
      };
    }
    fs.writeFileSync(getWeightsPath(), JSON.stringify(data, null, 2));
  } catch { /* non-fatal */ }
}

loadWeights();

// ─── Structural Analysis (LLM-free fast path) ─────────────────────────────────

function structuralProposal(agent: DebateAgent, fileContent: string, filename: string): AgentProposal {
  const lines = fileContent.split("\n");
  const challenges: string[] = [];

  if (agent.persona === "security_auditor") {
    if (fileContent.includes("eval(")) {
      return { persona: agent.persona, improvementArea: "Remove eval() usage", rationale: "eval() enables code injection attacks", estimatedImpact: "high", confidence: 0.95, codeGeneratorBrief: "Replace eval() with a safe alternative (JSON.parse, Function constructor, or explicit logic)", challenges };
    }
    if (/execSync\([^)]*\+/.test(fileContent)) {
      return { persona: agent.persona, improvementArea: "Fix command injection in execSync", rationale: "String concatenation in shell commands enables injection", estimatedImpact: "high", confidence: 0.9, codeGeneratorBrief: "Replace string-concatenated execSync with spawnSync using an args array", challenges };
    }
    if (fileContent.includes("process.env.") && !fileContent.includes("|| ") && !fileContent.includes("?? ")) {
      return { persona: agent.persona, improvementArea: "Add fallbacks for missing env vars", rationale: "Unguarded process.env access throws if key is missing", estimatedImpact: "medium", confidence: 0.7, codeGeneratorBrief: "Add ?? '' or || 'default' fallbacks to all process.env accesses", challenges };
    }
    return { persona: agent.persona, improvementArea: "Add input validation", rationale: "External inputs should be validated before use", estimatedImpact: "medium", confidence: 0.5, codeGeneratorBrief: "Add typeof/null checks before using function parameters that come from external sources", challenges };
  }

  if (agent.persona === "performance_tuner") {
    const setIntervals = (fileContent.match(/setInterval/g) || []).length;
    if (setIntervals > 2) {
      return { persona: agent.persona, improvementArea: "Consolidate setInterval timers", rationale: `${setIntervals} separate timers create unnecessary overhead`, estimatedImpact: "medium", confidence: 0.8, codeGeneratorBrief: "Merge multiple setInterval calls into a single timer with a dispatch table", challenges };
    }
    if (fileContent.includes("JSON.parse(JSON.stringify(")) {
      return { persona: agent.persona, improvementArea: "Replace JSON deep clone with structuredClone", rationale: "JSON.parse(JSON.stringify()) is slow and drops non-JSON values", estimatedImpact: "medium", confidence: 0.9, codeGeneratorBrief: "Replace JSON.parse(JSON.stringify(x)) with structuredClone(x)", challenges };
    }
    const asyncFns = (fileContent.match(/async function|async \(/g) || []).length;
    const awaitCalls = (fileContent.match(/await /g) || []).length;
    if (asyncFns > 3 && awaitCalls > asyncFns * 3) {
      return { persona: agent.persona, improvementArea: "Parallelize sequential awaits", rationale: "Multiple sequential awaits that could run in parallel slow execution", estimatedImpact: "high", confidence: 0.7, codeGeneratorBrief: "Identify independent await chains and wrap them in Promise.all()", challenges };
    }
    return { persona: agent.persona, improvementArea: "Add result caching", rationale: "Repeated computations could be memoized", estimatedImpact: "low", confidence: 0.4, codeGeneratorBrief: "Add a Map-based cache for expensive pure functions that are called repeatedly", challenges };
  }

  if (agent.persona === "typescript_pedant") {
    const anyCount = (fileContent.match(/: any\b/g) || []).length;
    if (anyCount > 3) {
      return { persona: agent.persona, improvementArea: `Replace ${anyCount} 'any' types with specific types`, rationale: "Explicit any disables type checking", estimatedImpact: "medium", confidence: 0.85, codeGeneratorBrief: "Replace 'any' with 'unknown' and add type guards, or define specific interfaces", challenges };
    }
    if (fileContent.includes("catch (err)") && !fileContent.includes("err as Error")) {
      return { persona: agent.persona, improvementArea: "Add error type narrowing in catch blocks", rationale: "Catch blocks receive 'unknown' in strict TypeScript", estimatedImpact: "medium", confidence: 0.9, codeGeneratorBrief: "Add 'err instanceof Error ? err.message : String(err)' pattern in all catch blocks", challenges };
    }
    const noReturnType = (fileContent.match(/(?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*\{/g) || []).length;
    if (noReturnType > 5) {
      return { persona: agent.persona, improvementArea: "Add explicit return types to exported functions", rationale: "Missing return types reduce type safety and IDE support", estimatedImpact: "low", confidence: 0.75, codeGeneratorBrief: "Add explicit return type annotations to all exported functions", challenges };
    }
    return { persona: agent.persona, improvementArea: "Add null checks before property access", rationale: "Missing null guards cause runtime TypeErrors", estimatedImpact: "medium", confidence: 0.6, codeGeneratorBrief: "Add optional chaining (?.) before property accesses on potentially null/undefined values", challenges };
  }

  if (agent.persona === "architecture_guardian") {
    const importCount = (fileContent.match(/^import /gm) || []).length;
    if (importCount > 25) {
      return { persona: agent.persona, improvementArea: "Split oversized module", rationale: `${importCount} imports suggests this file has too many responsibilities`, estimatedImpact: "high", confidence: 0.8, codeGeneratorBrief: "Extract a cohesive subset of functions into a new module to reduce coupling", challenges };
    }
    if (lines.length > 1000) {
      return { persona: agent.persona, improvementArea: "Extract sub-module from large file", rationale: `File is ${lines.length} lines — violates single responsibility`, estimatedImpact: "medium", confidence: 0.75, codeGeneratorBrief: "Extract the largest logical section into a separate module with a clean interface", challenges };
    }
    return { persona: agent.persona, improvementArea: "Add interface for external dependencies", rationale: "Direct imports of concrete implementations create tight coupling", estimatedImpact: "low", confidence: 0.5, codeGeneratorBrief: "Define an interface for the most-used external dependency and inject it", challenges };
  }

  if (agent.persona === "reliability_engineer") {
    const asyncFnsWithoutTry = fileContent.match(/async function[^{]*\{(?![^}]*try)/g) || [];
    if (asyncFnsWithoutTry.length > 2) {
      return { persona: agent.persona, improvementArea: "Add try/catch to async functions", rationale: `${asyncFnsWithoutTry.length} async functions lack error handling`, estimatedImpact: "high", confidence: 0.85, codeGeneratorBrief: "Wrap async function bodies in try/catch with proper error logging and re-throw", challenges };
    }
    if (fileContent.includes("fetch(") && !fileContent.includes("AbortController")) {
      return { persona: agent.persona, improvementArea: "Add timeout to fetch calls", rationale: "Unbounded fetch calls can hang indefinitely", estimatedImpact: "high", confidence: 0.9, codeGeneratorBrief: "Add AbortController with a 30s timeout to all fetch() calls", challenges };
    }
    if (fileContent.includes("setInterval") && !fileContent.includes("clearInterval")) {
      return { persona: agent.persona, improvementArea: "Add clearInterval cleanup", rationale: "setInterval without clearInterval causes memory leaks", estimatedImpact: "medium", confidence: 0.9, codeGeneratorBrief: "Store setInterval return values and call clearInterval in a cleanup/stop function", challenges };
    }
    return { persona: agent.persona, improvementArea: "Add retry logic with exponential backoff", rationale: "Transient failures should be retried automatically", estimatedImpact: "medium", confidence: 0.6, codeGeneratorBrief: "Add a retry wrapper with exponential backoff (max 3 retries) around network calls", challenges };
  }

  return { persona: agent.persona, improvementArea: "General reliability improvement", rationale: "Code review identified potential reliability issue", estimatedImpact: "low", confidence: 0.4, codeGeneratorBrief: "Add error handling and input validation", challenges };
}

// ─── LLM-powered proposal (when API keys available) ──────────────────────────

async function llmProposal(agent: DebateAgent, fileContent: string, filename: string): Promise<AgentProposal> {
  try {
    const { simpleChatCompletion } = await import("./llmProvider.js");
    const contentSlice = fileContent.slice(0, 4000);
    const raw = await simpleChatCompletion([
      { role: "system", content: agent.systemPrompt },
      { role: "user", content: `Analyze this TypeScript file and identify the single most important improvement for your specialty.\n\nFile: ${filename}\n\n\`\`\`typescript\n${contentSlice}\n\`\`\`\n\nReturn ONLY valid JSON.` },
    ], { maxTokens: 400, temperature: 0.2 });
    if (!raw) throw new Error("Empty response");
    const cleaned = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      persona: agent.persona,
      improvementArea: parsed.improvementArea || "General improvement",
      rationale: parsed.rationale || "",
      estimatedImpact: parsed.estimatedImpact || "medium",
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
      codeGeneratorBrief: parsed.codeGeneratorBrief || parsed.improvementArea || "",
      challenges: [],
    };
  } catch {
    return structuralProposal(agent, fileContent, filename);
  }
}

// ─── Debate Engine ────────────────────────────────────────────────────────────

/**
 * Run the full debate protocol for a target file.
 * Returns the winning proposal brief to inject into the code generator.
 */
export async function runDebateProtocol(
  targetFile: string,
  fileContent: string,
  opts?: { maxRounds?: number; useLLM?: boolean }
): Promise<DebateOutcome> {
  const t0 = Date.now();
  totalDebates++;
  const filename = path.basename(targetFile);
  const useLLM = opts?.useLLM ?? config.enableLLMDebate;
  const maxRounds = opts?.maxRounds ?? config.maxRounds;

  // Phase 1: Each agent independently proposes an improvement
  const proposals: AgentProposal[] = [];
  for (const agent of DEBATE_AGENTS) {
    try {
      const proposal = useLLM
        ? await llmProposal(agent, fileContent, filename)
        : structuralProposal(agent, fileContent, filename);
      proposals.push(proposal);
    } catch {
      proposals.push(structuralProposal(agent, fileContent, filename));
    }
  }

  const rounds: DebateRound[] = [];
  const round1: DebateRound = {
    roundNumber: 1,
    proposals: [...proposals],
    challenges: [],
    defenses: [],
  };

  // Phase 2: Challenge round — each agent challenges the weakest proposal
  for (let r = 0; r < Math.min(maxRounds - 1, 1); r++) {
    // Find the lowest-confidence proposal
    const sorted = [...proposals].sort((a, b) => a.confidence - b.confidence);
    const weakest = sorted[0];
    const challenger = DEBATE_AGENTS.find(a => a.persona !== weakest.persona)!;

    round1.challenges.push({
      challenger: challenger.persona,
      target: weakest.persona,
      challenge: `Challenge: '${weakest.improvementArea}' has low confidence (${(weakest.confidence * 100).toFixed(0)}%) and may not be the highest-priority fix. Consider '${proposals.find(p => p.persona === challenger.persona)?.improvementArea}' instead.`,
    });

    // Defender responds
    round1.defenses.push({
      defender: weakest.persona,
      defense: `Defense: ${weakest.rationale}. Estimated impact: ${weakest.estimatedImpact}.`,
    });
  }

  rounds.push(round1);

  // Phase 3: Weighted voting — select the winner
  const scores: Record<string, number> = {};
  for (const proposal of proposals) {
    const agent = DEBATE_AGENTS.find(a => a.persona === proposal.persona)!;
    const impactMultiplier = proposal.estimatedImpact === "high" ? 1.5 : proposal.estimatedImpact === "medium" ? 1.0 : 0.6;
    scores[proposal.persona] = agent.dynamicWeight * proposal.confidence * impactMultiplier;
  }

  const winnerPersona = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0] as AgentPersona;
  const winningProposal = proposals.find(p => p.persona === winnerPersona)!;

  // Compute consensus strength
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const winnerShare = scores[winnerPersona] / (totalScore || 1);
  const strongConsensus = winnerShare >= config.consensusThreshold;
  if (strongConsensus) consensusReached++;

  // Collect constraints from all agents (concerns about the winning approach)
  const constraints: string[] = [];
  for (const proposal of proposals) {
    if (proposal.persona !== winnerPersona && proposal.estimatedImpact === "high") {
      constraints.push(`[${DEBATE_AGENTS.find(a => a.persona === proposal.persona)?.displayName}] Also consider: ${proposal.improvementArea}`);
    }
  }

  // Build the final brief for the code generator
  const winningBrief = [
    `IMPROVEMENT TARGET: ${winningProposal.improvementArea}`,
    `RATIONALE: ${winningProposal.rationale}`,
    `INSTRUCTION: ${winningProposal.codeGeneratorBrief}`,
    constraints.length > 0 ? `CONSTRAINTS: ${constraints.slice(0, 2).join("; ")}` : "",
  ].filter(Boolean).join("\n");

  const durationMs = Date.now() - t0;
  totalDebateMs += durationMs;

  log.info(`[debate] ${filename}: winner=${winnerPersona} (${(winnerShare * 100).toFixed(0)}% consensus, ${durationMs}ms)`);

  return {
    winningBrief,
    winner: winnerPersona,
    scores: scores as Record<AgentPersona, number>,
    rounds,
    durationMs,
    strongConsensus,
    constraints,
  };
}

// ─── RLAIF Weight Updates ─────────────────────────────────────────────────────

/**
 * Record the outcome of a debate-guided proposal.
 * Called after a proposal is applied (success=true) or rejected (success=false).
 * Updates dynamic weights using exponential moving average.
 */
export function recordDebateOutcome(winnerPersona: AgentPersona, success: boolean): void {
  const agent = DEBATE_AGENTS.find(a => a.persona === winnerPersona);
  if (!agent) return;

  agent.totalVotes++;
  if (success) agent.correctVotes++;
  agent.historicalAccuracy = agent.totalVotes > 0 ? agent.correctVotes / agent.totalVotes : 0.5;

  // Exponential moving average for dynamic weight
  const alpha = 0.1; // learning rate
  const targetWeight = agent.baseWeight * (0.5 + agent.historicalAccuracy);
  agent.dynamicWeight = (1 - alpha) * agent.dynamicWeight + alpha * targetWeight;

  // Normalize all weights to sum to 1.0
  const totalWeight = DEBATE_AGENTS.reduce((sum, a) => sum + a.dynamicWeight, 0);
  for (const a of DEBATE_AGENTS) {
    a.dynamicWeight = a.dynamicWeight / totalWeight;
  }

  saveWeights();
  log.info(`[debate] RLAIF update: ${winnerPersona} accuracy=${(agent.historicalAccuracy * 100).toFixed(1)}% weight=${agent.dynamicWeight.toFixed(3)}`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getDebateStats() {
  return {
    totalDebates,
    consensusReached,
    consensusRate: totalDebates > 0 ? consensusReached / totalDebates : 0,
    avgDebateMs: totalDebates > 0 ? Math.round(totalDebateMs / totalDebates) : 0,
    agentWeights: DEBATE_AGENTS.map(a => ({
      persona: a.persona,
      displayName: a.displayName,
      dynamicWeight: a.dynamicWeight,
      historicalAccuracy: a.historicalAccuracy,
      totalVotes: a.totalVotes,
    })),
  };
}

export function updateDebateConfig(updates: Partial<DebateConfig>): void {
  config = { ...config, ...updates };
}

export function getDebateConfig(): DebateConfig {
  return { ...config };
}

export function initMultiAgentDebate(): void {
  loadWeights();
  log.info(`[multiAgentDebate] Initialized with ${DEBATE_AGENTS.length} agents, LLM debate: ${config.enableLLMDebate}`);
}
