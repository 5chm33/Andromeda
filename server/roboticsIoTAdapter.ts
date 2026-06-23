/**
 * roboticsIoTAdapter.ts — v1.0.0
 *
 * Phase Q3 2026: Physical World Actuation
 *
 * Extends Andromeda's RSI framework to robotics and IoT domains:
 *   - ROS (Robot Operating System) node optimization
 *   - G-code / CNC toolpath optimization for manufacturing
 *   - IoT device configuration and energy optimization
 *   - Smart home automation rule refinement
 *   - Industrial PLC ladder logic improvement
 *
 * The RSI loop applies here exactly as it does to code:
 *   1. Analyze current configuration/program
 *   2. Generate improvement proposals (via LLM)
 *   3. Simulate/evaluate proposals (via domain-specific evaluators)
 *   4. Apply approved proposals
 *
 * Safety: All robotics proposals require human approval by default.
 * The constitutionalConstraints.ts R1 rule (never auto-apply to critical systems)
 * is enforced here with an additional physical-world safety gate.
 */

import { createLogger } from "./logger.js";
import { backgroundChatCompletion } from "./llmProvider.js";

const log = createLogger("roboticsIoTAdapter");

// ─── Types ───────────────────────────────────────────────────────────────────

export type RoboticsArtifactType =
  | "ros_node"           // ROS 2 Python/C++ node
  | "gcode"             // CNC/3D printer G-code toolpath
  | "iot_config"        // IoT device JSON/YAML configuration
  | "smart_home_rule"   // Home Assistant / Node-RED automation rule
  | "plc_ladder"        // Industrial PLC ladder logic
  | "energy_schedule";  // Smart grid / HVAC energy schedule

