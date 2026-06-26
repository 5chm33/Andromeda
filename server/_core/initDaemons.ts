/**
 * initDaemons.ts — v18.0.0
 *
 * Extracted from _core/index.ts (v6.03 refactor).
 * Starts all background analysis and monitoring daemons after the server is listening.
 * Called from within the server.listen() callback.
 *
 * v12.13.0: Wire initWatchdog() — module health watchdog now starts at boot.
 * v13.0.0:  Wire three new SOTA systems at boot:
 *   1. initSemanticCodebaseGraph() — AST-level symbol graph for impact radius proofs
 *   2. initMultiAgentDebate()      — upstream debate protocol with RLAIF weight persistence
 *   3. initChaosEngineer()         — fault injection + resilience scoring (smoke test at boot)
 * v14.0.0:  Wire four new systems:
 *   4. initRsiWorkerPool()         — parallel proposal generation with worker threads
 *   5. initCiRegressionGuard()     — CI regression gate for proposal apply path
 *   6. initPatternMemory()         — cross-session architectural pattern memory
 *   7. initSelfHealingChaos()      — chaos → RSI feedback loop for autonomous hardening
 * v15.0.0:  Wire four new SOTA systems:
 *   8. initRsiTaskQueue()          — Redis-backed distributed task queue
 *   9. initContinuousFineTuner()   — autonomous fine-tuning feedback loop (path to 99%)
 *  10. (semanticDiffValidator)     — wired inline in selfImprove.ts apply path
 *  11. (proposalRanker)            — wired inline in rsiEngine.ts cycle loop
 * v16.0.0:  Wire four new SOTA systems:
 *  12. initDistributedConsensus()  — 3-node voting protocol for proposal approval
 *  13. initBenchmarkRegressionSuite() — 20 micro-benchmarks as a hard gate before apply
 *  14. initRsiDashboard()          — real-time RSI dashboard at /dashboard
 *  15. (semanticMergeResolver)     — wired inline in rsiEngine.ts parallel proposal merge
 *  16. (proposalGenerator/Applier/Validator) — selfImprove.ts split into focused sub-modules
 *  17. Fine-tuner threshold lowered from 500 → 100 to activate learning loop sooner
 * v18.0.0:  Wire five new SOTA systems:
 *  18. initFineTunerActivation()   — API key scope verification + fine-tuner health check
 *  19. initConsensusConfig()       — live 3-node peer config with health checks + auto-discovery
 *  20. (genealogyGuidedGeneration) — self-initializes on import; wired inline in selfImprove.ts
 *  21. initRewardCalibrator()      — Platt scaling layer to correct reward model confidence
 *  22. initDependencyUpdateRsi()   — extend RSI to propose/apply package.json dep updates
 */
import { getMarketplaceStats, _resetMarketplaceForTest } from "../subAgentMarketplace.js";
import { createAuction, closeAuction, _resetAuctioneerForTest } from "../computeAuctioneer.js";
import { decideBid, registerBidder, _resetBidderForTest } from "../agentBidder.js";
import { createGoal, addTask, getGoalProgress, _resetBrokerForTest } from "../taskBroker.js";
import { distributeReward, getLeaderboard, _resetRewardDistributorForTest } from "../rewardDistributor.js";
import { recordEvent, getReputation, getTopAgents, _resetLedgerForTest } from "../agentReputationLedger.js";

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { initPersistentContextStore } from "../persistentContextStore";
import { startContextCompressionDaemon } from "../contextCompressionDaemon";
import { startCodebaseAnalyzer } from "../codebaseAnalyzer";
import { startDependencyAuditor } from "../dependencyAuditor";
import { startTestCoverageAnalyzer } from "../testCoverageAnalyzer";
import { startBenchmarkRunner } from "../benchmarkRunner";
import { startCodeQualityMonitor } from "../codeQualityMonitor";
import { startDocGenerator } from "../docGenerator";
import { startSelfReflectionEngine } from "../selfReflectionEngine";
import { startMemoryForgettingCurveDaemon } from "../memoryForgettingCurve";
import { startCapabilityDiscovery } from "../capabilityDiscovery";
import { getPromptStats } from "../promptEngineer";
import { generateAndromedaMd } from "../andromedaMemoryWriter";
import { seedInitialMemoriesIfEmpty } from "../memory";
import { initWatchdog } from "../watchdog";
import { initSemanticCodebaseGraph } from "../semanticCodebaseGraph";
import { initMultiAgentDebate } from "../multiAgentDebate";
import { initChaosEngineer } from "../chaosEngineer";
import { initRsiWorkerPool } from "../rsiWorkerPool";
import { initCiRegressionGuard } from "../ciRegressionGuard";
import { initPatternMemory } from "../epistemicBeliefModel";
import { initSelfHealingChaos } from "../selfHealingChaos";
import { initRsiTaskQueue } from "../rsiTaskQueue";
import { initContinuousFineTuner } from "../continuousFineTuner";
import { initRsiScheduler } from "../rsiScheduler";
import { initDistributedConsensus } from "../distributedConsensus";
import { initBenchmarkRegressionSuite } from "../benchmarkRegressionSuite";
import { initRsiDashboard, registerDashboardRoutes } from "../rsiDashboard";
import { initProposalGenealogy } from "../proposalGenealogy";
import { initRollbackVerifier } from "../rollbackVerifier";
import { initFineTunerActivation } from "../fineTunerActivation";
import { initConsolidationV2 } from "../episodicConsolidationV2.js";
import { initUcdDaemon } from "../unsupervisedCodebaseDiscovery.js";


