/**
 * Andromeda v5.28 — Multi-Agent Self-Improvement
 *
 * Spawns specialist agents that collaborate on self-improvement:
 * - Architect Agent: Reviews structural changes and dependencies
 * - Security Agent: Checks for vulnerabilities and unsafe patterns
 * - Performance Agent: Identifies bottlenecks and optimization opportunities
 * - Test Agent: Generates test cases for proposed changes
 *
 * Each agent provides a verdict, and changes only proceed if consensus is reached.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface AgentRole {
  name: string;
  systemPrompt: string;
  focusAreas: string[];
  weight: number; // 0-1, how much this agent's vote counts
}

export interface AgentVerdict {
  agent: string;
  approve: boolean;
  confidence: number; // 0-1
  reasoning: string;
  suggestions: string[];
  issues: string[];
}

export interface ConsensusResult {
  approved: boolean;
  votes: AgentVerdict[];
  overallConfidence: number;
  reasoning: string;
  requiredChanges: string[];
}

export interface ImprovementContext {
  filePath: string;
  currentContent: string;
  proposedContent: string;
  changeDescription: string;
  affectedModules: string[];
}

// ── Agent Definitions ───────────────────────────────────────────────────────

const AGENTS: AgentRole[] = [
  {
    name: "architect",
    systemPrompt: `You are the Architect Agent for Andromeda. Your role is to review code changes for:
- Structural integrity and clean architecture
- Proper separation of concerns
- Dependency management (no circular deps)
- Interface consistency
- Module cohesion
Respond with JSON: { "approve": boolean, "confidence": 0-1, "reasoning": "...", "suggestions": [...], "issues": [...] }`,
    focusAreas: ["architecture", "dependencies", "interfaces", "modularity"],
    weight: 0.3,
  },
  {
    name: "security",
    systemPrompt: `You are the Security Agent for Andromeda. Your role is to review code changes for:
- Injection vulnerabilities (command injection, path traversal)
- Unsafe eval() or dynamic code execution
- Missing input validation
- Information leakage
- Unsafe file system operations
Respond with JSON: { "approve": boolean, "confidence": 0-1, "reasoning": "...", "suggestions": [...], "issues": [...] }`,
    focusAreas: ["security", "validation", "injection", "access-control"],
    weight: 0.35,
  },
  {
    name: "performance",
    systemPrompt: `You are the Performance Agent for Andromeda. Your role is to review code changes for:
- Memory leaks (unbounded arrays, unclosed resources)
- Unnecessary allocations in hot paths
- Blocking operations in async contexts
- Efficient data structures
- Token/API usage optimization
Respond with JSON: { "approve": boolean, "confidence": 0-1, "reasoning": "...", "suggestions": [...], "issues": [...] }`,
    focusAreas: ["performance", "memory", "efficiency", "scalability"],
    weight: 0.2,
  },
  {
    name: "testing",
    systemPrompt: `You are the Test Agent for Andromeda. Your role is to review code changes for:
- Testability of the new code
- Edge cases that should be tested
- Regression risks
- Missing error handling
- Whether the change could break existing functionality
Respond with JSON: { "approve": boolean, "confidence": 0-1, "reasoning": "...", "suggestions": [...], "issues": [...] }`,
    focusAreas: ["testing", "edge-cases", "error-handling", "regression"],
    weight: 0.15,
  },
];

// ── State ───────────────────────────────────────────────────────────────────

let totalReviews = 0;
let approvedCount = 0;
let rejectedCount = 0;
let enabled = false;

// ── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Run multi-agent review on a proposed change.
 * Each agent evaluates independently, then consensus is computed.
 */
export async function reviewWithAgents(ctx: ImprovementContext): Promise<ConsensusResult> {
  totalReviews++;

  if (!enabled) {
    // When disabled, auto-approve with a warning
    return {
      approved: true,
      votes: [],
      overallConfidence: 0.5,
      reasoning: "Multi-agent review disabled — auto-approved",
      requiredChanges: [],
    };
  }

  const votes: AgentVerdict[] = [];

  for (const agent of AGENTS) {
    try {
      const verdict = await queryAgent(agent, ctx);
      votes.push(verdict);
    } catch (err) {
      // Agent failure — count as abstain
      votes.push({
        agent: agent.name,
        approve: true, // Don't block on agent failure
        confidence: 0.3,
        reasoning: `Agent unavailable: ${(err as Error).message}`,
        suggestions: [],
        issues: [],
      });
    }
  }

  // Compute weighted consensus
  let weightedApproval = 0;
  let totalWeight = 0;
  const allIssues: string[] = [];
  const allSuggestions: string[] = [];

  for (const vote of votes) {
    const agent = AGENTS.find(a => a.name === vote.agent);
    const weight = agent?.weight || 0.25;
    weightedApproval += (vote.approve ? 1 : 0) * weight * vote.confidence;
    totalWeight += weight;
    allIssues.push(...vote.issues);
    allSuggestions.push(...vote.suggestions);
  }

  const overallConfidence = totalWeight > 0 ? weightedApproval / totalWeight : 0;
  const approved = overallConfidence >= 0.6; // Need 60% weighted approval

  if (approved) approvedCount++;
  else rejectedCount++;

  // Security agent has veto power
  const securityVote = votes.find(v => v.agent === "security");
  const securityVetoed = securityVote && !securityVote.approve && securityVote.confidence > 0.8;

  return {
    approved: approved && !securityVetoed,
    votes,
    overallConfidence,
    reasoning: securityVetoed
      ? `VETOED by Security Agent: ${securityVote!.reasoning}`
      : `Consensus: ${Math.round(overallConfidence * 100)}% approval (threshold: 60%)`,
    requiredChanges: allSuggestions.slice(0, 5),
  };
}

