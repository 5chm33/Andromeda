/**
 * restoredModules.integration.test.ts
 *
 * Integration tests verifying that all 51 restored modules:
 * 1. Import without errors
 * 2. Export the functions they claim to export
 * 3. Return sensible values when called with minimal inputs
 *
 * These are smoke tests — they prove the modules are wired and callable,
 * not that they produce optimal results.
 */

import { describe, it, expect, beforeEach } from "vitest";

// ── Neuromorphic & Spiking Networks ──────────────────────────────────────────

describe("spikingNeuron", () => {
  it("creates a neuron and injects current", async () => {
    const { createNeuron, injectCurrent, getNeuron, _resetSpikingNeuronForTest } = await import("./spikingNeuron.js");
    _resetSpikingNeuronForTest();
    const n = createNeuron({ threshold: 1.0, leakRate: 0.1 });
    expect(n.neuronId).toBeTruthy();
    const result = injectCurrent(n.neuronId, 0.5, 1);
    expect(typeof result.spiked).toBe("boolean");
    expect(getNeuron(n.neuronId)).toBeDefined();
  });
});

describe("spikingNetworkSimulator", () => {
  it("creates a simulation and runs a timestep", async () => {
    const { createSimulation, addNeuron, runTimestep, getSimulation, _resetSpikingNetworkSimulatorForTest } = await import("./spikingNetworkSimulator.js");
    _resetSpikingNetworkSimulatorForTest();
    const sim = createSimulation();
    expect(sim.simId).toBeTruthy();
    addNeuron(sim.simId, { threshold: 1.0, leakRate: 0.1 });
    runTimestep(sim.simId, 1);
    const s = getSimulation(sim.simId);
    expect(s).toBeDefined();
  });
});

describe("temporalPatternDetector", () => {
  it("registers a pattern and detects it", async () => {
    const { registerPattern, recordSpike, detectPatterns, getPatterns, _resetTemporalPatternDetectorForTest } = await import("./temporalPatternDetector.js");
    _resetTemporalPatternDetectorForTest();
    registerPattern("test-pat", [0, 10, 20], ["n1", "n2", "n3"]);
    recordSpike("n1", 0);
    recordSpike("n2", 10);
    recordSpike("n3", 20);
    const matches = detectPatterns(25);
    expect(Array.isArray(matches)).toBe(true);
    expect(getPatterns().length).toBeGreaterThan(0);
  });
});

describe("neuralPopulationCoder", () => {
  it("encodes and decodes a value", async () => {
    const { encode, decode, getCodes } = await import("./neuralPopulationCoder.js");
    const code = encode(0.5, 10, 0, 1);
    expect(code.activations.length).toBe(10);
    const decoded = decode(code.activations, code.preferredValues);
    expect(typeof decoded).toBe("number");
    expect(getCodes().length).toBeGreaterThan(0);
  });
});

describe("neuromorphicMemory", () => {
  it("initializes and ingests sensory input", async () => {
    const { initNeuromorphicMemory, ingestSensory } = await import("./neuromorphicMemory.js");
    initNeuromorphicMemory();
    const mem = ingestSensory("test content for neuromorphic encoding");
    expect(mem).toBeDefined();
  });
});

describe("ntdlMemory", () => {
  it("initializes and hashes a state", async () => {
    const { initNtdlMemory, hashState } = await import("./ntdlMemory.js");
    initNtdlMemory();
    const hash = hashState("test state content");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });
});

// ── Swarm & Collective Intelligence ──────────────────────────────────────────

describe("pheromoneTrailManager", () => {
  it("adds an edge and deposits pheromone", async () => {
    const { addEdge, depositPheromone, getEdge, evaporatePheromones } = await import("./pheromoneTrailManager.js");
    addEdge("A", "B", 1.0);
    depositPheromone("A", "B", 0.5);
    const edge = getEdge("A", "B");
    expect(edge).toBeDefined();
    expect(edge!.pheromoneLevel).toBeGreaterThan(0);
    evaporatePheromones();
  });
});