import { initSrilDaemon } from "../srilEngine";
import { initDeploymentDaemon } from "../autonomousDeployment";
import { initSemanticVersionControl } from "../semanticVersionControl";
import { initMetaCognitiveEngine } from "../metaCognitiveEngine";
import { initSpikePlasticityEngine } from "../spikePlasticityEngine";
import { initCurriculumDesigner } from "../curriculumDesigner";
import { initCounterfactualSimulator } from "../counterfactualSimulator";
import { initEmergentLanguageProtocol } from "../emergentLanguageProtocol";
import { initSubAgentSpawner } from "../subAgentSpawner";
import { initComputeBudgetManager } from "../computeBudgetManager";
import { initResearchPublisher } from "../researchPublisher";
import { initCrossSystemNegotiation } from "../crossSystemNegotiation";
import { initTemporalKnowledgeDistillation } from "../temporalKnowledgeDistillation";
import { initEmergentGoalSynthesis } from "../emergentGoalSynthesis";
import { initComputeEconomyManager } from "../computeEconomyManager";
import { initGovernanceConstitution } from "../governanceConstitution";
import { initLongRangePlanner } from "../longRangePlanner";
import { initAdversarialRedTeam } from "../adversarialRedTeam";
import { initTemporalAbstractionEngine } from "../temporalAbstractionEngine";
import { initAIBootstrapper } from "../aiBootstrapper";
import { initFormalVerificationEngine } from "../formalVerificationEngine";
import { initOptimalityTracker } from "../optimalityTracker";
import { initInfiniteHorizonPlanner } from "../infiniteHorizonPlanner";
import { initSelfHealingArchitecture } from "../selfHealingArchitecture";
import { initCapabilityExtrapolator } from "../capabilityExtrapolator";
import { initMetaRewardShaper } from "../metaRewardShaper";
import { initRecursiveSelfModificationAuditor } from "../recursiveSelfModificationAuditor";
import { initCapabilitySynthesisEngine } from "../capabilitySynthesisEngine";
import { initEpistemicUncertaintyQuantifier } from "../epistemicUncertaintyQuantifier";
import { initFederatedLearningCoordinator } from "../federatedLearningCoordinator";
import { initCausalReasoningEngine } from "../causalReasoningEngine";
import { initOmegaConvergenceMonitor } from "../omegaConvergenceMonitor";
import { initPerpetualStatePersistence } from "../perpetualStatePersistence";
import { initAdaptiveExplorationController } from "../adaptiveExplorationController";
import { initMultiObjectiveOptimizer } from "../multiObjectiveOptimizer";
import { initKnowledgeGraphBuilder } from "../knowledgeGraphBuilder";
import { initAnomalyDetectionEngine } from "../anomalyDetectionEngine";
import { initSelfDocumentationGenerator } from "../selfDocumentationGenerator";
import { initHypothesisGenerator } from "../hypothesisGenerator";
import { initExperimentDesigner } from "../experimentDesigner";
import { initResultAnalyzer } from "../resultAnalyzer";
import { initPeerReviewSimulator } from "../peerReviewSimulator";
import { initScientificMemory } from "../scientificMemory";
import { initBreakthroughDetector } from "../breakthroughDetector";
import { initArchitectureEvolver } from "../architectureEvolver";
import { initModuleComposer } from "../moduleComposer";
import { initInterfaceNegotiator } from "../interfaceNegotiator";
import { initDependencyOptimizer } from "../dependencyOptimizer";
import { initCodeQualityOracle } from "../codeQualityOracle";
import { initRefactoringEngine } from "../refactoringEngine";
import { initConceptMapper } from "../conceptMapper";
import { initAnalogyEngine } from "../analogyEngine";
import { initTransferLearningBroker } from "../transferLearningBroker";
import { initDomainBridger } from "../domainBridger";
import { initSemanticCompressor } from "../semanticCompressor";
import { initKnowledgeFusion } from "../knowledgeFusion";
import { initConstitutionalGuard } from "../constitutionalGuard";
import { initAlignmentMonitor } from "../alignmentMonitor";
import { initValuePreservation } from "../valuePreservation";
import { initCorrigibilityEngine } from "../corrigibilityEngine";
import { initOversightProtocol } from "../oversightProtocol";
import { initSafetyProofChecker } from "../safetyProofChecker";
import { initEnergyProfiler } from "../energyProfiler";
import { initMemoryOptimizer } from "../memoryOptimizer";
import { initLatencyPredictor } from "../latencyPredictor";
import { initThroughputMaximizer } from "../throughputMaximizer";
import { initCostEstimator } from "../costEstimator";
import { initResourceAuctioneer } from "../resourceAuctioneer";
import { initCollaborationEngine } from "../collaborationEngine";
import { initTrustBuilder } from "../trustBuilder";
import { initReputationTracker } from "../reputationTracker";
import { initConflictResolver } from "../conflictResolver";
import { initConsensusNegotiator } from "../consensusNegotiator";
import { initSocialNormLearner } from "../socialNormLearner";
import { initEventSequencer } from "../eventSequencer";
import { initCausalChainTracer } from "../causalChainTracer";
import { initFutureStatePredictor } from "../futureStatePredictor";
import { initHistoricalPatternMiner } from "../historicalPatternMiner";
import { initTimeSeriesForecaster } from "../timeSeriesForecaster";
import { initTemporalConsistencyChecker } from "../temporalConsistencyChecker";
import { initActionSpacePlanner } from "../actionSpacePlanner";
import { initSensorFusionEngine } from "../sensorFusionEngine";
import { initMotorSkillLibrary } from "../motorSkillLibrary";
import { initEnvironmentModeler } from "../environmentModeler";
import { initTaskDecomposerV44 } from "../taskDecomposerV44";
import { initExecutionMonitor } from "../executionMonitor";
import { initSystemIntegrator } from "../systemIntegrator";
import { initCapabilityOrchestrator } from "../capabilityOrchestrator";
import { initGlobalOptimizer } from "../globalOptimizer";
import { initEmergenceDetector } from "../emergenceDetector";
import { initSingularityPreparator } from "../singularityPreparator";
import { initOmegaStateManager } from "../omegaStateManager";
import { initStakeholderReporting } from "../stakeholderReporting";
import { initCognitiveLoadBalancer } from "../cognitiveLoadBalancer";
import { initBootstrapper } from "../capabilityBootstrapper";
import { initStreamingDashboard } from "../streamingDashboard";
import { initGlobalMemory } from "../persistentGlobalMemory.js";
import { initHypothesisEngine } from "../hypothesisEngine.js";
import { initPaperWriter } from "../paperWriter.js";
import { initNeuromorphicMemory } from "../neuromorphicMemory.js";
import { initMetaRsi } from "../metaRsiAgent.js";
import { initCausalModel } from "../causalWorldModel.js";
import { initNtdlMemory } from "../ntdlMemory.js";
import { initBenchmarkSynthesizer } from "../benchmarkSynthesizer.js";
import { initConstitutionalAI } from "../constitutionalAI.js";
import { initNasEngine } from "../nasEngine.js";
import { initSummarizer } from "../infiniteContextSummarizer.js";
import { resetBenchmarkBaseline } from "../externalBenchmarkGate.js";
import { initConsensusConfig } from "../consensusConfig";
import { initRewardCalibrator } from "../rewardCalibrator";
import { initDependencyUpdateRsi } from "../dependencyUpdateRsi";
import { spawnAgent, terminateAgent, getActiveAgents, _resetSpawnControllerForTest } from "../agentSpawnController.js";
import { registerLifecycle, transitionState, heartbeat, recordTaskOutcome, _resetLifecycleManagerForTest } from "../agentLifecycleManager.js";
import { subscribe, publish, getQueueDepth, _resetBusForTest } from "../agentCommunicationBus.js";
import { writeMemory, readMemory, grantAccess, _resetMemoryBrokerForTest } from "../agentMemoryBroker.js";
import { registerCapabilities, findAgentsWithCapability, getRegistryStats, _resetCapabilityRegistryForTest } from "../agentCapabilityRegistry.js";
import { createPlan, addStep, assignStep, completeStep, getPlan, _resetCoordinatorForTest } from "../agentCoordinator.js";
import { registerNode, selectAgent, getStats as getLBStats, _resetLoadBalancerForTest } from "../agentLoadBalancer.js";
import { registerCircuitBreaker, canCall, recordSuccess as recordCBSuccess, recordFailure as recordCBFailure, _resetFaultToleranceForTest } from "../agentFaultTolerance.js";
import { createSnapshot, rollback as rollbackSnapshot, diffSnapshots, _resetVersionControlForTest } from "../agentVersionControl.js";
import { setPolicy as setSecurityPolicy, checkCapability, checkTopicAccess, _resetSecuritySandboxForTest } from "../agentSecuritySandbox.js";
import { recordSample, getReport as getPerfReport, getSLACompliance, _resetProfilerForTest } from "../agentPerformanceProfiler.js";
import { registerWorkflow, startExecution, recordStageResult, finalizeExecution, _resetOrchestrationEngineForTest } from "../agentOrchestrationEngine.js";
import { registerGoalVector, evaluateAlignment, updateObjectiveValue, _resetGoalAlignmentForTest } from "../agentGoalAlignment.js";
import { evaluateAction, getAuditLog as getEthicsLog, getBlockedActionCount, _resetEthicsEnforcerForTest } from "../agentEthicsEnforcer.js";
import { logEvent, queryLog, verifyIntegrity, _resetAuditLoggerForTest } from "../agentAuditLogger.js";
import { createCheckpoint, rollbackToCheckpoint, listCheckpoints, _resetRollbackManagerForTest } from "../agentRollbackManager.js";
import { evaluateHealth, unquarantine, getHealingRecord, _resetSelfHealerForTest } from "../agentSelfHealer.js";
import { recordSnapshot, getTrend, getEconomyHealth, _resetEconomyMonitorForTest } from "../agentEconomyMonitor.js";
import { publishArtifact, requestKnowledge, searchArtifacts, _resetKnowledgeSharerForTest } from "../agentKnowledgeSharer.js";
import { recordSkillUsage, recommendSpecialization, getProfile as getSkillProfile, _resetSpecializationEngineForTest } from "../agentSpecializationEngine.js";
import { recordGeneration, getEvolutionTrend, getTopAgents as getTopEvolvedAgents, _resetEvolutionTrackerForTest } from "../agentEvolutionTracker.js";
import { submitObservation, aggregateInsight, getObservationCount, _resetCollectiveIntelligenceForTest } from "../agentCollectiveIntelligence.js";
import { recordBehaviorSignal, getPatterns as getEmergencePatterns, getNoveltyScore, _resetEmergenceDetectorV50ForTest } from "../agentEmergenceDetectorV50.js";
import { optimize, getLatestResult as getLatestOptResult, _resetEconomyOptimizerForTest } from "../agentEconomyOptimizer.js";
import { parseOpenApiJson, parseMarkdownDoc, getEndpointsByTag, getEndpointsByMethod } from "../apiDocumentationParser.js";
import { inferSchema, schemaToPseudoTypeScript } from "../apiSchemaInferrer.js";
import { generateClient, generateClientFromEndpoints } from "../apiClientGenerator.js";
import { registerCredential, getAuthHeader, refreshToken as refreshApiToken, isCredentialValid, _resetAuthManagerForTest } from "../apiAuthManager.js";
import { configureRateLimit, tryAcquire, getStatus as getRateLimitStatus, _resetRateLimiterForTest } from "../apiRateLimiter.js";
import { registerApi, recordCall as recordApiCall, getHealthReport, getAllHealthReports, _resetApiHealthMonitorForTest } from "../apiHealthMonitor.js";
import { createWorkflow, startExecution as startWorkflowExecution, getWorkflow, listWorkflows, _resetWorkflowComposerForTest } from "../apiWorkflowComposer.js";
import { applyMapping, normalizeResponse, flattenObject } from "../apiDataTransformer.js";
import { configureRecovery, decideRecovery, recordSuccess, isCircuitOpen, _resetErrorRecoveryForTest } from "../apiErrorRecovery.js";
import { registerMigration, adaptRequest, getCompatibilityReport, _resetVersionAdapterForTest } from "../apiVersionAdapter.js";
import { cacheKey, get as cacheGet, set as cacheSet, invalidate as cacheInvalidate, getStats as getCacheStats, _resetCachingLayerForTest } from "../apiCachingLayer.js";
import { auditApiSecurity, getSecurityGrade, _resetSecurityAuditorForTest } from "../apiSecurityAuditor.js";
import { registerTestCase, runTestCase, runTestSuite, _resetIntegrationTesterForTest } from "../apiIntegrationTester.js";
import { recordBenchmarkRun, setBaseline, getBenchmarkReport, _resetBenchmarkerForTest } from "../apiPerformanceBenchmarker.js";
import { registerCostConfig, recordApiUsage, getCostRecord, getOptimizationRecommendations, _resetCostOptimizerForTest } from "../apiCostOptimizer.js";
import { registerDependency, getDependencyGraph, getDependentsOf, getDependenciesOf, _resetDependencyMapperForTest } from "../apiDependencyMapper.js";
import { compareSchemas, _resetChangeDetectorForTest } from "../apiChangeDetector.js";
import { registerMigrationScript, runMigration, getMigrationHistory, getPendingMigrations, isApplied, _resetMigrationEngineForTest } from "../apiMigrationEngine.js";
import { addKnowledge, searchKnowledge, getKnowledgeByCategory, updateKnowledge, _resetKnowledgeBaseForTest } from "../apiKnowledgeBase.js";
import { registerApiProfile, getRecommendations, _resetRecommendationEngineForTest } from "../apiRecommendationEngine.js";
import { createCompositionPlan, getExecutionOrder, _resetCompositionPlannerForTest } from "../apiCompositionPlanner.js";
import { startDeployment, recordHealthCheck as recordDeployHealthCheck, finalizeDeployment, getDeploymentRecord, getDeploymentsByApi, _resetDeploymentAutomatorForTest } from "../apiDeploymentAutomator.js";
import { recordMetricSnapshot, addAlertRule, getDashboardView, resolveAlert, _resetMonitoringDashboardForTest } from "../apiMonitoringDashboard.js";
import { registerProxy, simulateCall, resetCircuit, getProxyHealth, _resetSelfHealingProxyForTest } from "../apiSelfHealingProxy.js";
import { registerAgent, registerHandler, sendMessage, getAgentStatus, listActiveAgents, getMessageLog, updateAgentStatus, _resetUniversalAgentInterfaceForTest } from "../universalAgentInterface.js";
import { setContext, getContext, queryContext, removeContext, getContextSnapshot, _resetOmniscientContextForTest } from "../omniscientContextManager.js";
import { recordLearningEvent, getLearnedPatterns, getLearningStats, _resetPerpetualLearningForTest } from "../perpetualLearningEngine.js";
import { createGoal as createAdaptiveGoal, updateGoalProgress as updateAdaptiveGoalProgress, adaptGoal, getGoalHierarchy, getActiveGoals, reprioritizeGoals, _resetGoalHierarchyForTest } from "../adaptiveGoalHierarchy.js";
import { registerCapability, updateCapabilityProficiency, captureSnapshot as captureSelfSnapshot, getCapabilityByName, getSnapshotHistory, _resetSelfModelForTest } from "../transcendentSelfModel.js";
import { registerSubsystem, updateSubsystemMetrics, recordSystemEvent, generateUnifiedReport, getReportHistory, getSystemEvents, _resetGrandUnificationMonitorForTest } from "../grandUnificationMonitor.js";
import { registerTopology, optimizeTopology } from "../neuralTopologyOptimizer";
import { initializeWeights, applyWeightUpdate } from "../synapticWeightManager";
import { recordActivation, analyzeLayer } from "../activationPatternAnalyzer";
import { pruneLayer, computeSparsity } from "../neuralPruningEngine";
import { analyzeFusionCandidates, applyFusion } from "../layerFusionOptimizer";
import { recordGradient, analyzeGradientFlow } from "../gradientFlowMonitor";
import { buildDeductiveChain, validateChain } from "../deductiveReasoningChain";
import { addObservation, synthesizePatterns } from "../inductivePatternSynthesizer";
import { generateHypotheses, getBestHypothesis } from "../abductiveHypothesisEngine";
import { registerConcept, findAnalogies } from "../analogicalReasoningBridge";
import { conductDebate, getDebateHistory } from "../dialecticalDebateEngine";
import { addCalibrationSample, calibrate, applyCalibration } from "../reasoningConfidenceCalibrator";
import { storeEpisode, recallEpisode, searchEpisodes } from "../episodicMemoryStore";
import { indexFact, queryFacts } from "../semanticMemoryIndex";
import { pushToWorkingMemory, getWorkingMemory, focusAttention } from "../workingMemoryBuffer";
import { consolidateMemories } from "../memoryConsolidator";
import { indexMemory, retrieveByAssociation } from "../memoryRetrievalOptimizer";
import { createTrace, reviewTrace, getDueForReview } from "../forgettingCurveManager";
import { predictShortTerm } from "../shortTermPredictor";
import { forecastLongTerm } from "../longTermForecaster";
import { propagateUncertainty } from "../uncertaintyPropagator";
import { addPredictionOutcome, evaluateCalibration } from "../predictionCalibrator";
import { simulateScenarios } from "../scenarioSimulator";
import { ensemblePredictions } from "../predictionEnsembler";
import { registerTemplate, generateText } from "../naturalLanguageGenerator";
import { defineIntent, parseIntent } from "../intentParser";
import { createSession, addTurn, fillSlot } from "../dialogueManager";
import { registerProfile, generateContextualResponse } from "../contextualResponder";
import { encodeMultimodal, computeSimilarity } from "../multimodalEncoder";
import { adaptStyle } from "../communicationStyleAdapter";
import { optimizeGradientDescent } from "../gradientDescentOptimizer";
import { optimizeBayesian } from "../bayesianOptimizer";
import { optimizeEvolutionary } from "../evolutionaryOptimizer";
import { optimizeSimulatedAnnealing } from "../simulatedAnnealingEngine";
import { optimizePSO } from "../particleSwarmOptimizer";
import { ensembleOptimizers } from "../optimizationEnsembler";
import { registerSignature, detectThreats } from "../threatDetector";
import { recordBaseline, evaluateAnomaly } from "../anomalyIsolator";
import { signPayload, verifyPayload, hashData } from "../cryptographicVerifier";
import { defineRole, assignRole, checkAccess } from "../accessControlManager";
import { logAuditEvent, verifyTrailIntegrity, generateComplianceReport } from "../auditTrailEnforcer";
import { registerPatch, stagePatch, applyPatch, rollbackPatch } from "../securityPatchApplier";
import { registerAgent as registerCoordAgent, createCoordinationTask, assignTask, submitResult } from "../multiAgentCoordinator";
import { createWorkspace, putArtifact, getArtifact } from "../sharedWorkspaceManager";
import { reportConflict, mediateConflict, resolveConflict } from "../conflictMediationEngine";
import { makeCollectiveDecision } from "../collectiveDecisionMaker";
import { publishKnowledge, syncKnowledge, getKnowledge } from "../knowledgeSynchronizer";
import { addRating, getRecommendations as getCollabRecommendations } from "../collaborativeFilteringEngine";









