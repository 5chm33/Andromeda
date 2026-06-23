/**
 * swarmSpecialistVoting.test.ts — Unit tests for Phase 2 swarm voting
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  initSwarmSpecialistVoting,
  getVotingStats,
  getVotingHistory,
  enableSwarmVoting,
  disableSwarmVoting,
  isSwarmVotingEnabled,
  getSpecialists,
  runSpecialistVoting,
} from "./swarmSpecialistVoting.js";

describe("swarmSpecialistVoting", () => {
  beforeEach(() => {
    initSwarmSpecialistVoting({ enabled: false });
  });

  describe("initialization", () => {
    it("initializes with disabled state by default", () => {
      initSwarmSpecialistVoting({ enabled: false });
      expect(isSwarmVotingEnabled()).toBe(false);
    });

    it("can be enabled via options", () => {
      initSwarmSpecialistVoting({ enabled: true });
      expect(isSwarmVotingEnabled()).toBe(true);
    });
  });

  describe("enable/disable", () => {
    it("enables voting", () => {
      enableSwarmVoting();
      expect(isSwarmVotingEnabled()).toBe(true);
    });

    it("disables voting", () => {
      enableSwarmVoting();
      disableSwarmVoting();
      expect(isSwarmVotingEnabled()).toBe(false);
    });
  });

  describe("getSpecialists", () => {
    it("returns all 5 specialist roles", () => {
      const specialists = getSpecialists();
      expect(specialists.length).toBe(5);
    });

    it("includes security specialist with veto power", () => {
      const specialists = getSpecialists();
      const security = specialists.find(s => s.role === "security");
      expect(security).toBeDefined();
      expect(security!.hasVetoPower).toBe(true);
    });

    it("includes ethics specialist with veto power", () => {
      const specialists = getSpecialists();
      const ethics = specialists.find(s => s.role === "ethics");
      expect(ethics).toBeDefined();
      expect(ethics!.hasVetoPower).toBe(true);
    });

    it("weights sum to approximately 1.0", () => {
      const specialists = getSpecialists();
      const total = specialists.reduce((s, sp) => s + sp.weight, 0);
      expect(total).toBeCloseTo(1.0, 1);
    });
  });

  describe("runSpecialistVoting (disabled mode)", () => {
    it("auto-approves when disabled", async () => {
      disableSwarmVoting();
      const session = await runSpecialistVoting(
        "test-proposal-1",
        "utils.ts",
        "const x = 1;",
        "const x = 2;",
        "Update constant value",
      );
      expect(session.consensus.approved).toBe(true);
      expect(session.votes).toHaveLength(0);
    });

    it("returns a valid session object", async () => {
      const session = await runSpecialistVoting(
        "test-proposal-2",
        "cache.ts",
        "old content",
        "new content",
        "Cache optimization",
      );
      expect(session.sessionId).toBeTruthy();
      expect(session.proposalId).toBe("test-proposal-2");
      expect(session.targetFile).toBe("cache.ts");
      expect(typeof session.startedAt).toBe("number");
    });
  });

  describe("getVotingStats", () => {
    it("returns valid stats structure", () => {
      const stats = getVotingStats();
      expect(typeof stats.enabled).toBe("boolean");
      expect(typeof stats.totalSessions).toBe("number");
      expect(typeof stats.approvedSessions).toBe("number");
      expect(typeof stats.vetoedSessions).toBe("number");
      expect(typeof stats.approvalRate).toBe("number");
      expect(Array.isArray(stats.recentSessions)).toBe(true);
    });
  });

  describe("getVotingHistory", () => {
    it("returns an array", () => {
      const history = getVotingHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it("respects the limit parameter", async () => {
      // Run a few sessions
      for (let i = 0; i < 3; i++) {
        await runSpecialistVoting(`p${i}`, "test.ts", "old", "new", "test");
      }
      const history = getVotingHistory(2);
      expect(history.length).toBeLessThanOrEqual(2);
    });
  });
});