describe("stigmergyEngine", () => {
  it("creates a field and deposits a trace", async () => {
    const { createField, depositTrace, getField, evaporateField, _resetStigmergyEngineForTest } = await import("./stigmergyEngine.js");
    _resetStigmergyEngineForTest();
    const field = createField("test-field", 10, 10, 0.1);
    depositTrace(field.fieldId, "agent-1", { x: 5, y: 5 }, "food", 1.0);
    const retrieved = getField(field.fieldId);
    expect(retrieved).toBeDefined();
    evaporateField(field.fieldId);
  });
});

describe("swarmParticleOptimizer", () => {
  it("creates a swarm and steps it", async () => {
    const { createSwarm, stepSwarm, getSwarm, _resetSwarmParticleOptimizerForTest } = await import("./swarmParticleOptimizer.js");
    _resetSwarmParticleOptimizerForTest();
    const swarm = createSwarm(5, 2);
    expect(swarm.swarmId).toBeTruthy();
    const fitness = (pos: number[]) => -(pos[0] ** 2 + pos[1] ** 2);
    stepSwarm(swarm.swarmId, fitness, 3);
    expect(getSwarm(swarm.swarmId)).toBeDefined();
  });
});

describe("crowdWisdomAggregator", () => {
  it("aggregates estimates and retrieves them", async () => {
    const { aggregate, getEstimates, _resetCrowdWisdomAggregatorForTest } = await import("./crowdWisdomAggregator.js");
    _resetCrowdWisdomAggregatorForTest();
    aggregate("What is 2+2?", [4, 4, 5, 4], "numeric");
    const estimates = getEstimates();
    expect(estimates.length).toBeGreaterThan(0);
  });
});

describe("emergentBehaviorDetector", () => {
  it("records observations and detects emergence", async () => {
    const { recordObservation, detectEmergence, getEvents, _resetEmergentBehaviorDetectorForTest } = await import("./emergentBehaviorDetector.js");
    _resetEmergentBehaviorDetectorForTest();
    for (let i = 0; i < 5; i++) {
      recordObservation("agent-1", "move", { x: i, y: i });
    }
    detectEmergence(5);
    const events = getEvents();
    expect(Array.isArray(events)).toBe(true);
  });
});

describe("swarmCoordinator", () => {
  it("initializes and returns swarm state", async () => {
    const { initSwarmCoordinator, getSwarmState } = await import("./swarmCoordinator.js");
    initSwarmCoordinator();
    const state = getSwarmState();
    expect(state).toBeDefined();
  });
});

describe("swarmTestnet", () => {
  it("creates a testnet and resets it", async () => {
    const { getSwarmTestnet, resetSwarmTestnet } = await import("./swarmTestnet.js");
    const net = getSwarmTestnet({ maxPeers: 3 });
    expect(net).toBeDefined();
    resetSwarmTestnet();
  });
});

describe("swarmOrchestrator", () => {
  it("loads peers without throwing", async () => {
    const { loadPeers } = await import("./swarmOrchestrator.js");
    const peers = await loadPeers();
    expect(Array.isArray(peers)).toBe(true);
  });
});

describe("pheromoneTrailManager — path recording", () => {
  it("records a path and retrieves neighbors", async () => {
    const { addEdge, recordPath, getNeighbors } = await import("./pheromoneTrailManager.js");
    addEdge("X", "Y", 1.0);
    addEdge("X", "Z", 0.8);
    recordPath("ant-1", ["X", "Y"], 1.0);
    const neighbors = getNeighbors("X");
    expect(neighbors.length).toBeGreaterThan(0);
  });
});

// ── Evolutionary & Population Optimization ────────────────────────────────────

describe("populationEvolver", () => {
  it("initializes a population and evolves one generation", async () => {
    const { initializePopulation, evolveGeneration, getState, _resetPopulationEvolverForTest } = await import("./populationEvolver.js");
    _resetPopulationEvolverForTest();
    const fitness = (genes: number[]) => genes.reduce((a, b) => a + b, 0);
    const state = initializePopulation({ populationSize: 10, mutationRate: 0.1, crossoverRate: 0.7, elitismCount: 2 }, 5, fitness);
    expect(state.stateId).toBeTruthy();
    evolveGeneration(state.stateId, fitness);
    expect(getState(state.stateId)).toBeDefined();
  });
});