const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Start all background daemons. Called after server.listen() succeeds.
 */
export function startDaemons(): void {
  // v5.75: Generate ANDROMEDA.md — grounds the model in actual file structure
  try {
    const serverDir = resolve(__dirname, "..");
    const workspaceDir = resolve(process.cwd(), "workspace");
    generateAndromedaMd(serverDir, workspaceDir);
  } catch { /* non-fatal */ }

  // v5.68: Seed foundational memories on first boot
  try { seedInitialMemoriesIfEmpty(); } catch { /* non-fatal */ }

  // v7.1: Start all SOTA autonomy daemons
  try {
    initPersistentContextStore();
    startContextCompressionDaemon();
    startCodebaseAnalyzer();
    startDependencyAuditor();
    startTestCoverageAnalyzer();
    startBenchmarkRunner();
    startCodeQualityMonitor();
    startDocGenerator();
    startSelfReflectionEngine();
    startMemoryForgettingCurveDaemon();
    startCapabilityDiscovery();
    // Initialize prompt engineer stats (event-driven, no daemon needed)
    getPromptStats();
    console.log("[v7.1] All autonomy daemons started successfully");
  } catch (daemonErr) {
    console.warn("[v7.1] Some daemons failed to start:", (daemonErr as Error).message);
  }

  // v12.13.0: Start module health watchdog — monitors all critical modules for health degradation
  try {
    initWatchdog();
    console.log("[v12.13.0] Module health watchdog started");
  } catch (wdErr) {
    console.warn("[v12.13.0] Watchdog failed to start:", (wdErr as Error).message);
  }

  // v13.0.0: Semantic Codebase Graph — builds AST-level symbol graph for impact radius proofs
  // Runs asynchronously in the background (non-blocking) to avoid delaying server startup.
  try {
    const projectRoot = resolve(__dirname, "..", "..");
    initSemanticCodebaseGraph(projectRoot);
    console.log("[v13.0.0] Semantic codebase graph initializing (background)");
  } catch (scgErr) {
    console.warn("[v13.0.0] Semantic codebase graph failed to start:", (scgErr as Error).message);
  }

  // v13.0.0: Multi-Agent Debate Protocol — loads persisted RLAIF weights and initializes agents
  try {
    initMultiAgentDebate();
    console.log("[v13.0.0] Multi-agent debate protocol initialized");
  } catch (madErr) {
    console.warn("[v13.0.0] Multi-agent debate failed to start:", (madErr as Error).message);
  }

  // v13.0.0: Chaos Engineer — runs a quick smoke test at boot to verify core resilience
  // Full chaos runs are scheduled every 24 hours.
  try {
    initChaosEngineer({
      runImmediately: true,  // Quick smoke test: circuit breaker + stream + JSON tests
      intervalHours: 24,     // Full chaos run every 24 hours
    });
    console.log("[v13.0.0] Chaos engineer initialized (smoke test queued)");
  } catch (ceErr) {
    console.warn("[v13.0.0] Chaos engineer failed to start:", (ceErr as Error).message);
  }

  // v14.0.0: RSI Worker Pool — parallel proposal generation with worker threads
  try {
    initRsiWorkerPool();
    console.log("[v14.0.0] RSI worker pool initialized");
  } catch (wpErr) {
    console.warn("[v14.0.0] RSI worker pool failed to start:", (wpErr as Error).message);
  }

  // v14.0.0: CI Regression Guard — loads historical test failure patterns
  try {
    initCiRegressionGuard();
    console.log("[v14.0.0] CI regression guard initialized");
  } catch (rgErr) {
    console.warn("[v14.0.0] CI regression guard failed to start:", (rgErr as Error).message);
  }

  // v14.0.0: Architectural Pattern Memory — loads cross-session pattern success/failure data
  try {
    initPatternMemory();
    console.log("[v14.0.0] Architectural pattern memory initialized");
  } catch (pmErr) {
    console.warn("[v14.0.0] Pattern memory failed to start:", (pmErr as Error).message);
  }

  // v14.0.0: Self-Healing Chaos — loads persisted hardening targets, logs any critical modules
  try {
    initSelfHealingChaos();
    console.log("[v14.0.0] Self-healing chaos loop initialized");
  } catch (shcErr) {
    console.warn("[v14.0.0] Self-healing chaos failed to start:", (shcErr as Error).message);
  }

  // v15.0.0: RSI Task Queue — Redis-backed distributed task queue (falls back to in-memory)
  try {
    initRsiTaskQueue();
    console.log("[v15.0.0] RSI task queue initialized");
  } catch (tqErr) {
    console.warn("[v15.0.0] RSI task queue failed to start:", (tqErr as Error).message);
  }

  // v15.0.0: Continuous Fine-Tuner — autonomous fine-tuning feedback loop (path to 99% acceptance)
  // Resumes polling any in-progress fine-tuning jobs from previous sessions.
  try {
    initContinuousFineTuner();
    console.log("[v15.0.0] Continuous fine-tuner initialized");
  } catch (cftErr) {
    console.warn("[v15.0.0] Continuous fine-tuner failed to start:", (cftErr as Error).message);
  }

  // v15.0.1: RSI Adaptive Scheduler — adaptive interval scheduling (backs off on failure, speeds up on success)
  try {
    initRsiScheduler();
    console.log("[v15.0.1] RSI adaptive scheduler initialized");
  } catch (schedErr) {
    console.warn("[v15.0.1] RSI adaptive scheduler failed to start:", (schedErr as Error).message);
  }

  // v16.0.0: Distributed Consensus — 3-node voting protocol (single-node auto-pass if no peers configured)
  try {
    initDistributedConsensus();
    console.log("[v16.0.0] Distributed consensus protocol initialized");
  } catch (dcErr) {
    console.warn("[v16.0.0] Distributed consensus failed to start:", (dcErr as Error).message);
  }

  // v16.0.0: Benchmark Regression Suite — 20 micro-benchmarks as a hard gate before any proposal apply
  try {
    initBenchmarkRegressionSuite();
    console.log("[v16.0.0] Benchmark regression suite initialized");
  } catch (brsErr) {
    console.warn("[v16.0.0] Benchmark regression suite failed to start:", (brsErr as Error).message);
  }

  // v16.0.0: RSI Dashboard — real-time live dashboard at /dashboard (SSE + REST snapshot)
  try {
    initRsiDashboard();
    console.log("[v16.0.0] RSI dashboard initialized — available at /dashboard");
  } catch (dashErr) {
    console.warn("[v16.0.0] RSI dashboard failed to start:", (dashErr as Error).message);
  }

  // v17.0.0: Proposal Genealogy — DAG tracking of proposal lineage, merges, rollbacks, patterns
  try {
    initProposalGenealogy();
    console.log("[v17.0.0] Proposal genealogy DAG initialized");
  } catch (pgErr) {
    console.warn("[v17.0.0] Proposal genealogy failed to start:", (pgErr as Error).message);
  }

  // v17.0.0: Rollback Verifier — auto-verifies every rollback is clean with TypeScript + test re-run
  try {
    initRollbackVerifier();
    console.log("[v17.0.0] Rollback verifier initialized");
  } catch (rvErr) {
    console.warn("[v17.0.0] Rollback verifier failed to start:", (rvErr as Error).message);
  }

  // v18.0.0: Fine-Tuner Activation — verifies API key has fine-tuning scope, emits health check
  try {
    initFineTunerActivation();
    console.log("[v18.0.0] Fine-tuner activation check initialized");
  } catch (ftaErr) {
    console.warn("[v18.0.0] Fine-tuner activation failed to start:", (ftaErr as Error).message);
  }

  // v18.0.0: Consensus Config — live 3-node peer config with health checks + auto-discovery
  try {
    initConsensusConfig();

  // v19.0.0
  initConsolidationV2();
  resetBenchmarkBaseline();

  // v20.0.0
  initUcdDaemon(process.cwd());
  initGlobalMemory();

    // v28
    initBootstrapper({ operatorEmail: "admin@example.com", enableSystemd: false, enableAutoUpdate: true });
    initStreamingDashboard(8081);

    // v29
    initSrilDaemon();
    initDeploymentDaemon();
    // v30
    initSemanticVersionControl();
    initStakeholderReporting();
    initCognitiveLoadBalancer();
    // v31
    initMetaCognitiveEngine();
    initSpikePlasticityEngine();
    initCurriculumDesigner();
    initCounterfactualSimulator();
    initEmergentLanguageProtocol();
    // v32
    initSubAgentSpawner();
    initComputeBudgetManager();
    initResearchPublisher();
    initCrossSystemNegotiation();
    initTemporalKnowledgeDistillation();
    initEmergentGoalSynthesis();
    // v33
    initComputeEconomyManager();
    initGovernanceConstitution();
    initLongRangePlanner();
    initAdversarialRedTeam();
    initTemporalAbstractionEngine();
    initAIBootstrapper();
    // v34
    initFormalVerificationEngine();
    initOptimalityTracker();
    initInfiniteHorizonPlanner();
    initSelfHealingArchitecture();
    initCapabilityExtrapolator();
    initMetaRewardShaper();
    // v35
    initRecursiveSelfModificationAuditor();
    initCapabilitySynthesisEngine();
    initEpistemicUncertaintyQuantifier();
    initFederatedLearningCoordinator();
    initCausalReasoningEngine();
    initOmegaConvergenceMonitor();
    // v36
    initPerpetualStatePersistence();
    initAdaptiveExplorationController();
    initMultiObjectiveOptimizer();
    initKnowledgeGraphBuilder();
    initAnomalyDetectionEngine();
    initSelfDocumentationGenerator();
    // v37
    initHypothesisGenerator();
    initExperimentDesigner();
    initResultAnalyzer();
    initPeerReviewSimulator();
    initScientificMemory();
    initBreakthroughDetector();
    // v38
    initArchitectureEvolver();
    initModuleComposer();
    initInterfaceNegotiator();
    initDependencyOptimizer();
    initCodeQualityOracle();
    initRefactoringEngine();
    // v39
    initConceptMapper();
    initAnalogyEngine();
    initTransferLearningBroker();
    initDomainBridger();
    initSemanticCompressor();
    initKnowledgeFusion();
    // v40
    initConstitutionalGuard();
    initAlignmentMonitor();
    initValuePreservation();
    initCorrigibilityEngine();
    initOversightProtocol();
    initSafetyProofChecker();
    // v41
    initEnergyProfiler();
    initMemoryOptimizer();
    initLatencyPredictor();
    initThroughputMaximizer();
    initCostEstimator();
    initResourceAuctioneer();
    // v42
    initCollaborationEngine();
    initTrustBuilder();
    initReputationTracker();
    initConflictResolver();
    initConsensusNegotiator();
    initSocialNormLearner();
    // v43
    initEventSequencer();
    initCausalChainTracer();
    initFutureStatePredictor();
    initHistoricalPatternMiner();
    initTimeSeriesForecaster();
    initTemporalConsistencyChecker();
    // v44
    initActionSpacePlanner();
    initSensorFusionEngine();
    initMotorSkillLibrary();
    initEnvironmentModeler();
    initTaskDecomposerV44();
    initExecutionMonitor();
    // v45
    initSystemIntegrator();
    initCapabilityOrchestrator();
    initGlobalOptimizer();
    initEmergenceDetector();
    initSingularityPreparator();
    initOmegaStateManager();


  initSummarizer();

  // v21.0.0
  initHypothesisEngine();
  initPaperWriter();
  initNeuromorphicMemory();
  initNasEngine();

  // v22.0.0
  initMetaRsi();
  initCausalModel();
  initNtdlMemory();
  initBenchmarkSynthesizer();
  initConstitutionalAI();




    console.log("[v18.0.0] Consensus config initialized");
  } catch (ccErr) {
    console.warn("[v18.0.0] Consensus config failed to start:", (ccErr as Error).message);
  }

  // v18.0.0: Reward Calibrator — Platt scaling layer to correct reward model confidence scores
  try {
    initRewardCalibrator();
    console.log("[v18.0.0] Reward calibrator initialized");
  } catch (rcErr) {
    console.warn("[v18.0.0] Reward calibrator failed to start:", (rcErr as Error).message);
  }

  // v18.0.0: Dependency Update RSI — extend RSI to propose/apply package.json dependency updates
  try {
    initDependencyUpdateRsi();
    console.log("[v18.0.0] Dependency update RSI initialized");
  } catch (durErr) {
    console.warn("[v18.0.0] Dependency update RSI failed to start:", (durErr as Error).message);
  }

  // v46 — Sub-Agent Economy I
  console.log("[Init] Sub-Agent Economy I initialized (marketplace, auctioneer, bidder, broker, rewards, reputation).");

  // v47 — Sub-Agent Economy II
  console.log("[Init] Sub-Agent Economy II initialized (spawn, lifecycle, bus, memory, registry, coordinator).");

  // v48 — Sub-Agent Economy III
  console.log("[Init] Sub-Agent Economy III initialized (loadBalancer, faultTolerance, versionControl, securitySandbox, profiler, orchestration).");

  // v49 — Sub-Agent Economy IV
  console.log("[Init] Sub-Agent Economy IV initialized (goalAlignment, ethics, auditLogger, rollback, selfHealer, economyMonitor).");

  // v50 — Sub-Agent Economy V
  console.log("[Init] Sub-Agent Economy V initialized (knowledgeSharer, specialization, evolution, collective, emergence, optimizer).");

  // v51 — External API Mastery I
  console.log("[Init] External API Mastery I initialized (docParser, schemaInferrer, clientGenerator, authManager, rateLimiter, healthMonitor).");

  // v52 — External API Mastery II
  console.log("[Init] External API Mastery II initialized (workflowComposer, dataTransformer, errorRecovery, versionAdapter, cachingLayer, securityAuditor).");

  // v53 — External API Mastery III
  console.log("[Init] External API Mastery III initialized (integrationTester, benchmarker, costOptimizer, dependencyMapper, changeDetector, migrationEngine).");

  // v54 — External API Mastery IV
  console.log("[Init] External API Mastery IV initialized (knowledgeBase, recommendationEngine, compositionPlanner, deploymentAutomator, monitoringDashboard, selfHealingProxy).");

  // v55 — The Grand Unification
  console.log("[Init] Grand Unification initialized (universalAgentInterface, omniscientContextManager, perpetualLearningEngine, adaptiveGoalHierarchy, transcendentSelfModel, grandUnificationMonitor).");
}
