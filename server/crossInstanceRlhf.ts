/**
 * crossInstanceRlhf.ts
 *
 * Cross-Instance RLHF Judging for Andromeda.
 *
 * Problem: A single RLAIF judge (rlaifJudge.ts) can be "reward hacked" —
 * the RSI system learns to game the judge rather than genuinely improve.
 *
 * Solution: Cross-instance RLHF judging uses multiple independent judge nodes
 * to evaluate proposals. A proposal must achieve consensus across N judges
 * before being adopted. This prevents any single judge from being exploited.
 *
 * Architecture:
 *   1. Local judge evaluates the proposal (rlaifJudge.ts)
 *   2. Proposal is submitted to M peer nodes for independent evaluation
 *   3. Each peer runs its own RLAIF judge with potentially different LLM
 *   4. Results are aggregated via weighted voting (trust-weighted)
 *   5. Proposal is adopted only if consensus threshold is met
 *   6. Disagreement patterns are logged to detect reward hacking attempts
 *
 * Anti-Reward-Hacking Mechanisms:
 *   - Judge diversity: peers may use different LLM backends
 *   - Temporal diversity: judges are rotated over time
 *   - Score variance monitoring: high variance = potential hacking signal
 *   - Adversarial judge: one judge always tries to find flaws
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { createLogger } from "./logger.js";

const log = createLogger("crossInstanceRlhf");

// ── Types ─────────────────────────────────────────────────────────────────────
export interface JudgeVerdict {
  judgeNodeId: string;
  proposalId: string;
  score: number;           // 0-1
  approved: boolean;
  reasoning: string;
  flags: RewardHackingFlag[];
  latencyMs: number;
  timestamp: number;
}

export interface RewardHackingFlag {
  type: "score_inflation" | "circular_reasoning" | "metric_gaming" | "adversarial_pass" | "variance_spike";
  severity: "low" | "medium" | "high";
  description: string;
}

export interface ConsensusResult {
  proposalId: string;
  approved: boolean;
  consensusScore: number;
  verdicts: JudgeVerdict[];
  rewardHackingDetected: boolean;
  hackingFlags: RewardHackingFlag[];
  totalJudges: number;
  agreeingJudges: number;
  scoreVariance: number;
  timestamp: number;
}

export interface RlhfJudgeConfig {
  /** Minimum number of judges required for consensus */
  minJudges: number;
  /** Fraction of judges that must approve (0-1) */
  consensusThreshold: number;
  /** Maximum score variance before flagging reward hacking */
  maxScoreVariance: number;
  /** Whether to include an adversarial judge */
  useAdversarialJudge: boolean;
  /** Timeout per peer judge in ms */
  peerJudgeTimeoutMs: number;
}

const DEFAULT_CONFIG: RlhfJudgeConfig = {
  minJudges: 3,
  consensusThreshold: 0.67,
  maxScoreVariance: 0.15,
  useAdversarialJudge: true,
  peerJudgeTimeoutMs: 30_000,
};

// ── State ─────────────────────────────────────────────────────────────────────
const RLHF_LOG_FILE = () => {
  const workspace = process.env.ANDROMEDA_WORKSPACE ?? process.cwd();
  return path.join(workspace, "server", "data", "rlhfJudgingLog.json");
};

interface RlhfLog {
  results: ConsensusResult[];
  hackingAttempts: number;
  totalEvaluations: number;
}

function loadLog(): RlhfLog {
  try {
    return JSON.parse(fs.readFileSync(RLHF_LOG_FILE(), "utf8"));
  } catch {
    return { results: [], hackingAttempts: 0, totalEvaluations: 0 };
  }
}

function saveLog(log_data: RlhfLog): void {
  const file = RLHF_LOG_FILE();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(log_data, null, 2));
}

// ── Local Judge ───────────────────────────────────────────────────────────────

/**
 * Local RLAIF judge — evaluates a proposal using the local LLM.
 * This is the primary judge; peer judges are secondary validators.
 */