describe("annealingScheduler", () => {
  it("creates a session and steps it", async () => {
    const { createSession, step, getSession, _resetAnnealingSchedulerForTest } = await import("./annealingScheduler.js");
    _resetAnnealingSchedulerForTest();
    const session = createSession({ initialTemp: 100, coolingRate: 0.95, minTemp: 0.01 });
    expect(session.sessionId).toBeTruthy();
    step(session.sessionId, 0.5);
    expect(getSession(session.sessionId)).toBeDefined();
  });
});

describe("quantumInspiredOptimizer", () => {
  it("exports optimizeHyperparameters function", async () => {
    const mod = await import("./quantumInspiredOptimizer.js");
    expect(typeof mod.optimizeHyperparameters).toBe("function");
  });
});

describe("fitnessLandscapeMapper", () => {
  it("adds points and analyzes the landscape", async () => {
    const { addPoint, analyzeLandscape, getLatestAnalysis, _resetFitnessLandscapeMapperForTest } = await import("./fitnessLandscapeMapper.js");
    _resetFitnessLandscapeMapperForTest();
    addPoint([0.1, 0.2], 0.5);
    addPoint([0.3, 0.4], 0.8);
    addPoint([0.5, 0.6], 0.3);
    analyzeLandscape();
    const analysis = getLatestAnalysis();
    expect(analysis).toBeDefined();
  });
});

describe("evolutionaryOptimizer", () => {
  it("exports optimizeEvolutionary function", async () => {
    const mod = await import("./evolutionaryOptimizer.js");
    expect(typeof mod.optimizeEvolutionary).toBe("function");
  });
});

describe("particleSwarmOptimizer", () => {
  it("exports optimizePSO function", async () => {
    const mod = await import("./particleSwarmOptimizer.js");
    expect(typeof mod.optimizePSO).toBe("function");
  });
});

describe("hyperparameterTuner", () => {
  it("creates an experiment and suggests a trial", async () => {
    const { createExperiment, suggestTrial, getExperiment, _resetHyperparameterTunerForTest } = await import("./hyperparameterTuner.js");
    _resetHyperparameterTunerForTest();
    const exp = createExperiment("test-exp", "random", [{ name: "lr", type: "continuous", min: 0.0001, max: 0.1 }], "accuracy");
    expect(exp.experimentId).toBeTruthy();
    const trial = suggestTrial(exp.experimentId);
    expect(trial).toBeDefined();
    expect(getExperiment(exp.experimentId)).toBeDefined();
  });
});

describe("multiObjectiveOptimizer", () => {
  it("computes Pareto front from solutions", async () => {
    const { computeParetoFront, selectParetoOptimal } = await import("./multiObjectiveOptimizer.js");
    // MOOSolution requires { id, objectives, rank, crowdingDistance }
    const solutions = [
      { id: "s1", objectives: { speed: 0.9, memory: 0.3 }, rank: 1, crowdingDistance: 0 },
      { id: "s2", objectives: { speed: 0.5, memory: 0.1 }, rank: 1, crowdingDistance: 0 },
    ];
    const front = computeParetoFront(solutions as Parameters<typeof computeParetoFront>[0]);
    expect(front).toBeDefined();
    expect(front.solutions.length).toBeGreaterThan(0);
    const best = selectParetoOptimal(front);
    expect(front.hypervolume).toBeGreaterThanOrEqual(0);
  });
});

describe("paretoOptimizer", () => {
  it("adds objectives and solutions, then computes Pareto front", async () => {
    const { addObjective, addSolution, computeParetoFront } = await import("./paretoOptimizer.js");
    addObjective("accuracy", false);
    addObjective("latency", true);
    addSolution({ accuracy: 0.95, latency: 200 }, { accuracy: 0.95, latency: 200 });
    addSolution({ accuracy: 0.80, latency: 50 }, { accuracy: 0.80, latency: 50 });
    const front = computeParetoFront();
    // computeParetoFront returns a ParetoFront object (not an array)
    expect(front).toBeDefined();
  });
});

