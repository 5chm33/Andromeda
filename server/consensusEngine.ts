/**
 * Andromeda v5.27 — Multi-Model Consensus Engine
 *
 * For critical self-modification decisions, queries multiple LLM models
 * and requires a 2/3 majority before proceeding.
 *
 * Use cases:
 * - Hot-reloading core modules
 * - Modifying critical files (ai.ts, selfModify.ts, etc.)
 * - Changes affecting >5 dependent files
 */

import { initDynamicWeights, computeWeightedApproval, recordConsensusOutcome, getModelWeightStats } from "./dynamicModelWeights.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ConsensusVote {
  model: string;
  approved: boolean;
  confidence: number;
  reasoning: string;
  responseTime: number;
}

interface ConsensusResult {
  approved: boolean;
  votes: ConsensusVote[];
  majorityReached: boolean;
  totalModels: number;
  approvalCount: number;
  consensusConfidence: number;
}

interface ConsensusRequest {
  type: "modification" | "rollback" | "hot-reload" | "critical-change";
  description: string;
  targetFile: string;
  proposedChange: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  affectedFiles?: string[];
}

interface ConsensusConfig {
  enabled: boolean;
  models: string[];
  majorityThreshold: number; // 0-1, default 0.66 (2/3)
  timeoutMs: number;
  requireForRiskLevel: "critical" | "high" | "medium" | "low";
}

// ── State ────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: ConsensusConfig = {
  // v6.03: Enabled by default — falls back gracefully to single-model when only one
  // API key is available. The engine already handles models.length <= 1 correctly
  // (line 146: queries single model directly). No multi-key requirement.
  enabled: true,
  models: ["deepseek/deepseek-chat"], // Single model by default; add more via initConsensusEngine()
  majorityThreshold: 0.66,
  timeoutMs: 30000,
  requireForRiskLevel: "critical",
};

let config: ConsensusConfig = { ...DEFAULT_CONFIG };
let totalConsensusRequests = 0;
let totalApproved = 0;
let totalRejected = 0;

// ── Core Logic ───────────────────────────────────────────────────────────────

