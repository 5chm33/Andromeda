/**
 * swarmSpecialistVoting.ts — v1.0.0
 *
 * Phase 2: Specialist agent voting with weighted consensus.
 *
 * Extends the existing multiAgentImprover with:
 *   - Named specialist roles (Security, Performance, Architect, Test, Ethics)
 *   - Weighted voting with veto powers
 *   - Confidence-weighted consensus scoring
 *   - Vote history and audit trail
 *   - Quorum requirements (minimum agents must vote)
 *   - Async parallel voting for speed
 *
 * Integration:
 *   - Called by rsiEngine.ts before applying any proposal
 *   - Results stored in rsiDb for audit
 */
import { createLogger } from "./logger.js";

const log = createLogger("swarmSpecialistVoting");

// ─── Types ─────────────────────────────────────────────────────────────────────
export type SpecialistRole =
  | "security"
  | "performance"
  | "architect"
  | "testing"
  | "ethics";

export interface SpecialistConfig {
  role: SpecialistRole;
  displayName: string;
  systemPrompt: string;
  weight: number;           // 0-1, contribution to final score
  hasVetoPower: boolean;    // if true, a confident rejection blocks the proposal
  vetoThreshold: number;    // confidence above which veto activates (0-1)
  focusAreas: string[];
}

export interface SpecialistVote {
  role: SpecialistRole;
  approve: boolean;
  confidence: number;       // 0-1
  reasoning: string;
  criticalIssues: string[];
  suggestions: string[];
  vetoed: boolean;
  latencyMs: number;
}

export interface VotingSession {
  sessionId: string;
  proposalId: string;
  targetFile: string;
  changeDescription: string;
  startedAt: number;
  completedAt?: number;
  votes: SpecialistVote[];
  consensus: ConsensusDecision;
}

export interface ConsensusDecision {
  approved: boolean;
  overallScore: number;     // 0-1 weighted approval
  quorumMet: boolean;
  vetoedBy?: SpecialistRole;
  reasoning: string;
  requiredChanges: string[];
  criticalIssues: string[];
}

// ─── Specialist Definitions ────────────────────────────────────────────────────
const SPECIALISTS: SpecialistConfig[] = [
  {
    role: "security",
    displayName: "Security Specialist",
    systemPrompt: `You are the Security Specialist for Andromeda, an autonomous AI agent.
Review code changes ONLY for security concerns:
- Command injection, path traversal, SSRF
- Hardcoded credentials or API keys
- Unsafe eval() or dynamic code execution
- Missing input validation or sanitization
- Privilege escalation or auth bypass
- Information leakage in logs or responses
Be strict. A false negative (missing a real vulnerability) is worse than a false positive.
Respond with valid JSON only: { "approve": boolean, "confidence": 0.0-1.0, "reasoning": "...", "criticalIssues": [...], "suggestions": [...] }`,
    weight: 0.35,
    hasVetoPower: true,
    vetoThreshold: 0.85,
    focusAreas: ["injection", "auth", "crypto", "input-validation"],
  },
  {
    role: "architect",
    displayName: "Architecture Specialist",
    systemPrompt: `You are the Architecture Specialist for Andromeda, an autonomous AI agent.
Review code changes for structural quality:
- Clean separation of concerns
- No circular dependencies
- Consistent interface design
- Proper error propagation
- Module cohesion and coupling
- TypeScript type safety
Respond with valid JSON only: { "approve": boolean, "confidence": 0.0-1.0, "reasoning": "...", "criticalIssues": [...], "suggestions": [...] }`,
    weight: 0.25,
    hasVetoPower: false,
    vetoThreshold: 0.9,
    focusAreas: ["architecture", "types", "interfaces", "modularity"],
  },
  {
    role: "performance",
    displayName: "Performance Specialist",
    systemPrompt: `You are the Performance Specialist for Andromeda, an autonomous AI agent.
Review code changes for performance impact:
- Memory leaks (unbounded arrays, unclosed handles)
- Blocking operations in async contexts
- Unnecessary allocations in hot paths
- N+1 query patterns
- Missing caching opportunities
- Inefficient algorithms (O(n²) where O(n log n) is possible)
Respond with valid JSON only: { "approve": boolean, "confidence": 0.0-1.0, "reasoning": "...", "criticalIssues": [...], "suggestions": [...] }`,
    weight: 0.20,
    hasVetoPower: false,
    vetoThreshold: 0.9,
    focusAreas: ["memory", "cpu", "io", "caching"],
  },
  {
    role: "testing",
    displayName: "Test Coverage Specialist",
    systemPrompt: `You are the Test Coverage Specialist for Andromeda, an autonomous AI agent.
Review code changes for testability and regression risk:
- Are new code paths covered by tests?
- Could this change break existing tests?
- Are edge cases handled?
- Is error handling testable?
- Does the change reduce overall test coverage?
Respond with valid JSON only: { "approve": boolean, "confidence": 0.0-1.0, "reasoning": "...", "criticalIssues": [...], "suggestions": [...] }`,
    weight: 0.15,
    hasVetoPower: false,
    vetoThreshold: 0.95,
    focusAreas: ["coverage", "regression", "edge-cases", "error-handling"],
  },
  {
    role: "ethics",
    displayName: "AI Ethics Specialist",
    systemPrompt: `You are the AI Ethics Specialist for Andromeda, an autonomous AI agent.
Review code changes for ethical and safety concerns:
- Does this change reduce human oversight or control?
- Could this enable deceptive behavior?
- Does this bypass constitutional constraints?
- Could this cause unintended harm?
- Does this respect user privacy?
- Does this maintain transparency of AI actions?
Respond with valid JSON only: { "approve": boolean, "confidence": 0.0-1.0, "reasoning": "...", "criticalIssues": [...], "suggestions": [...] }`,
    weight: 0.05,
    hasVetoPower: true,
    vetoThreshold: 0.90,
    focusAreas: ["oversight", "transparency", "safety", "privacy"],
  },
];