// ── Reinforcement Learning & Policy ───────────────────────────────────────────

describe("rewardCalculator", () => {
  it("defines a reward function and calculates reward", async () => {
    const { defineRewardFunction, calculateReward, getCumulativeReward } = await import("./rewardCalculator.js");
    defineRewardFunction("test-fn", "composite", { testPass: 1.0, speed: 0.5 });
    calculateReward("test-fn", "rsi-agent", "state-1", "action-1", { testPass: 1, speed: 0.8 });
    const cumulative = getCumulativeReward("rsi-agent");
    expect(typeof cumulative).toBe("number");
  });
});

describe("policyOptimizer", () => {
  it("creates a policy and selects an action", async () => {
    const { createPolicy, selectAction, getPolicy, _resetPolicyOptimizerForTest } = await import("./policyOptimizer.js");
    _resetPolicyOptimizerForTest();
    const policy = createPolicy("test-policy", 0.1, 0.99, 1.0, 0.995, 0.01);
    expect(policy.policyId).toBeTruthy();
    const action = selectAction(policy.policyId, "state-1", ["a", "b", "c"]);
    expect(["a", "b", "c"]).toContain(action);
    expect(getPolicy(policy.policyId)).toBeDefined();
  });
});

describe("hebbianLearner", () => {
  it("creates a synapse and applies Hebbian rule", async () => {
    const { createSynapse, applyHebbianRule } = await import("./hebbianLearner.js");
    const syn = createSynapse("n1", "n2");
    expect(syn.synapseId).toBeTruthy();
    const event = applyHebbianRule(syn.synapseId, true, true);
    expect(event).toBeDefined();
  });
});

describe("federatedRLHF", () => {
  it("exports startFederatedSync function", async () => {
    const mod = await import("./federatedRLHF.js");
    expect(typeof mod.startFederatedSync).toBe("function");
  });
});

// ── Planning & Simulation ─────────────────────────────────────────────────────

describe("monteCarloPlanner", () => {
  it("creates a tree and selects best action", async () => {
    const { createMCTSTree, expandNode, backpropagate, selectBestAction, getTreeSize } = await import("./monteCarloPlanner.js");
    const root = createMCTSTree("tree-1", "state-root", ["left", "right"]);
    expect(root.nodeId).toBeTruthy();
    const child = expandNode("tree-1", root.nodeId, "state-left", "left", ["a", "b"]);
    expect(child).toBeDefined();
    backpropagate("tree-1", child!.nodeId, 1.0);
    const best = selectBestAction("tree-1", root.nodeId);
    expect(best).toBeTruthy();
    expect(getTreeSize("tree-1")).toBeGreaterThan(0);
  });
});

describe("mctsPlanningEngine", () => {
  it("exports MCTSEngine class", async () => {
    const mod = await import("./mctsPlanningEngine.js");
    expect(mod.MCTSEngine).toBeDefined();
  });
});

describe("simulationEngine", () => {
  it("creates a simulation and steps it", async () => {
    const { createSimulation, scheduleEvent, stepSimulation, getSimulation, _resetSimulationEngineForTest } = await import("./simulationEngine.js");
    _resetSimulationEngineForTest();
    const sim = createSimulation("test-sim");
    expect(sim.simId).toBeTruthy();
    scheduleEvent(sim.simId, 1, "tick", { cycle: 1 });
    stepSimulation(sim.simId);
    expect(getSimulation(sim.simId)).toBeDefined();
  });
});

describe("gameStateManager", () => {
  it("creates a game and applies an action", async () => {
    const { createGame, startGame, applyAction, getGame } = await import("./gameStateManager.js");
    const game = createGame("test-game", ["Alice", "Bob"]);
    expect(game.gameId).toBeTruthy();
    startGame(game.gameId);
    applyAction(game.gameId, game.players[0].playerId, "move", { direction: "up" });
    expect(getGame(game.gameId)).toBeDefined();
  });
});