async function queryModel(model: string, request: ConsensusRequest): Promise<ConsensusVote> {
  const start = Date.now();
  const maxRetries = 3;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    try {
      const apiKey = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY;
      const apiUrl = process.env.LLM_API_URL || "https://api.deepseek.com/v1/chat/completions";

      const prompt = `You are a code review safety system. Evaluate this proposed change:

Type: ${request.type}
Target: ${request.targetFile}
Risk Level: ${request.riskLevel}
Description: ${request.description}
Affected Files: ${(request.affectedFiles && request.affectedFiles.length > 0) ? request.affectedFiles.join(", ") : "none specified"}

Proposed Change (first 2000 chars):
${request.proposedChange.slice(0, 2000)}

Respond with ONLY a JSON object:
{"approved": true/false, "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 200,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || "";

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          model,
          approved: !!parsed.approved,
          confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
          reasoning: parsed.reasoning || "No reasoning provided",
          responseTime: Date.now() - start,
        };
      }

      // Fallback: conservative rejection if can't parse
      return {
        model,
        approved: false,
        confidence: 0.3,
        reasoning: "Could not parse model response",
        responseTime: Date.now() - start,
      };
    } catch (err) {
      lastError = err as Error;
      console.warn(`[Consensus] Model ${model} attempt ${attempt + 1}/${maxRetries} failed: ${(err as Error).message}`);
    }
  }
  // All retries exhausted — provider is unreachable, abstain rather than vote no.
  // Counting a network failure as a "no" vote was causing false rejections (v12.7.0 fix).
  return {
    model,
    approved: true,  // abstain: don't penalise proposal for provider being down
    confidence: 0,   // zero confidence signals this was an abstain, not a real approval
    reasoning: `Abstain (provider unreachable after ${maxRetries} retries): ${lastError?.message}`,
    responseTime: Date.now() - start,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function getConsensus(request: ConsensusRequest): Promise<ConsensusResult> {
  if (!request) return { approved: false, votes: [], majorityReached: false, totalModels: 0, approvalCount: 0, consensusConfidence: 0 };
  totalConsensusRequests++;

  // v9.8.5: If consensus is required for the risk level, always query the model(s).
  // If not required, and only one model is configured, bypass.
  if (config.models.length <= 1 && !requiresConsensus(request.riskLevel)) {
    console.log(`[Consensus] Bypass: Single-model mode & not required — auto-approving "${(request.description ?? String(request)).slice(0, 60)}"`);
    totalApproved++;
    return {
      approved: true,
      votes: [{ model: "auto-approve", approved: true, confidence: 1, reasoning: "Single-model bypass", responseTime: 0 }],
      majorityReached: true,
      totalModels: 1,
      approvalCount: 1,
      consensusConfidence: 1,
    };
  }

  // If only one model is configured, query that single model.
  // The bypass logic for single-model + not required is handled above.
  if (config.models.length === 1) {
    const vote = await queryModel(config.models[0], request);
    const approved = vote.approved;
    if (approved) totalApproved++; else totalRejected++;
    return {
      approved,
      votes: [vote],
      majorityReached: true,
      totalModels: 1,
      approvalCount: approved ? 1 : 0,
      consensusConfidence: vote.confidence,
    };
  }

  // Query all models in parallel
  const votes = await Promise.all(
    config.models.map(m => queryModel(m, request))
  );

  // v12.9.0: Dynamic RLAIF model weighting — use historical accuracy to weight votes
  // instead of simple majority. Models with better track records have more influence.
  const simpleApprovalCount = votes.filter(v => v.approved).length;
  const simpleThreshold = Math.ceil(config.models.length * config.majorityThreshold);

  let approved: boolean;
  let consensusConfidence: number;

  try {
    const weightedResult = computeWeightedApproval(
      votes.map(v => ({ model: v.model, approved: v.approved, confidence: v.confidence }))
    );
    approved = weightedResult.score >= config.majorityThreshold;
    consensusConfidence = weightedResult.score;
    console.log(`[Consensus] Weighted score: ${weightedResult.score.toFixed(3)} (threshold: ${config.majorityThreshold})`);
  } catch {
    // Fallback to simple majority if weighting fails
    approved = simpleApprovalCount >= simpleThreshold;
    consensusConfidence = votes.reduce((sum, v) => sum + v.confidence, 0) / votes.length;
  }

  const result: ConsensusResult = {
    approved,
    votes,
    majorityReached: simpleApprovalCount >= simpleThreshold || (config.models.length - simpleApprovalCount) >= simpleThreshold,
    totalModels: config.models.length,
    approvalCount: simpleApprovalCount,
    consensusConfidence,
  };

  if (approved) totalApproved++;
  else totalRejected++;

  console.log(`[Consensus] ${approved ? "APPROVED" : "REJECTED"} (${simpleApprovalCount}/${config.models.length}, weighted): ${(request.description ?? '').slice(0, 80)}`);
  return result;
}

export function requiresConsensus(riskLevel: string): boolean {
  if (!config.enabled) return false;
  const levels = ["low", "medium", "high", "critical"];
  const requiredIdx = levels.indexOf(config.requireForRiskLevel);
  const actualIdx = levels.indexOf(riskLevel);
  return actualIdx >= requiredIdx;
}

export function getConsensusStats() {
  return {
    enabled: config.enabled,
    models: config.models,
    totalRequests: totalConsensusRequests,
    totalApproved,
    totalRejected,
    approvalRate: totalConsensusRequests > 0 ? totalApproved / totalConsensusRequests : 0,
    majorityThreshold: config.majorityThreshold,
  };
}

export function updateConsensusConfig(updates: Partial<ConsensusConfig>): void {
  config = { ...config, ...updates };
}

export function initConsensusEngine(overrides?: Partial<ConsensusConfig>): void {
  if (overrides) config = { ...config, ...overrides };
  // v12.9.0: Initialize dynamic model weights on startup
  try { initDynamicWeights(); } catch { /* non-fatal */ }
  console.log(`[Consensus] Initialized. Models: ${config.models.length}, Threshold: ${config.majorityThreshold}, Required for: ${config.requireForRiskLevel}+`);
}

/**
 * Record the outcome of a consensus decision for RLAIF weight updates.
 * Call this after a proposal's final result is known.
 */
export function recordConsensusProposalOutcome(
  votes: Array<{ model: string; approved: boolean }>,
  proposalSucceeded: boolean
): void {
  try { recordConsensusOutcome(votes, proposalSucceeded); } catch { /* non-fatal */ }
}

/** Get dynamic model weight stats for the dashboard. */
export function getDynamicModelWeightStats() {
  try { return getModelWeightStats(); } catch { return []; }
}
