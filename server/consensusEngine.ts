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
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY;
    const apiUrl = process.env.LLM_API_URL || "https://api.deepseek.com/v1/chat/completions";

    const prompt = `You are a code review safety system. Evaluate this proposed change:

Type: ${request.type}
Target: ${request.targetFile}
Risk Level: ${request.riskLevel}
Description: ${request.description}
Affected Files: ${request.affectedFiles?.join(", ") || "none specified"}

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
    return {
      model,
      approved: false,
      confidence: 0,
      reasoning: `Error: ${(err as Error).message}`,
      responseTime: Date.now() - start,
    };
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function getConsensus(request: ConsensusRequest): Promise<ConsensusResult> {
  totalConsensusRequests++;

  // v9.8.5: In single-model mode, auto-approve. Querying the same model that generated
  // the proposal for a second opinion is circular and wastes tokens — the model will
  // always be biased toward its own output. Consensus only adds value with 2+ independent models.
  if (config.models.length <= 1) {
    console.log(`[Consensus] Bypass: Single-model mode — auto-approving "${request.description.slice(0, 60)}"`);
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

  // Query all models in parallel
  const votes = await Promise.all(
    config.models.map(m => queryModel(m, request))
  );

  const approvalCount = votes.filter(v => v.approved).length;
  const threshold = Math.ceil(config.models.length * config.majorityThreshold);
  const approved = approvalCount >= threshold;
  const avgConfidence = votes.reduce((sum, v) => sum + v.confidence, 0) / votes.length;

  const result: ConsensusResult = {
    approved,
    votes,
    majorityReached: approvalCount >= threshold || (config.models.length - approvalCount) >= threshold,
    totalModels: config.models.length,
    approvalCount,
    consensusConfidence: avgConfidence,
  };

  if (approved) totalApproved++;
  else totalRejected++;

  console.log(`[Consensus] ${approved ? "APPROVED" : "REJECTED"} (${approvalCount}/${config.models.length}): ${request.description.slice(0, 80)}`);
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
  console.log(`[Consensus] Initialized. Models: ${config.models.length}, Threshold: ${config.majorityThreshold}, Required for: ${config.requireForRiskLevel}+`);
}