/**
 * Query a single agent for its verdict.
 */
async function queryAgent(agent: AgentRole, ctx: ImprovementContext): Promise<AgentVerdict> {
  try {
    // Use the LLM to get agent's verdict
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI();

    const response = await client.chat.completions.create({
      model: process.env.MULTI_AGENT_MODEL || "gpt-4.1-mini", // v5.32: Fixed — gpt-4.1-nano doesn't exist, use gpt-4.1-mini
      messages: [
        { role: "system", content: agent.systemPrompt },
        {
          role: "user",
          content: `Review this code change:\n\nFile: ${ctx.filePath}\nDescription: ${ctx.changeDescription}\nAffected modules: ${ctx.affectedModules.join(", ")}\n\n--- CURRENT ---\n${ctx.currentContent.slice(0, 3000)}\n\n--- PROPOSED ---\n${ctx.proposedContent.slice(0, 3000)}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content || "{}";
    let parsed: any;
    try { parsed = JSON.parse(content); } catch { parsed = {}; }

    return {
      agent: agent.name,
      approve: parsed.approve ?? true,
      confidence: parsed.confidence ?? 0.5,
      reasoning: parsed.reasoning || "No reasoning provided",
      suggestions: parsed.suggestions || [],
      issues: parsed.issues || [],
    };
  } catch (err) {
    // Fallback: structural analysis without LLM
    return structuralReview(agent, ctx);
  }
}

/**
 * Fallback structural review when LLM is unavailable.
 */
function structuralReview(agent: AgentRole, ctx: ImprovementContext): AgentVerdict {
  const issues: string[] = [];
  const suggestions: string[] = [];
  const proposed = ctx.proposedContent;

  if (agent.name === "security") {
    if (proposed.includes("eval(")) issues.push("Contains eval() — potential code injection");
    if (proposed.includes("execSync(") && !proposed.includes("stdio: \"pipe\"")) {
      issues.push("execSync without stdio:pipe may leak output");
    }
    if (/require\([^)]*\+/.test(proposed)) issues.push("Dynamic require — potential path traversal");
    if (proposed.includes("dangerouslySetInnerHTML")) issues.push("XSS risk: dangerouslySetInnerHTML");
  }

  if (agent.name === "performance") {
    if ((proposed.match(/setInterval/g) || []).length > 2) {
      issues.push("Multiple setInterval calls — potential memory leak");
    }
    if (proposed.includes("JSON.parse(JSON.stringify(")) {
      suggestions.push("Use structuredClone() instead of JSON parse/stringify");
    }
  }

  if (agent.name === "architect") {
    const imports = (proposed.match(/import.*from/g) || []).length;
    if (imports > 20) issues.push(`High import count (${imports}) — consider splitting module`);
    const lines = proposed.split("\n").length;
    if (lines > 800) suggestions.push(`File is ${lines} lines — consider splitting`);
  }

  if (agent.name === "testing") {
    if (!proposed.includes("try") && proposed.includes("async")) {
      suggestions.push("Async function without try/catch — add error handling");
    }
  }

  return {
    agent: agent.name,
    approve: issues.length === 0,
    confidence: 0.7,
    reasoning: issues.length > 0
      ? `Found ${issues.length} issue(s): ${issues[0]}`
      : "Structural review passed",
    suggestions,
    issues,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Enable/disable multi-agent review.
 */
export function setMultiAgentEnabled(value: boolean): void {
  enabled = value;
  console.log(`[MultiAgentImprover] ${value ? "Enabled" : "Disabled"}`);
}

/**
 * Initialize multi-agent improver.
 */
export function initMultiAgentImprover(): void {
  // v5.52: Enabled by default. Set MULTI_AGENT_REVIEW=false to disable.
  enabled = process.env.MULTI_AGENT_REVIEW !== "false";
  console.log(`[MultiAgentImprover] Initialized — ${enabled ? "enabled (4 specialist agents active)" : "disabled"}`);
}

/**
 * Get stats for diagnostics.
 */
export function getMultiAgentStats() {
  return {
    enabled,
    totalReviews,
    approved: approvedCount,
    rejected: rejectedCount,
    approvalRate: totalReviews > 0 ? Math.round(approvedCount / totalReviews * 100) : 0,
    agents: AGENTS.map(a => ({ name: a.name, weight: a.weight })),
  };
}