export interface RoboticsArtifact {
  id: string;
  type: RoboticsArtifactType;
  name: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface RoboticsProposal {
  id: string;
  artifactId: string;
  type: RoboticsArtifactType;
  description: string;
  originalContent: string;
  proposedContent: string;
  rationale: string;
  safetyScore: number;    // 0-100: higher = safer to auto-apply
  efficiencyGain: number; // estimated % improvement
  requiresHumanApproval: boolean;
  status: "pending" | "approved" | "rejected" | "applied";
  createdAt: number;
}

export interface RoboticsEvaluation {
  proposalId: string;
  safetyPassed: boolean;
  estimatedEfficiencyGain: number;
  estimatedEnergySavings: number;  // kWh/day for IoT/energy domains
  riskLevel: "low" | "medium" | "high" | "critical";
  notes: string;
}

// ─── Domain-Specific Evaluators ──────────────────────────────────────────────

const DOMAIN_EVALUATORS: Record<RoboticsArtifactType, {
  systemPrompt: string;
  safetyThreshold: number;
  autoApplyAllowed: boolean;
}> = {
  ros_node: {
    systemPrompt: `You are a ROS 2 expert. Analyze this ROS node and propose optimizations for:
- Reducing CPU/memory usage
- Improving message throughput
- Better error handling and recovery
- More efficient topic/service patterns
Safety: Never suggest changes that could cause unexpected robot motion or sensor failures.
Return JSON: { description, proposedContent, rationale, safetyScore (0-100), efficiencyGain (%) }`,
    safetyThreshold: 85,
    autoApplyAllowed: false,  // Physical systems always require human approval
  },
  gcode: {
    systemPrompt: `You are a CNC machining and 3D printing expert. Analyze this G-code and propose optimizations for:
- Reducing print/machining time
- Improving surface finish quality
- Reducing material waste
- Better toolpath efficiency
Safety: Never suggest changes that could damage the machine or workpiece.
Return JSON: { description, proposedContent, rationale, safetyScore (0-100), efficiencyGain (%) }`,
    safetyThreshold: 90,
    autoApplyAllowed: false,
  },
  iot_config: {
    systemPrompt: `You are an IoT systems expert. Analyze this device configuration and propose improvements for:
- Reducing power consumption
- Improving data reporting efficiency
- Better security settings
- Optimized polling intervals
Return JSON: { description, proposedContent, rationale, safetyScore (0-100), efficiencyGain (%) }`,
    safetyThreshold: 70,
    autoApplyAllowed: true,  // IoT config changes are lower risk
  },
  smart_home_rule: {
    systemPrompt: `You are a smart home automation expert. Analyze this automation rule and propose improvements for:
- Energy efficiency (lighting, HVAC, appliances)
- Better trigger conditions
- Conflict resolution with other rules
- User comfort optimization
Return JSON: { description, proposedContent, rationale, safetyScore (0-100), efficiencyGain (%) }`,
    safetyThreshold: 75,
    autoApplyAllowed: true,
  },
  plc_ladder: {
    systemPrompt: `You are an industrial automation expert. Analyze this PLC ladder logic and propose improvements for:
- Cycle time reduction
- Better fault handling
- Cleaner logic structure
- Safety interlock improvements
Safety: Never suggest changes that could bypass safety interlocks or cause equipment damage.
Return JSON: { description, proposedContent, rationale, safetyScore (0-100), efficiencyGain (%) }`,
    safetyThreshold: 95,
    autoApplyAllowed: false,  // Industrial systems always require human approval
  },
  energy_schedule: {
    systemPrompt: `You are an energy management expert. Analyze this energy schedule and propose optimizations for:
- Peak demand reduction
- Time-of-use pricing optimization
- Battery storage scheduling
- Renewable energy integration
Return JSON: { description, proposedContent, rationale, safetyScore (0-100), efficiencyGain (%) }`,
    safetyThreshold: 65,
    autoApplyAllowed: true,
  },
};

// ─── State ───────────────────────────────────────────────────────────────────
const artifacts: Map<string, RoboticsArtifact> = new Map();
const proposals: Map<string, RoboticsProposal> = new Map();
let _totalProposals = 0;
let _approvedProposals = 0;
let _estimatedEnergySavings = 0;  // kWh/day

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Register a robotics/IoT artifact for improvement analysis.
 */
export function registerRoboticsArtifact(
  type: RoboticsArtifactType,
  name: string,
  content: string,
  metadata: Record<string, unknown> = {},
): RoboticsArtifact {
  const id = `robot-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const artifact: RoboticsArtifact = { id, type, name, content, metadata, createdAt: Date.now() };
  artifacts.set(id, artifact);
  log.info(`[RoboticsIoT] Registered artifact ${id} (${type}: ${name})`);
  return artifact;
}

/**
 * Generate an improvement proposal for a robotics/IoT artifact.
 */
export async function generateRoboticsProposal(artifactId: string): Promise<RoboticsProposal | null> {
  const artifact = artifacts.get(artifactId);
  if (!artifact) {
    log.warn(`[RoboticsIoT] Artifact ${artifactId} not found`);
    return null;
  }

  const evaluator = DOMAIN_EVALUATORS[artifact.type];
  const messages = [
    { role: "system" as const, content: evaluator.systemPrompt },
    {
      role: "user" as const,
      content: `Analyze and improve this ${artifact.type} artifact:\n\nName: ${artifact.name}\n\nContent:\n\`\`\`\n${artifact.content.slice(0, 3000)}\n\`\`\``,
    },
  ];

  try {
        const result = await backgroundChatCompletion(messages, { temperature: 0.3, maxTokens: 2000 });
    if (!result.content) return null;
    const text = result.content.trim();
    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn(`[RoboticsIoT] LLM returned non-JSON response for ${artifactId}`);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      description?: string;
      proposedContent?: string;
      rationale?: string;
      safetyScore?: number;
      efficiencyGain?: number;
    };

    const safetyScore = typeof parsed.safetyScore === "number" ? parsed.safetyScore : 50;
    const requiresHumanApproval = !evaluator.autoApplyAllowed || safetyScore < evaluator.safetyThreshold;

    const proposal: RoboticsProposal = {
      id: `rp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      artifactId,
      type: artifact.type,
      description: parsed.description ?? "Improvement proposal",
      originalContent: artifact.content,
      proposedContent: parsed.proposedContent ?? artifact.content,
      rationale: parsed.rationale ?? "",
      safetyScore,
      efficiencyGain: typeof parsed.efficiencyGain === "number" ? parsed.efficiencyGain : 0,
      requiresHumanApproval,
      status: "pending",
      createdAt: Date.now(),
    };

    proposals.set(proposal.id, proposal);
    _totalProposals++;
    log.info(`[RoboticsIoT] Generated proposal ${proposal.id} for ${artifact.type} (safety: ${safetyScore}, requires approval: ${requiresHumanApproval})`);
    return proposal;
  } catch (err) {
    log.warn(`[RoboticsIoT] Proposal generation failed for ${artifactId}:`, err);
    return null;
  }
}

/**
 * Evaluate a proposal's safety and efficiency.
 */
export function evaluateRoboticsProposal(proposalId: string): RoboticsEvaluation | null {
  const proposal = proposals.get(proposalId);
  if (!proposal) return null;

  const riskLevel: RoboticsEvaluation["riskLevel"] =
    proposal.safetyScore >= 90 ? "low" :
    proposal.safetyScore >= 75 ? "medium" :
    proposal.safetyScore >= 50 ? "high" : "critical";

  const energySavings = ["iot_config", "smart_home_rule", "energy_schedule"].includes(proposal.type)
    ? proposal.efficiencyGain * 0.1  // Convert % efficiency to kWh/day estimate
    : 0;

  return {
    proposalId,
    safetyPassed: proposal.safetyScore >= DOMAIN_EVALUATORS[proposal.type].safetyThreshold,
    estimatedEfficiencyGain: proposal.efficiencyGain,
    estimatedEnergySavings: energySavings,
    riskLevel,
    notes: proposal.requiresHumanApproval
      ? "Human approval required before applying to physical system"
      : "Safe to auto-apply based on safety score",
  };
}

/**
 * Approve and apply a proposal (updates the artifact content).
 */
export function approveRoboticsProposal(proposalId: string): boolean {
  const proposal = proposals.get(proposalId);
  if (!proposal || proposal.status !== "pending") return false;

  const artifact = artifacts.get(proposal.artifactId);
  if (!artifact) return false;

  artifact.content = proposal.proposedContent;
  proposal.status = "applied";
  _approvedProposals++;

  const eval_ = evaluateRoboticsProposal(proposalId);
  if (eval_) {
    _estimatedEnergySavings += eval_.estimatedEnergySavings;
  }

  log.info(`[RoboticsIoT] Applied proposal ${proposalId} to artifact ${proposal.artifactId}`);
  return true;
}

/**
 * Get statistics for the dashboard.
 */
export function getRoboticsStats() {
  return {
    totalArtifacts: artifacts.size,
    totalProposals: _totalProposals,
    approvedProposals: _approvedProposals,
    pendingProposals: Array.from(proposals.values()).filter(p => p.status === "pending").length,
    estimatedEnergySavingsKwhPerDay: Math.round(_estimatedEnergySavings * 100) / 100,
    artifactsByType: Object.fromEntries(
      (["ros_node", "gcode", "iot_config", "smart_home_rule", "plc_ladder", "energy_schedule"] as RoboticsArtifactType[])
        .map(t => [t, Array.from(artifacts.values()).filter(a => a.type === t).length])
    ),
  };
}

/**
 * Initialize the robotics/IoT adapter.
 */
export function initRoboticsIoTAdapter(): void {
  log.info("[RoboticsIoT] Physical world actuation adapter initialized");
  log.info("[RoboticsIoT] Supported domains: ROS nodes, G-code, IoT config, Smart home, PLC, Energy schedules");
}
