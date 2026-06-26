import { describe, it, expect } from "vitest";

import {
  createCollaborationTask, progressCollaborationTask, getCollaborationReport, initCollaborationEngine,
} from "./collaborationEngine";

import {
  updateTrust, getTrust, getTrustReport, initTrustBuilder,
} from "./trustBuilder";

import {
  recordOutcome, getReputationProfile, getReputationReport, initReputationTracker,
} from "./reputationTracker";

import {
  registerConflict, resolveConflict, getConflictReport, initConflictResolver,
} from "./conflictResolver";

import {
  createConsensusProposal, voteOnProposal, finalizeConsensus, getConsensusReport, initConsensusNegotiator,
} from "./consensusNegotiator";

import {
  observeSocialNorm, recordNormViolation, getSocialNorm, getSocialNormReport, initSocialNormLearner,
} from "./socialNormLearner";

describe("v42 Social Intelligence Layer Enhancements", () => {

  // ─── Collaboration Engine ─────────────────────────────────────────────────────
  describe("Collaboration Engine", () => {
    it("should initialize without errors", () => {
      expect(() => initCollaborationEngine()).not.toThrow();
    });

    it("should create a collaboration task", () => {
      const task = createCollaborationTask("Solve optimization problem", ["agent1", "agent2", "agent3"]);
      expect(task.id).toBeTruthy();
      expect(task.subtasks.length).toBe(3);
      expect(task.status).toBe("planning");
    });

    it("should progress task through stages", () => {
      const task = createCollaborationTask("Research task", ["agentA", "agentB"]);
      const executing = progressCollaborationTask(task.id);
      expect(executing?.status).toBe("executing");
      const aggregating = progressCollaborationTask(task.id);
      expect(aggregating?.status).toBe("aggregating");
      const complete = progressCollaborationTask(task.id);
      expect(complete?.status).toBe("complete");
    });

    it("should return null for unknown task", () => {
      const result = progressCollaborationTask("non-existent");
      expect(result).toBeNull();
    });

    it("should return collaboration report", () => {
      const report = getCollaborationReport();
      expect(typeof report.totalTasks).toBe("number");
      expect(typeof report.collaborationEfficiency).toBe("number");
    });
  });

  // ─── Trust Builder ────────────────────────────────────────────────────────────
  describe("Trust Builder", () => {
    it("should initialize without errors", () => {
      expect(() => initTrustBuilder()).not.toThrow();
    });

    it("should build trust from positive interactions", () => {
      updateTrust("agentA", "agentB", true);
      updateTrust("agentA", "agentB", true);
      updateTrust("agentA", "agentB", true);
      const rel = getTrust("agentA", "agentB");
      expect(rel).not.toBeNull();
      expect(rel!.trustScore).toBeGreaterThan(0.5);
    });

    it("should reduce trust from negative interactions", () => {
      updateTrust("agentC", "agentD", false);
      updateTrust("agentC", "agentD", false);
      updateTrust("agentC", "agentD", false);
      const rel = getTrust("agentC", "agentD");
      expect(rel!.trustScore).toBeLessThan(0.5);
    });

    it("should return null for unknown relationship", () => {
      const rel = getTrust("unknown1", "unknown2");
      expect(rel).toBeNull();
    });

    it("should return trust report", () => {
      const report = getTrustReport();
      expect(typeof report.totalRelationships).toBe("number");
      expect(typeof report.avgTrustScore).toBe("number");
    });
  });

  // ─── Reputation Tracker ───────────────────────────────────────────────────────
  describe("Reputation Tracker", () => {
    it("should initialize without errors", () => {
      expect(() => initReputationTracker()).not.toThrow();
    });

    it("should track reputation from outcomes", () => {
      recordOutcome("agent1", "coding", true);
      recordOutcome("agent1", "coding", true);
      recordOutcome("agent1", "coding", false);
      const profile = getReputationProfile("agent1");
      expect(profile).not.toBeNull();
      expect(profile!.totalInteractions).toBe(3);
    });

    it("should increase Elo rating on wins", () => {
      recordOutcome("agent2", "math", true, 1200);
      const profile = getReputationProfile("agent2");
      expect(profile!.eloRating).toBeGreaterThan(1200);
    });

    it("should track domain-specific scores", () => {
      recordOutcome("agent3", "writing", true);
      const profile = getReputationProfile("agent3");
      expect(profile!.domainScores["writing"]).toBeDefined();
    });

    it("should return reputation report", () => {
      const report = getReputationReport();
      expect(typeof report.totalAgents).toBe("number");
      expect(typeof report.avgOverallScore).toBe("number");
    });
  });

  // ─── Conflict Resolver ────────────────────────────────────────────────────────
  describe("Conflict Resolver", () => {
    it("should initialize without errors", () => {
      expect(() => initConflictResolver()).not.toThrow();
    });

    it("should register a conflict", () => {
      const conflict = registerConflict("resource", "agentX", "agentY", "GPU allocation dispute", 0.5);
      expect(conflict.id).toBeTruthy();
      expect(conflict.status).toBe("open");
    });

    it("should resolve a conflict with compromise", () => {
      const conflict = registerConflict("goal", "agentA", "agentB", "Priority conflict", 0.3);
      const resolution = resolveConflict(conflict.id, 0.6, 0.4);
      expect(resolution.satisfactionA).toBeGreaterThan(0);
      expect(resolution.satisfactionB).toBeGreaterThan(0);
    });

    it("should mark conflict as resolved", () => {
      const conflict = registerConflict("value", "agentM", "agentN", "Value alignment", 0.4);
      resolveConflict(conflict.id, 0.5, 0.5);
      expect(conflict.status).toBe("resolved");
    });

    it("should find Pareto-optimal solution for equal preferences", () => {
      const conflict = registerConflict("information", "agentP", "agentQ", "Info sharing", 0.2);
      const resolution = resolveConflict(conflict.id, 0.5, 0.5);
      expect(resolution.paretoOptimal).toBe(true);
    });

    it("should return conflict report", () => {
      const report = getConflictReport();
      expect(typeof report.totalConflicts).toBe("number");
      expect(typeof report.resolvedCount).toBe("number");
    });
  });

  // ─── Consensus Negotiator ─────────────────────────────────────────────────────
  describe("Consensus Negotiator", () => {
    it("should initialize without errors", () => {
      expect(() => initConsensusNegotiator()).not.toThrow();
    });

    it("should create a consensus proposal", () => {
      const proposal = createConsensusProposal("learning_rate", "agent1", 0.001);
      expect(proposal.id).toBeTruthy();
      expect(proposal.status).toBe("open");
    });

    it("should accept votes", () => {
      const proposal = createConsensusProposal("batch_size", "agent1", 32);
      const voted = voteOnProposal(proposal.id, "agent2", 32);
      expect(voted).toBe(true);
    });

    it("should achieve consensus when votes agree", () => {
      const proposal = createConsensusProposal("temperature", "agent1", 0.7);
      voteOnProposal(proposal.id, "agent2", 0.7);
      voteOnProposal(proposal.id, "agent3", 0.7);
      const result = finalizeConsensus(proposal.id);
      expect(result?.status).toBe("accepted");
    });

    it("should reject consensus when votes diverge", () => {
      const proposal = createConsensusProposal("max_tokens", "agent1", 100);
      voteOnProposal(proposal.id, "agent2", 1000);
      voteOnProposal(proposal.id, "agent3", 500);
      const result = finalizeConsensus(proposal.id, 0.9);
      expect(result?.status).toBe("rejected");
    });

    it("should return consensus report", () => {
      const report = getConsensusReport();
      expect(typeof report.totalProposals).toBe("number");
      expect(typeof report.acceptedCount).toBe("number");
    });
  });

  // ─── Social Norm Learner ──────────────────────────────────────────────────────
  describe("Social Norm Learner", () => {
    it("should initialize without errors", () => {
      expect(() => initSocialNormLearner()).not.toThrow();
    });

    it("should observe a new norm", () => {
      const norm = observeSocialNorm("share_results", "research");
      expect(norm.id).toBeTruthy();
      expect(norm.domain).toBe("research");
      expect(norm.strength).toBeGreaterThan(0);
    });

    it("should strengthen norm on repeated observation", () => {
      const norm1 = observeSocialNorm("cite_sources", "academic");
      const norm2 = observeSocialNorm("cite_sources", "academic");
      expect(norm2.strength).toBeGreaterThanOrEqual(norm1.strength);
    });

    it("should record norm violation", () => {
      const norm = observeSocialNorm("no_deception", "general");
      const violation = recordNormViolation(norm.id, "bad_agent", "lied about results", 0.8);
      expect(violation.normId).toBe(norm.id);
      expect(violation.severity).toBe(0.8);
    });

    it("should retrieve norm by id", () => {
      const norm = observeSocialNorm("be_transparent", "governance");
      const retrieved = getSocialNorm(norm.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.description).toBe("be_transparent");
    });

    it("should return social norm report", () => {
      const report = getSocialNormReport();
      expect(typeof report.totalNorms).toBe("number");
      expect(typeof report.avgCompliance).toBe("number");
    });
  });
});
