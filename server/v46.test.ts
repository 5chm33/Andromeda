/**
 * v46.test.ts — Sub-Agent Economy I
 * Tests: subAgentMarketplace, computeAuctioneer, agentBidder, taskBroker,
 *        rewardDistributor, agentReputationLedger
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  registerAgent, postTask, matchTask, completeTask as completeMarketplaceTask,
  getMarketplaceStats, getAgentListing, _resetMarketplaceForTest,
} from "./subAgentMarketplace.js";

import {
  createAuction, submitBid, closeAuction, getAuction, getAuctionResult,
  _resetAuctioneerForTest,
} from "./computeAuctioneer.js";

import {
  registerBidder, decideBid, updateBudget, getBidderProfile, _resetBidderForTest,
} from "./agentBidder.js";

import {
  createGoal, addTask, assignTask, completeTask as completeBrokerTask,
  getGoalProgress, getPendingTasks, getGoal, _resetBrokerForTest,
} from "./taskBroker.js";

import {
  initializeAgent, distributeReward, deductCost, getBalance, getLeaderboard,
  _resetRewardDistributorForTest,
} from "./rewardDistributor.js";

import {
  recordEvent, getReputation, getTopAgents, getLedgerForAgent, _resetLedgerForTest,
} from "./agentReputationLedger.js";

// ─── subAgentMarketplace ──────────────────────────────────────────────────────
describe("v46 Sub-Agent Economy I", () => {
  describe("subAgentMarketplace", () => {
    beforeEach(() => _resetMarketplaceForTest());

    it("should register an agent and reflect in stats", () => {
      registerAgent({ agentId: "alpha", capabilities: ["code", "test"], pricePerTask: 10, reputation: 0.9, available: true, totalTasksCompleted: 0 });
      const stats = getMarketplaceStats();
      expect(stats.totalAgents).toBe(1);
      expect(stats.availableAgents).toBe(1);
    });

    it("should match a task to the best eligible agent", () => {
      registerAgent({ agentId: "alpha", capabilities: ["code", "test"], pricePerTask: 10, reputation: 0.9, available: true, totalTasksCompleted: 0 });
      registerAgent({ agentId: "beta", capabilities: ["code"], pricePerTask: 8, reputation: 0.7, available: true, totalTasksCompleted: 0 });
      postTask({ taskId: "t1", requiredCapabilities: ["code", "test"], maxBudget: 15, priority: 5, deadline: Date.now() + 60000, postedAt: Date.now() });
      const assignment = matchTask("t1");
      expect(assignment).not.toBeNull();
      expect(assignment!.agentId).toBe("alpha"); // higher reputation
    });

    it("should return null if no eligible agent exists", () => {
      registerAgent({ agentId: "alpha", capabilities: ["code"], pricePerTask: 10, reputation: 0.9, available: true, totalTasksCompleted: 0 });
      postTask({ taskId: "t2", requiredCapabilities: ["quantum"], maxBudget: 15, priority: 5, deadline: Date.now() + 60000, postedAt: Date.now() });
      expect(matchTask("t2")).toBeNull();
    });

    it("should mark agent unavailable after assignment", () => {
      registerAgent({ agentId: "alpha", capabilities: ["code"], pricePerTask: 5, reputation: 0.8, available: true, totalTasksCompleted: 0 });
      postTask({ taskId: "t3", requiredCapabilities: ["code"], maxBudget: 10, priority: 5, deadline: Date.now() + 60000, postedAt: Date.now() });
      matchTask("t3");
      const listing = getAgentListing("alpha");
      expect(listing!.available).toBe(false);
    });

    it("should update reputation and availability after task completion", () => {
      registerAgent({ agentId: "alpha", capabilities: ["code"], pricePerTask: 5, reputation: 0.8, available: true, totalTasksCompleted: 0 });
      postTask({ taskId: "t4", requiredCapabilities: ["code"], maxBudget: 10, priority: 5, deadline: Date.now() + 60000, postedAt: Date.now() });
      matchTask("t4");
      completeMarketplaceTask("t4", true);
      const listing = getAgentListing("alpha");
      expect(listing!.available).toBe(true);
      expect(listing!.totalTasksCompleted).toBe(1);
      expect(listing!.reputation).toBeGreaterThan(0.8);
    });
  });

  // ─── computeAuctioneer ──────────────────────────────────────────────────────
  describe("computeAuctioneer", () => {
    beforeEach(() => _resetAuctioneerForTest());

    it("should create a Vickrey auction", () => {
      const auction = createAuction("a1", 4, "vickrey");
      expect(auction.auctionId).toBe("a1");
      expect(auction.type).toBe("vickrey");
    });

    it("should select the highest bidder and charge second price (Vickrey)", () => {
      createAuction("a2", 4, "vickrey");
      submitBid("a2", { bidderId: "agent1", amount: 100, resourceUnits: 2, submittedAt: Date.now() });
      submitBid("a2", { bidderId: "agent2", amount: 80, resourceUnits: 2, submittedAt: Date.now() });
      const result = closeAuction("a2");
      expect(result!.winnerId).toBe("agent1");
      expect(result!.pricePaid).toBe(80); // second price
    });

    it("should charge winning bid in first-price auction", () => {
      createAuction("a3", 4, "first-price");
      submitBid("a3", { bidderId: "agent1", amount: 100, resourceUnits: 2, submittedAt: Date.now() });
      submitBid("a3", { bidderId: "agent2", amount: 80, resourceUnits: 2, submittedAt: Date.now() });
      const result = closeAuction("a3");
      expect(result!.pricePaid).toBe(100); // first price
    });

    it("should not allow closing an already-closed auction", () => {
      createAuction("a4", 4, "vickrey");
      submitBid("a4", { bidderId: "agent1", amount: 50, resourceUnits: 2, submittedAt: Date.now() });
      closeAuction("a4");
      expect(closeAuction("a4")).toBeNull();
    });
  });

  // ─── agentBidder ────────────────────────────────────────────────────────────
  describe("agentBidder", () => {
    beforeEach(() => _resetBidderForTest());

    it("should bid reservation value with truthful strategy", () => {
      registerBidder({ agentId: "b1", strategy: "truthful", budget: 500, reservationValue: 75, urgency: 0.5 });
      const decision = decideBid("b1", "auction1", 80, 2);
      expect(decision!.bidAmount).toBe(75);
    });

    it("should bid above market with aggressive strategy", () => {
      registerBidder({ agentId: "b2", strategy: "aggressive", budget: 500, reservationValue: 50, urgency: 0.8 });
      const decision = decideBid("b2", "auction1", 80, 2);
      expect(decision!.bidAmount).toBeGreaterThan(80);
    });

    it("should bid below market with conservative strategy", () => {
      registerBidder({ agentId: "b3", strategy: "conservative", budget: 500, reservationValue: 50, urgency: 0.2 });
      const decision = decideBid("b3", "auction1", 80, 2);
      expect(decision!.bidAmount).toBeLessThan(80);
    });

    it("should never exceed budget", () => {
      registerBidder({ agentId: "b4", strategy: "aggressive", budget: 30, reservationValue: 10, urgency: 1.0 });
      const decision = decideBid("b4", "auction1", 80, 2);
      expect(decision!.bidAmount).toBeLessThanOrEqual(30);
    });

    it("should return null for unknown agent", () => {
      expect(decideBid("unknown", "auction1", 80, 2)).toBeNull();
    });
  });

  // ─── taskBroker ─────────────────────────────────────────────────────────────
  describe("taskBroker", () => {
    beforeEach(() => _resetBrokerForTest());

    it("should create a goal and add tasks", () => {
      createGoal("g1", "Build feature X");
      addTask("g1", "Write tests", ["test"], 20, 8);
      addTask("g1", "Write code", ["code"], 30, 7);
      const progress = getGoalProgress("g1");
      expect(progress!.total).toBe(2);
      expect(progress!.pending).toBe(2);
    });

    it("should track progress as tasks complete", () => {
      createGoal("g2", "Deploy service");
      const t1 = addTask("g2", "Build image", ["docker"], 15, 5);
      const t2 = addTask("g2", "Push image", ["docker"], 10, 5);
      assignTask(t1!.taskId, "agent-docker");
      completeBrokerTask(t1!.taskId, { success: true }, true);
      const progress = getGoalProgress("g2");
      expect(progress!.completed).toBe(1);
      expect(progress!.progressPct).toBe(50);
    });

    it("should mark goal as completed when all tasks succeed", () => {
      createGoal("g3", "Simple goal");
      const t = addTask("g3", "Only task", ["code"], 10, 5);
      completeBrokerTask(t!.taskId, {}, true);
      const goal = getGoal("g3");
      expect(goal!.status).toBe("completed");
    });

    it("should mark goal as failed if any task fails", () => {
      createGoal("g4", "Risky goal");
      const t = addTask("g4", "Risky task", ["code"], 10, 5);
      completeBrokerTask(t!.taskId, { error: "timeout" }, false);
      const goal = getGoal("g4");
      expect(goal!.status).toBe("failed");
    });
  });

  // ─── rewardDistributor ──────────────────────────────────────────────────────
  describe("rewardDistributor", () => {
    beforeEach(() => _resetRewardDistributorForTest());

    it("should initialize agent with starting balance", () => {
      initializeAgent("r1", 200);
      expect(getBalance("r1")!.balance).toBe(200);
    });

    it("should distribute reward with quality bonus", () => {
      initializeAgent("r2", 0);
      distributeReward("r2", "task1", 100, 1.0, 0.5); // perfect quality
      const bal = getBalance("r2")!;
      expect(bal.balance).toBeGreaterThan(100); // quality bonus applied
    });

    it("should apply negative quality adjustment for poor work", () => {
      initializeAgent("r3", 0);
      distributeReward("r3", "task2", 100, 0.0, 0.5); // worst quality
      const bal = getBalance("r3")!;
      expect(bal.balance).toBeLessThan(100);
    });

    it("should deduct cost correctly", () => {
      initializeAgent("r4", 100);
      const success = deductCost("r4", 40);
      expect(success).toBe(true);
      expect(getBalance("r4")!.balance).toBe(60);
    });

    it("should return leaderboard sorted by total earned", () => {
      initializeAgent("r5", 0);
      initializeAgent("r6", 0);
      distributeReward("r5", "t1", 200, 0.8, 0.5);
      distributeReward("r6", "t2", 50, 0.8, 0.5);
      const board = getLeaderboard();
      expect(board[0].agentId).toBe("r5");
    });
  });

  // ─── agentReputationLedger ──────────────────────────────────────────────────
  describe("agentReputationLedger", () => {
    beforeEach(() => _resetLedgerForTest());

    it("should record events and compute reputation", () => {
      recordEvent("agent1", "task_success");
      recordEvent("agent1", "task_success");
      recordEvent("agent1", "task_success");
      const rep = getReputation("agent1");
      expect(rep.totalEvents).toBe(3);
      expect(rep.successRate).toBe(1.0);
    });

    it("should penalize failures more than successes reward", () => {
      recordEvent("agent2", "task_success");
      recordEvent("agent2", "task_success");
      recordEvent("agent2", "task_failure");
      const rep = getReputation("agent2");
      expect(rep.rawScore).toBeLessThan(4); // 2*2 - 5 = -1
    });

    it("should assign platinum tier to high-reputation agent", () => {
      for (let i = 0; i < 20; i++) recordEvent("agent3", "task_success");
      const rep = getReputation("agent3");
      expect(["gold", "platinum"]).toContain(rep.tier);
    });

    it("should assign bronze tier after safety violation", () => {
      recordEvent("agent4", "safety_violation");
      const rep = getReputation("agent4");
      expect(rep.tier).toBe("bronze");
    });

    it("should return top agents sorted by decayed score", () => {
      for (let i = 0; i < 10; i++) recordEvent("top-agent", "task_success");
      recordEvent("low-agent", "task_failure");
      const top = getTopAgents(5);
      expect(top[0].agentId).toBe("top-agent");
    });
  });
});