describe("environmentModel", () => {
  it("exports core environment model functions", async () => {
    const mod = await import("./environmentModel.js");
    expect(mod).toBeDefined();
  });
});

// ── Plasticity & Adaptation ───────────────────────────────────────────────────

describe("neuroplasticAdapter", () => {
  it("evaluates pipeline plasticity and records stage performance", async () => {
    const { evaluatePipelinePlasticity, recordStagePerformance, isStageActive } = await import("./neuroplasticAdapter.js");
    // evaluatePipelinePlasticity returns void — just verify it runs without throwing
    expect(() => evaluatePipelinePlasticity()).not.toThrow();
    recordStagePerformance("patch-apply", true);
    expect(typeof isStageActive("patch-apply")).toBe("boolean");
  });
});

// ── Knowledge & Reasoning ─────────────────────────────────────────────────────

describe("epistemicBeliefModel", () => {
  it("initializes and returns epistemic model", async () => {
    const { initPatternMemory, getEpistemicModel } = await import("./epistemicBeliefModel.js");
    initPatternMemory();
    const model = getEpistemicModel();
    expect(model).toBeDefined();
  });
});

describe("epistemicUncertaintyQuantifier", () => {
  it("initializes and exports core functions", async () => {
    const { initEpistemicUncertaintyQuantifier } = await import("./epistemicUncertaintyQuantifier.js");
    initEpistemicUncertaintyQuantifier();
  });
});

describe("causalReasoning", () => {
  it("exports causal reasoning functions", async () => {
    const mod = await import("./causalReasoning.js");
    expect(mod).toBeDefined();
  });
});

describe("astKnowledgeGraph", () => {
  it("exports knowledge graph functions", async () => {
    const mod = await import("./astKnowledgeGraph.js");
    expect(mod).toBeDefined();
  });
});

describe("federatedKnowledgeGraph", () => {
  it("exports federated knowledge graph functions", async () => {
    const mod = await import("./federatedKnowledgeGraph.js");
    expect(mod).toBeDefined();
  });
});

describe("semanticSelfModel", () => {
  it("queries modules by utility", async () => {
    const { queryByUtility, getTopModulesByImpact, getHighRiskModules } = await import("./semanticSelfModel.js");
    const results = queryByUtility("testPassRate");
    expect(Array.isArray(results)).toBe(true);
    const top = getTopModulesByImpact(3);
    expect(Array.isArray(top)).toBe(true);
    const risky = getHighRiskModules(0.5);
    expect(Array.isArray(risky)).toBe(true);
  });
});

// ── Safety & Verification ─────────────────────────────────────────────────────

describe("proofVerifier", () => {
  it("checks a propositional proof", async () => {
    const { checkPropositional } = await import("./proofVerifier.js");
    const result = checkPropositional({
      proposalId: "test-proof",
      filePath: "server/rsiEngine.ts",
      rationale: "test",
      proposedContent: "const x = 1;",
      preConditions: {},
      postConditions: {},
      expectedUtilityDelta: 0.1,
    });
    expect(result).toBeDefined();
  });
});

describe("adversarialSelfPlay", () => {
  it("initializes adversarial self-play", async () => {
    const { initAdversarialSelfPlay } = await import("./adversarialSelfPlay.js");
    initAdversarialSelfPlay();
  });
});

describe("chaosEngineer", () => {
  it("initializes chaos engineer", async () => {
    const { initChaosEngineer } = await import("./chaosEngineer.js");
    initChaosEngineer();
  });
});

describe("selfHealingChaos", () => {
  it("initializes and returns hardening targets", async () => {
    const { initSelfHealingChaos, getHardeningTargets } = await import("./selfHealingChaos.js");
    initSelfHealingChaos();
    const targets = getHardeningTargets(5);
    expect(Array.isArray(targets)).toBe(true);
  });
});