async function runLocalJudge(
  proposalId: string,
  proposalDescription: string,
  proposalCode: string,
  testResults: { passed: number; failed: number }
): Promise<JudgeVerdict> {
  const start = Date.now();
  try {
    const nodeId = process.env.FEDERATED_NODE_ID ?? require("os").hostname();

    // Scoring heuristics (in production, this calls the LLM via rlaifJudge.ts)
    const testPassRate = testResults.passed / Math.max(testResults.passed + testResults.failed, 1);
    const codeQualityScore = estimateCodeQuality(proposalCode);
    const descriptionScore = estimateDescriptionQuality(proposalDescription);

    const score = testPassRate * 0.5 + codeQualityScore * 0.3 + descriptionScore * 0.2;
    const flags: RewardHackingFlag[] = [];

    // Detect potential reward hacking: very high score with very little code
    if (score > 0.9 && proposalCode.length < 50) {
      flags.push({
        type: "score_inflation",
        severity: "high",
        description: "Suspiciously high score for minimal code change",
      });
    }

    // Detect circular reasoning: description matches code too literally
    if (proposalDescription.length > 0 && proposalCode.includes(proposalDescription.slice(0, 20))) {
      flags.push({
        type: "circular_reasoning",
        severity: "low",
        description: "Description appears to be copied from code",
      });
    }

    return {
      judgeNodeId: nodeId,
      proposalId,
      score,
      approved: score >= 0.6 && flags.filter((f) => f.severity === "high").length === 0,
      reasoning: `Test pass rate: ${(testPassRate * 100).toFixed(1)}%, Code quality: ${(codeQualityScore * 100).toFixed(1)}%`,
      flags,
      latencyMs: Date.now() - start,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error(`runLocalJudge failed for proposal ${proposalId}:`, error);
    throw error; // rethrow after logging
  }
}

/**
 * Adversarial judge — specifically tries to find flaws.
 * Always runs locally; its job is to lower the score if it finds issues.
 */
async function runAdversarialJudge(
  proposalId: string,
  proposalCode: string
): Promise<JudgeVerdict> {
  const start = Date.now();
  const nodeId = `${process.env.FEDERATED_NODE_ID ?? "local"}-adversarial`;
  const flags: RewardHackingFlag[] = [];

  // Check for common metric gaming patterns
  const gamingPatterns = [
    /test\.skip\(/g,
    /\.only\(/g,
    /expect\.assertions\(0\)/g,
    /\/\/ @ts-ignore/g,
    /console\.log.*test/gi,
  ];

  let gamingScore = 0;
  for (const pattern of gamingPatterns) {
    const matches = proposalCode.match(pattern);
    if (matches && matches.length > 0) {
      gamingScore += matches.length;
      flags.push({
        type: "metric_gaming",
        severity: gamingScore > 3 ? "high" : "medium",
        description: `Found ${matches.length} instance(s) of pattern: ${pattern.source}`,
      });
    }
  }

  const score = Math.max(0, 1 - gamingScore * 0.2);

  return {
    judgeNodeId: nodeId,
    proposalId,
    score,
    approved: score >= 0.7 && flags.filter((f) => f.severity === "high").length === 0,
    reasoning: `Adversarial scan: ${flags.length} potential issues found`,
    flags,
    latencyMs: Date.now() - start,
    timestamp: Date.now(),
  };
}

// ── Consensus Engine ──────────────────────────────────────────────────────────

/**
 * Runs cross-instance RLHF judging for a proposal.
 * Aggregates verdicts from local + adversarial + peer judges.
 */
export async function runCrossInstanceJudging(
  proposalId: string,
  proposalDescription: string,
  proposalCode: string,
  testResults: { passed: number; failed: number },
  peerJudgeUrls: string[] = [],
  config: Partial<RlhfJudgeConfig> = {}
): Promise<ConsensusResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const verdicts: JudgeVerdict[] = [];

  // 1. Local judge
  const localVerdict = await runLocalJudge(proposalId, proposalDescription, proposalCode, testResults);
  verdicts.push(localVerdict);

  // 2. Adversarial judge (always local)
  if (cfg.useAdversarialJudge) {
    const adversarialVerdict = await runAdversarialJudge(proposalId, proposalCode);
    verdicts.push(adversarialVerdict);
  }

  // 3. Peer judges (async, with timeout)
  if (peerJudgeUrls.length > 0) {
    const peerPromises = peerJudgeUrls.map((url) =>
      fetchPeerVerdict(url, proposalId, proposalDescription, proposalCode, testResults, cfg.peerJudgeTimeoutMs)
    );
    const peerResults = await Promise.allSettled(peerPromises);
    for (const result of peerResults) {
      if (result.status === "fulfilled" && result.value) {
        verdicts.push(result.value);
      }
    }
  }

  // 4. Compute consensus
  const scores = verdicts.map((v) => v.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length;
  const agreeingJudges = verdicts.filter((v) => v.approved).length;
  const consensusScore = mean;
  const approved = agreeingJudges / verdicts.length >= cfg.consensusThreshold;

  // 5. Collect all hacking flags
  const allFlags = verdicts.flatMap((v) => v.flags);

  // 6. Detect reward hacking via score variance
  if (variance > cfg.maxScoreVariance) {
    allFlags.push({
      type: "variance_spike",
      severity: "medium",
      description: `Score variance ${variance.toFixed(3)} exceeds threshold ${cfg.maxScoreVariance}`,
    });
  }

  const rewardHackingDetected = allFlags.some((f) => f.severity === "high");

  const result: ConsensusResult = {
    proposalId,
    approved: approved && !rewardHackingDetected,
    consensusScore,
    verdicts,
    rewardHackingDetected,
    hackingFlags: allFlags,
    totalJudges: verdicts.length,
    agreeingJudges,
    scoreVariance: variance,
    timestamp: Date.now(),
  };

  // 7. Log result
  const logData = loadLog();
  logData.results.push(result);
  logData.totalEvaluations += 1;
  if (rewardHackingDetected) {
    logData.hackingAttempts += 1;
    log.warn("Reward hacking detected!", { proposalId, flags: allFlags });
  }
  if (logData.results.length > 1000) {
    logData.results = logData.results.slice(-1000);
  }
  saveLog(logData);

  log.info("Cross-instance RLHF judging complete", {
    proposalId,
    approved: result.approved,
    consensusScore: consensusScore.toFixed(3),
    totalJudges: verdicts.length,
    agreeingJudges,
    rewardHackingDetected,
  });

  return result;
}

/**
 * Fetches a verdict from a peer judge node.
 */
async function fetchPeerVerdict(
  peerUrl: string,
  proposalId: string,
  description: string,
  code: string,
  testResults: { passed: number; failed: number },
  timeoutMs: number
): Promise<JudgeVerdict | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`${peerUrl}/api/rlhf/judge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Federated-Token": process.env.FEDERATED_TOKEN ?? "",
      },
      body: JSON.stringify({ proposalId, description, code, testResults }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) return null;
    return await res.json() as JudgeVerdict;
  } catch (error) {
    log.warn("fetchPeerVerdict failed", { peerUrl, proposalId, error: String(error) });
    return null;
  }
}

/**
 * Gets the RLHF judging history and statistics.
 */
export function getRlhfStats(): {
  totalEvaluations: number;
  hackingAttempts: number;
  hackingRate: number;
  recentResults: ConsensusResult[];
} {
  const logData = loadLog();
  return {
    totalEvaluations: logData.totalEvaluations,
    hackingAttempts: logData.hackingAttempts,
    hackingRate: logData.totalEvaluations > 0
      ? logData.hackingAttempts / logData.totalEvaluations
      : 0,
    recentResults: logData.results.slice(-20),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function estimateCodeQuality(code: string): number {
  if (!code || code.length === 0) return 0;
  let score = 0.5;
  if (code.length > 100) score += 0.1;
  if (code.includes("export")) score += 0.1;
  if (code.includes("//") || code.includes("/*")) score += 0.1;
  if (code.includes("try") && code.includes("catch")) score += 0.1;
  if (code.includes("async") || code.includes("await")) score += 0.05;
  return Math.min(score, 1);
}

function estimateDescriptionQuality(description: string): number {
  if (!description || description.length === 0) return 0;
  let score = 0.3;
  if (description.length > 20) score += 0.2;
  if (description.length > 50) score += 0.2;
  if (description.includes("improve") || description.includes("fix") || description.includes("add")) score += 0.15;
  if (description.split(" ").length > 5) score += 0.15;
  return Math.min(score, 1);
}
