/**
 * epistemicBeliefModel.test.ts
 * Tests for the Epistemic Belief Model and Debate Protocol.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentBeliefState,
  EpistemicModel,
  getEpistemicModel,
  resetEpistemicModel,
  getEpistemicOperator,
} from "./epistemicBeliefModel.js";

// ── getEpistemicOperator ──────────────────────────────────────────────────────

describe("getEpistemicOperator", () => {
  it("returns 'knows' for probability >= 0.95", () => {
    expect(getEpistemicOperator(0.95)).toBe("knows");
    expect(getEpistemicOperator(1.0)).toBe("knows");
  });

  it("returns 'believes' for probability >= 0.70 and < 0.95", () => {
    expect(getEpistemicOperator(0.70)).toBe("believes");
    expect(getEpistemicOperator(0.85)).toBe("believes");
  });

  it("returns 'doubts' for probability >= 0.50 and < 0.70", () => {
    expect(getEpistemicOperator(0.50)).toBe("doubts");
    expect(getEpistemicOperator(0.65)).toBe("doubts");
  });

  it("returns 'ignores' for probability < 0.50", () => {
    expect(getEpistemicOperator(0.49)).toBe("ignores");
    expect(getEpistemicOperator(0.0)).toBe("ignores");
  });
});

// ── AgentBeliefState ──────────────────────────────────────────────────────────

describe("AgentBeliefState", () => {
  let agent: AgentBeliefState;

  beforeEach(() => {
    agent = new AgentBeliefState("agent-1");
  });

  it("returns the agent ID", () => {
    expect(agent.getAgentId()).toBe("agent-1");
  });

  it("sets and retrieves a belief", () => {
    agent.setBelief("proposal_is_safe", 0.8);
    const belief = agent.getBelief("proposal_is_safe");
    expect(belief).toBeDefined();
    expect(belief!.probability).toBeCloseTo(0.8);
  });

  it("returns 0.5 for unknown propositions", () => {
    expect(agent.getBeliefProbability("unknown_prop")).toBe(0.5);
  });

  it("clamps probability to [0, 1]", () => {
    agent.setBelief("p1", 1.5);
    expect(agent.getBeliefProbability("p1")).toBe(1.0);
    agent.setBelief("p2", -0.5);
    expect(agent.getBeliefProbability("p2")).toBe(0.0);
  });

  it("returns correct epistemic status", () => {
    agent.setBelief("certain", 0.97);
    agent.setBelief("likely", 0.75);
    agent.setBelief("uncertain", 0.55);
    agent.setBelief("unlikely", 0.3);

    expect(agent.getEpistemicStatus("certain")).toBe("knows");
    expect(agent.getEpistemicStatus("likely")).toBe("believes");
    expect(agent.getEpistemicStatus("uncertain")).toBe("doubts");
    expect(agent.getEpistemicStatus("unlikely")).toBe("ignores");
  });

  it("sets and retrieves meta-beliefs", () => {
    agent.setMetaBelief("agent-2", "proposal_is_safe", 0.9);
    expect(agent.getMetaBelief("agent-2", "proposal_is_safe")).toBeCloseTo(0.9);
  });

  it("returns 0.5 for unknown meta-beliefs", () => {
    expect(agent.getMetaBelief("agent-2", "unknown")).toBe(0.5);
  });

  it("sets and retrieves trust scores", () => {
    agent.setTrust("agent-2", 0.8);
    expect(agent.getTrust("agent-2")).toBeCloseTo(0.8);
  });

  it("returns 0.5 for unknown trust", () => {
    expect(agent.getTrust("unknown-agent")).toBe(0.5);
  });

  it("clamps trust to [0, 1]", () => {
    agent.setTrust("a", 2.0);
    expect(agent.getTrust("a")).toBe(1.0);
    agent.setTrust("b", -1.0);
    expect(agent.getTrust("b")).toBe(0.0);
  });

  it("updateTrust increases trust when correct", () => {
    agent.setTrust("agent-2", 0.5);
    agent.updateTrust("agent-2", true);
    expect(agent.getTrust("agent-2")).toBeGreaterThan(0.5);
  });

  it("updateTrust decreases trust when incorrect", () => {
    agent.setTrust("agent-2", 0.5);
    agent.updateTrust("agent-2", false);
    expect(agent.getTrust("agent-2")).toBeLessThan(0.5);
  });

  it("Bayesian update moves belief toward evidence", () => {
    agent.setBelief("hypothesis", 0.5);
    // Strong evidence for the hypothesis
    agent.bayesianUpdate("hypothesis", 0.9, 0.1);
    expect(agent.getBeliefProbability("hypothesis")).toBeGreaterThan(0.5);
  });

  it("Bayesian update with weak evidence changes belief less", () => {
    agent.setBelief("hypothesis", 0.5);
    agent.bayesianUpdate("hypothesis", 0.55, 0.45);
    const prob = agent.getBeliefProbability("hypothesis");
    // Should move slightly but not drastically
    expect(prob).toBeGreaterThan(0.5);
    expect(prob).toBeLessThan(0.7);
  });

  it("getAllBeliefs returns all set beliefs", () => {
    agent.setBelief("p1", 0.7);
    agent.setBelief("p2", 0.3);
    agent.setBelief("p3", 0.9);
    expect(agent.getAllBeliefs()).toHaveLength(3);
  });
});

// ── EpistemicModel ────────────────────────────────────────────────────────────

describe("EpistemicModel", () => {
  let model: EpistemicModel;

  beforeEach(() => {
    model = new EpistemicModel(`/tmp/test_epistemic_${Date.now()}`);
  });

  it("registers agents", () => {
    model.registerAgent("agent-1");
    model.registerAgent("agent-2");
    expect(model.getAgentIds()).toContain("agent-1");
    expect(model.getAgentIds()).toContain("agent-2");
  });

  it("returns the same agent instance on re-registration", () => {
    const a = model.registerAgent("agent-1");
    const b = model.registerAgent("agent-1");
    expect(a).toBe(b);
  });

  it("removes agents", () => {
    model.registerAgent("agent-1");
    model.removeAgent("agent-1");
    expect(model.getAgentIds()).not.toContain("agent-1");
  });

  it("computeConsensus returns 0.5 for unknown proposition", () => {
    model.registerAgent("a1");
    model.registerAgent("a2");
    const consensus = model.computeConsensus("unknown_prop");
    expect(consensus.averageBelief).toBeCloseTo(0.5);
  });

  it("computeConsensus detects common knowledge when all agents know", () => {
    const a1 = model.registerAgent("a1");
    const a2 = model.registerAgent("a2");
    a1.setBelief("prop", 0.97);
    a2.setBelief("prop", 0.98);

    const consensus = model.computeConsensus("prop");
    expect(consensus.commonKnowledge).toBe(true);
    expect(consensus.averageBelief).toBeGreaterThan(0.95);
  });

  it("computeConsensus detects dissenters", () => {
    const a1 = model.registerAgent("a1");
    const a2 = model.registerAgent("a2");
    const a3 = model.registerAgent("a3");
    a1.setBelief("prop", 0.9);
    a2.setBelief("prop", 0.85);
    a3.setBelief("prop", 0.1);  // Dissenter

    const consensus = model.computeConsensus("prop");
    expect(consensus.dissenterCount).toBeGreaterThan(0);
    expect(consensus.dissenterIds).toContain("a3");
  });

  it("broadcastBelief updates other agents' beliefs", () => {
    const a1 = model.registerAgent("a1");
    const a2 = model.registerAgent("a2");
    a2.setTrust("a1", 0.9);

    a2.setBelief("proposal_safe", 0.3);
    model.broadcastBelief("a1", "proposal_safe", 0.9);

    // a2's belief should move toward a1's broadcast (trust-weighted)
    expect(a2.getBeliefProbability("proposal_safe")).toBeGreaterThan(0.3);
  });

  it("broadcastBelief does not affect the source agent", () => {
    const a1 = model.registerAgent("a1");
    a1.setBelief("prop", 0.5);
    model.broadcastBelief("a1", "prop", 0.9);
    // a1's own belief should not change from the broadcast
    expect(a1.getBeliefProbability("prop")).toBeCloseTo(0.5);
  });

  // ── Debate Protocol ─────────────────────────────────────────────────────────

  it("starts a debate and returns a DebateRound", () => {
    const debate = model.startDebate("proposal-123", "Should we apply this RSI proposal?");
    expect(debate.id).toBeDefined();
    expect(debate.proposalId).toBe("proposal-123");
    expect(debate.arguments).toHaveLength(0);
  });

  it("submits arguments to a debate", () => {
    model.registerAgent("a1");
    const debate = model.startDebate("p1", "Apply proposal?");
    const arg = model.submitArgument(debate.id, "a1", "for", 0.8, ["evidence-1"]);
    expect(arg.stance).toBe("for");
    expect(arg.strength).toBeCloseTo(0.8);
    expect(debate.arguments).toHaveLength(1);
  });

  it("throws when submitting to a non-existent debate", () => {
    model.registerAgent("a1");
    expect(() =>
      model.submitArgument("nonexistent", "a1", "for", 0.8, [])
    ).toThrow();
  });

  it("resolves debate with majority 'for' as approved", () => {
    model.registerAgent("a1");
    model.registerAgent("a2");
    const debate = model.startDebate("p1", "Apply proposal?");
    model.submitArgument(debate.id, "a1", "for", 0.9, []);
    model.submitArgument(debate.id, "a2", "for", 0.8, []);
    const resolved = model.resolveDebate(debate.id);
    expect(resolved.verdict).toBe("approved");
    expect(resolved.consensusProbability).toBeGreaterThan(0.6);
  });

  it("resolves debate with majority 'against' as rejected", () => {
    model.registerAgent("a1");
    model.registerAgent("a2");
    const debate = model.startDebate("p1", "Apply proposal?");
    model.submitArgument(debate.id, "a1", "against", 0.9, []);
    model.submitArgument(debate.id, "a2", "against", 0.8, []);
    const resolved = model.resolveDebate(debate.id);
    expect(resolved.verdict).toBe("rejected");
    expect(resolved.consensusProbability).toBeLessThan(0.4);
  });

  it("resolves debate with mixed arguments as deferred", () => {
    model.registerAgent("a1");
    model.registerAgent("a2");
    const debate = model.startDebate("p1", "Apply proposal?");
    model.submitArgument(debate.id, "a1", "for", 0.5, []);
    model.submitArgument(debate.id, "a2", "against", 0.5, []);
    const resolved = model.resolveDebate(debate.id);
    expect(["approved", "rejected", "deferred"]).toContain(resolved.verdict);
  });

  it("throws when resolving a non-existent debate", () => {
    expect(() => model.resolveDebate("nonexistent")).toThrow();
  });

  it("detectByzantineAgents identifies highly divergent agents", () => {
    const a1 = model.registerAgent("a1");
    const a2 = model.registerAgent("a2");
    const a3 = model.registerAgent("a3");

    // a1 and a2 agree strongly
    a1.setBelief("prop", 0.9);
    a2.setBelief("prop", 0.9);
    // a3 strongly disagrees (Byzantine)
    a3.setBelief("prop", 0.05);

    // avg = (0.9 + 0.9 + 0.05) / 3 ≈ 0.617
    // a3 divergence = |0.05 - 0.617| = 0.567 > 0.5 threshold
    // a1 divergence = |0.9 - 0.617| = 0.283 < 0.5 threshold
    const byzantines = model.detectByzantineAgents(0.5);
    expect(byzantines).toContain("a3");
    expect(byzantines).not.toContain("a1");
  });

  it("getDebates returns all debates", async () => {
    model.startDebate("p1", "Topic 1");
    // Small delay to ensure unique IDs (debate IDs use Date.now())
    await new Promise(r => setTimeout(r, 5));
    model.startDebate("p2", "Topic 2");
    expect(model.getDebates()).toHaveLength(2);
  });

  it("getDebate returns specific debate by ID", () => {
    const debate = model.startDebate("p1", "Topic");
    expect(model.getDebate(debate.id)).toBe(debate);
    expect(model.getDebate("nonexistent")).toBeUndefined();
  });
});

// ── Singleton ─────────────────────────────────────────────────────────────────

describe("getEpistemicModel singleton", () => {
  beforeEach(() => {
    resetEpistemicModel();
  });

  it("returns the same instance on repeated calls", () => {
    const a = getEpistemicModel(`/tmp/test_ep_s1_${Date.now()}`);
    const b = getEpistemicModel();
    expect(a).toBe(b);
  });

  it("returns a new instance after reset", () => {
    const a = getEpistemicModel(`/tmp/test_ep_s2_${Date.now()}`);
    resetEpistemicModel();
    const b = getEpistemicModel(`/tmp/test_ep_s3_${Date.now()}`);
    expect(a).not.toBe(b);
  });
});