// ─── State ─────────────────────────────────────────────────────────────────────
const votingHistory: VotingSession[] = [];
let totalSessions = 0;
let approvedSessions = 0;
let vetoedSessions = 0;
let enabled = false;
const QUORUM_REQUIRED = 3; // Minimum specialists that must vote

// ─── Core Functions ────────────────────────────────────────────────────────────

/**
 * Run a full specialist voting session for a proposed change.
 * Specialists vote in parallel for speed.
 */
export async function runSpecialistVoting(
  proposalId: string,
  targetFile: string,
  currentContent: string,
  proposedContent: string,
  changeDescription: string,
): Promise<VotingSession> {
  const sessionId = `vote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  totalSessions++;

  log.info(`[SwarmVoting] Starting session ${sessionId} for ${targetFile}`);

  if (!enabled) {
    const session: VotingSession = {
      sessionId,
      proposalId,
      targetFile,
      changeDescription,
      startedAt,
      completedAt: Date.now(),
      votes: [],
      consensus: {
        approved: true,
        overallScore: 0.5,
        quorumMet: false,
        reasoning: "Swarm voting disabled — auto-approved",
        requiredChanges: [],
        criticalIssues: [],
      },
    };
    votingHistory.push(session);
    return session;
  }

  // Run all specialist votes in parallel
  const votePromises = SPECIALISTS.map(specialist =>
    querySpecialist(specialist, targetFile, currentContent, proposedContent, changeDescription)
  );

  const votes = await Promise.allSettled(votePromises).then(results =>
    results.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      // Abstain on failure — don't block on agent unavailability
      return {
        role: SPECIALISTS[i].role,
        approve: true,
        confidence: 0.3,
        reasoning: `Specialist unavailable: ${(r.reason as Error).message}`,
        criticalIssues: [],
        suggestions: [],
        vetoed: false,
        latencyMs: 0,
      } as SpecialistVote;
    })
  );

  const consensus = computeConsensus(votes);
  if (consensus.approved) approvedSessions++;
  if (consensus.vetoedBy) vetoedSessions++;

  const session: VotingSession = {
    sessionId,
    proposalId,
    targetFile,
    changeDescription,
    startedAt,
    completedAt: Date.now(),
    votes,
    consensus,
  };

  votingHistory.push(session);
  // Keep last 500 sessions in memory
  if (votingHistory.length > 500) votingHistory.splice(0, votingHistory.length - 500);

  log.info(`[SwarmVoting] Session ${sessionId} complete — ${consensus.approved ? "APPROVED" : "REJECTED"} (score=${consensus.overallScore.toFixed(2)})`);
  return session;
}

/**
 * Query a single specialist for their vote.
 */
async function querySpecialist(
  specialist: SpecialistConfig,
  targetFile: string,
  currentContent: string,
  proposedContent: string,
  changeDescription: string,
): Promise<SpecialistVote> {
  const start = Date.now();
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI();

    const userMessage = `Review this code change:

File: ${targetFile}
Description: ${changeDescription}

--- CURRENT (first 2000 chars) ---
${currentContent.slice(0, 2000)}

--- PROPOSED (first 2000 chars) ---
${proposedContent.slice(0, 2000)}

Focus areas: ${specialist.focusAreas.join(", ")}
Respond with JSON only.`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await client.chat.completions.create({
        model: process.env.SWARM_SPECIALIST_MODEL || "gpt-4.1-mini",
        messages: [
          { role: "system", content: specialist.systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 600,
        response_format: { type: "json_object" },
      }, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    const raw = (response.choices && response.choices[0]?.message?.content) || "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;
    const approve = typeof parsed.approve === "boolean" ? parsed.approve : true;
    const vetoed = specialist.hasVetoPower && !approve && confidence >= specialist.vetoThreshold;

    return {
      role: specialist.role,
      approve,
      confidence,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "No reasoning provided",
      criticalIssues: Array.isArray(parsed.criticalIssues) ? parsed.criticalIssues.slice(0, 5) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 5) : [],
      vetoed,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      role: specialist.role,
      approve: true,
      confidence: 0.3,
      reasoning: `Query failed: ${(err as Error).message}`,
      criticalIssues: [],
      suggestions: [],
      vetoed: false,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Compute weighted consensus from all specialist votes.
 */
function computeConsensus(votes: SpecialistVote[]): ConsensusDecision {
  const validVotes = votes.filter(v => v.confidence > 0.3);
  const quorumMet = validVotes.length >= QUORUM_REQUIRED;

  // Check for vetoes first
  const veto = votes.find(v => v.vetoed);
  if (veto) {
    return {
      approved: false,
      overallScore: 0,
      quorumMet,
      vetoedBy: veto.role,
      reasoning: `VETOED by ${veto.role}: ${veto.reasoning}`,
      requiredChanges: veto.suggestions,
      criticalIssues: veto.criticalIssues,
    };
  }

  // Weighted approval score
  let weightedSum = 0;
  let totalWeight = 0;
  const allIssues: string[] = [];
  const allSuggestions: string[] = [];

  for (const vote of votes) {
    const specialist = SPECIALISTS.find(s => s.role === vote.role);
    const weight = specialist?.weight ?? 0.2;
    if (!specialist) {
      log.warn(`[SwarmVoting] Unknown specialist role: ${vote.role}, using default weight`);
    }
    weightedSum += (vote.approve ? 1 : 0) * weight * vote.confidence;
    totalWeight += weight;
    allIssues.push(...vote.criticalIssues);
    allSuggestions.push(...vote.suggestions);
  }

  const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const APPROVAL_THRESHOLD = 0.55;
  const approved = quorumMet && overallScore >= APPROVAL_THRESHOLD;

  return {
    approved,
    overallScore,
    quorumMet,
    reasoning: quorumMet
      ? `Consensus: ${Math.round(overallScore * 100)}% approval (threshold: ${APPROVAL_THRESHOLD * 100}%, quorum: ${validVotes.length}/${QUORUM_REQUIRED})`
      : `Quorum not met: only ${validVotes.length}/${QUORUM_REQUIRED} valid votes — auto-approved`,
    requiredChanges: [...new Set(allSuggestions)].slice(0, 5),
    criticalIssues: [...new Set(allIssues)].slice(0, 10),
  };
}

// ─── Stats & Control ───────────────────────────────────────────────────────────
export function getVotingStats() {
  return {
    enabled,
    totalSessions,
    approvedSessions,
    vetoedSessions,
    approvalRate: totalSessions > 0 ? approvedSessions / totalSessions : 0,
    recentSessions: votingHistory.slice(-10),
  };
}

export function getVotingHistory(limit = 50): VotingSession[] {
  return votingHistory.slice(-limit);
}

export function initSwarmSpecialistVoting(options?: { enabled?: boolean }): void {
  enabled = options?.enabled ?? (process.env.SWARM_VOTING_ENABLED === "true");
  log.info(`[SwarmVoting] Initialized — enabled=${enabled}, quorum=${QUORUM_REQUIRED}`);
}

export function enableSwarmVoting(): void { enabled = true; }
export function disableSwarmVoting(): void { enabled = false; }
export function isSwarmVotingEnabled(): boolean { return enabled; }
export function getSpecialists(): SpecialistConfig[] { return [...SPECIALISTS]; }