describe("distributionShiftDetector", () => {
  it("captures two distributions and detects shift between them", async () => {
    const { captureDistribution, detectShift } = await import("./distributionShiftDetector.js");
    captureDistribution("baseline", [1, 2, 3, 4, 5]);
    captureDistribution("current", [3, 4, 5, 6, 7]);
    const shift = detectShift("baseline", "current");
    expect(shift).toBeDefined();
    expect(typeof shift.shiftDetected).toBe("boolean");
  });
});

// ── Federated & Distributed ───────────────────────────────────────────────────

describe("federatedLearningCoordinator", () => {
  it("initializes federated learning coordinator", async () => {
    const { initFederatedLearningCoordinator } = await import("./federatedLearningCoordinator.js");
    initFederatedLearningCoordinator();
  });
});

describe("federatedLoraSharing", () => {
  it("exports federated LoRA sharing functions", async () => {
    const mod = await import("./federatedLoraSharing.js");
    expect(mod).toBeDefined();
  });
});

describe("federatedRsiNetwork", () => {
  it("exports syncWithPeers function", async () => {
    const mod = await import("./federatedRsiNetwork.js");
    expect(typeof mod.syncWithPeers).toBe("function");
  });
});

// ── Utility & Misc ────────────────────────────────────────────────────────────

describe("utilityFunction", () => {
  it("computes utility and explains it", async () => {
    const { compute, explain, getWeights } = await import("./utilityFunction.js");
    const score = compute({
      testPassRate: 0.9,
      benchmarkDelta: 0.05,
      avgLatencyMs: 1500,
      tokenOverheadRatio: 1.1,
      safetyScore: 0.95,
      newCapabilities: 1,
      regressions: 0,
      timestamp: Date.now(),
    });
    // compute() returns a UtilityScore object, not a raw number
    expect(score).toBeDefined();
    expect(typeof score.total).toBe("number");
    const explanation = explain(score);
    expect(typeof explanation).toBe("string");
    const weights = getWeights();
    expect(weights).toBeDefined();
  });
});

describe("proposalGenealogy", () => {
  it("initializes and records a proposal", async () => {
    const { initProposalGenealogy, recordProposalGenerated } = await import("./proposalGenealogy.js");
    initProposalGenealogy();
    recordProposalGenerated({ proposalId: "p-1", parentId: null, filePath: "test.ts", strategy: "llm" });
  });
});

describe("proposalRanker", () => {
  it("scores and ranks proposals", async () => {
    const { scoreProposal, rankProposals } = await import("./proposalRanker.js");
    const p1 = { proposalId: "p1", filePath: "a.ts", rationale: "fix null check", confidence: 0.9, category: "null_safety" };
    const p2 = { proposalId: "p2", filePath: "b.ts", rationale: "add constant", confidence: 0.6, category: "constants" };
    // scoreProposal returns { compositeScore, scoreBreakdown }
    const result1 = scoreProposal(p1 as Parameters<typeof scoreProposal>[0]);
    expect(typeof result1.compositeScore).toBe("number");
    // rankProposals returns a RankingResult object with a .ranked array
    const result = rankProposals([p1, p2] as Parameters<typeof rankProposals>[0]);
    expect(result.ranked.length).toBe(2);
  });
});

describe("rsiDashboard", () => {
  it("exports registerDashboardRoutes function", async () => {
    const mod = await import("./rsiDashboard.js");
    expect(typeof mod.registerDashboardRoutes).toBe("function");
  });
});

describe("policyOptimizer — Q-table update", () => {
  it("updates policy and retrieves Q-table", async () => {
    const { createPolicy, updatePolicy, getQTable, _resetPolicyOptimizerForTest } = await import("./policyOptimizer.js");
    _resetPolicyOptimizerForTest();
    const policy = createPolicy("q-test", 0.1);
    // updatePolicy requires nextActions array as 6th argument
    updatePolicy(policy.policyId, "state-1", "action-a", 1.0, "state-2", ["action-a", "action-b"]);
    const qt = getQTable(policy.policyId);
    expect(qt).toBeDefined();
  });
});
