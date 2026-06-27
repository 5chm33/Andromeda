# ANDROMEDA.md — Auto-generated at startup (v5.96)
> **THIS FILE IS INJECTED AT THE START OF EVERY SYSTEM PROMPT.**
> Read it completely before taking any action. It contains your real file structure,
> correct tool names, and mandatory protocols.
> Last updated: 2026-06-27T04:55:12.094Z

## ⚠️ CRITICAL: Your Runtime Paths (v5.96)
These are the ACTUAL paths on this machine. Use these in ALL bash_execute commands.

| Path | Value |
|------|-------|
| Project root | `/home/ubuntu/andromeda_work` |
| Server source | `/home/ubuntu/andromeda_work/server` |
| Workspace | `/home/ubuntu/andromeda_work/workspace` |

**When searching for source files, use:**
```bash
find "/home/ubuntu/andromeda_work/server" -name "*.ts" | sort
# OR simply:
ls "/home/ubuntu/andromeda_work/server"
```

**NEVER use /app/, /app/src/, /app/server/src/, or C:\Users\ paths — they do NOT exist.**

## ⚠️ IMPORTANT: Your source files are in server/ (NOT src/)
The following is the ACTUAL list of files in your server/ directory as of this startup.
You do NOT need to call any tool to discover these — they are listed here.
To read any of these files, use: self_read_server_file with file_path set to the filename (e.g., "llmProvider.ts").

```
  abTestingEngine.ts (4KB)
  abTestingFramework.ts (3KB)
  abductiveHypothesisEngine.ts (2KB)
  accessControlManager.ts (2KB)
  actionExecutor.ts (3KB)
  actionSpacePlanner.ts (3KB)
  activationPatternAnalyzer.ts (3KB)
  adaptiveBatchScheduler.ts (2KB)
  adaptiveEval.test.ts (4KB)
  adaptiveEval.ts (28KB)
  adaptiveExplorationController.ts (5KB)
  adaptiveGoalHierarchy.ts (3KB)
  adaptiveLearner.ts (4KB)
  adaptivePartitions.test.ts (1KB)
  adaptivePartitions.ts (8KB)
  adaptiveRouter.test.ts (4KB)
  adaptiveRouter.ts (11KB)
  adaptiveSelfConsistency.ts (1KB)
  adminAuth.test.ts (1KB)
  adminAuth.ts (3KB)
  advancedCache.test.ts (0KB)
  advancedCache.ts (0KB)
  adversarial.test.ts (13KB)
  adversarialRedTeam.ts (7KB)
  adversarialSelfPlay.ts (3KB)
  adversarialTestGen.test.ts (2KB)
  adversarialTestGen.ts (2KB)
  agentAuditLogger.ts (3KB)
  agentBidder.ts (3KB)
  agentCapabilityNegotiator.ts (3KB)
  agentCapabilityRegistry.ts (3KB)
  agentCollectiveIntelligence.ts (3KB)
  agentCommunicationBus.ts (3KB)
  agentCoordinator.ts (3KB)
  agentEconomyMonitor.ts (4KB)
  agentEconomyOptimizer.ts (3KB)
  agentElectionProtocol.ts (2KB)
  agentEmergenceDetectorV50.ts (3KB)
  agentEthicsEnforcer.ts (3KB)
  agentEvolutionTracker.ts (3KB)
  agentFaultTolerance.ts (3KB)
  agentGoalAlignment.ts (3KB)
  agentKnowledgeSharer.ts (3KB)
  agentLifecycleManager.ts (3KB)
  agentLoadBalancer.ts (3KB)
  agentMemoryBroker.ts (3KB)
  agentMessageBus.ts (3KB)
  agentOrchestrationEngine.ts (3KB)
  agentOrchestrator.test.ts (1KB)
  agentOrchestrator.ts (24KB)
  agentPerformanceProfiler.ts (3KB)
  agentRegistry.ts (2KB)
  agentReputationLedger.ts (3KB)
  agentRollbackManager.ts (2KB)
  agentSecuritySandbox.ts (3KB)
  agentSelfHealer.ts (3KB)
  agentSpawnController.ts (4KB)
  agentSpecializationEngine.ts (3KB)
  agentStateMachine.test.ts (3KB)
  agentStateMachine.ts (4KB)
  agentStateSync.ts (3KB)
  agentSystemPrompt.test.ts (1KB)
  agentSystemPrompt.ts (14KB)
  agentTaskDelegator.ts (3KB)
  agentTypes.test.ts (1KB)
  agentTypes.ts (3KB)
  agentVersionControl.ts (3KB)
  ai.test.ts (0KB)
  ai.ts (0KB)
  aiBootstrapper.ts (6KB)
  aiChangelog.test.ts (1KB)
  aiChangelog.ts (7KB)
  aiMemory.test.ts (1KB)
  aiMemory.ts (3KB)
  aiPlanning.test.ts (9KB)
  aiPlanning.ts (30KB)
  aiPrompts.test.ts (1KB)
  aiPrompts.ts (11KB)
  aiStreaming.test.ts (1KB)
  aiStreaming.ts (27KB)
  aiTokens.test.ts (1KB)
  aiTokens.ts (9KB)
  aiZipEdit.test.ts (1KB)
  aiZipEdit.ts (4KB)
  alertingEngine.ts (2KB)
  algorithmicDiscovery.test.ts (2KB)
  algorithmicDiscovery.ts (4KB)
  algorithmicDiscoveryV2.test.ts (3KB)
  algorithmicDiscoveryV2.ts (14KB)
  alignmentMonitor.ts (5KB)
  analogicalReasoningBridge.ts (2KB)
  analogyEngine.ts (5KB)
  andromedaBootstrapper.ts (4KB)
  andromedaCore.ts (4KB)
  andromedaDaemon.test.ts (1KB)
  andromedaDaemon.ts (8KB)
  andromedaDb.test.ts (11KB)
  andromedaDb.ts (19KB)
  andromedaMemoryWriter.test.ts (3KB)
  andromedaMemoryWriter.ts (23KB)
  annealingScheduler.ts (3KB)
  anomalyDetectionEngine.ts (6KB)
  anomalyDetector.ts (3KB)
  anomalyIsolator.ts (2KB)
  anonymizationPipeline.ts (3KB)
  apexIntegrationOrchestrator.ts (4KB)
  apiAuthManager.ts (2KB)
  apiCachingLayer.ts (2KB)
  apiChangeDetector.ts (3KB)
  apiCircuitBreaker.ts (3KB)
  apiClientGenerator.ts (3KB)
  apiCompositionPlanner.ts (2KB)
  apiCostOptimizer.ts (4KB)
  apiDataTransformer.ts (3KB)
  apiDependencyMapper.ts (2KB)
  apiDeploymentAutomator.ts (2KB)
  apiDocumentationParser.ts (4KB)
  apiErrorRecovery.ts (3KB)
  apiGateway.ts (2KB)
  apiHealthMonitor.ts (3KB)
  apiIntegrationTester.ts (4KB)
  apiKnowledgeBase.ts (2KB)
  apiMigrationEngine.ts (2KB)
  apiMonitoringDashboard.ts (4KB)
  apiPerformanceBenchmarker.ts (2KB)
  apiRateLimiter.ts (2KB)
  apiRecommendationEngine.ts (3KB)
  apiSchemaInferrer.ts (4KB)
  apiSecurityAuditor.ts (3KB)
  apiSelfHealingProxy.ts (4KB)
  apiVersionAdapter.ts (3KB)
  apiVersionRouter.ts (2KB)
  apiWorkflowComposer.ts (3KB)
  architectureEvolver.ts (6KB)
  arxivSubmitter.ts (3KB)
  astContextInjector.ts (8KB)
  astDiff.test.ts (12KB)
  astDiff.ts (10KB)
  astKnowledgeGraph.test.ts (11KB)
  astKnowledgeGraph.ts (18KB)
  astMutator.test.ts (13KB)
  astMutator.ts (15KB)
  attentionMechanism.ts (3KB)
  audioAnalyzer.ts (2KB)
  auditLog.test.ts (1KB)
  auditLog.ts (11KB)
  auditTrailEnforcer.ts (2KB)
  auth.logout.test.ts (2KB)
  autoGoalSuggester.test.ts (3KB)
  autoGoalSuggester.ts (9KB)
  autoHealing.test.ts (8KB)
  autoHealing.ts (15KB)
  autoRebuild.test.ts (4KB)
  autoRebuild.ts (13KB)
  autonomousCodeReviewer.ts (2KB)
  autonomousDeployment.ts (10KB)
  autonomousDocSynthesizer.ts (2KB)
  autonomousGoalGenerator.test.ts (4KB)
  autonomousGoalGenerator.ts (14KB)
  autonomyOrchestrator.test.ts (1KB)
  autonomyOrchestrator.ts (21KB)
  bayesianOptimizer.ts (2KB)
  behavioralRegressionEngine.test.ts (3KB)
  behavioralRegressionEngine.ts (13KB)
  benchmarkRegressionSuite.ts (13KB)
  benchmarkRunner.test.ts (3KB)
  benchmarkRunner.ts (13KB)
  benchmarkSynthesizer.ts (2KB)
  biasDetector.test.ts (3KB)
  biasDetector.ts (17KB)
  billingReporter.ts (2KB)
  bottleneckDetector.ts (3KB)
  brave.test.ts (1KB)
  breakthroughDetector.ts (5KB)
  browser.test.ts (8KB)
  browser.ts (19KB)
  budgetAlertEngine.ts (2KB)
  cache.test.ts (11KB)
  cache.ts (9KB)
  canaryDeployer.ts (3KB)
  capabilityBootstrapper.test.ts (4KB)
  capabilityBootstrapper.ts (20KB)
  capabilityDiscovery.test.ts (4KB)
  capabilityDiscovery.ts (8KB)
  capabilityExtrapolator.ts (7KB)
  capabilityOrchestrator.ts (4KB)
  capabilitySynthesisEngine.ts (7KB)
  causalChainTracer.ts (3KB)
  causalDiscovery.ts (2KB)
  causalGraph.ts (3KB)
  causalIntervention.ts (2KB)
  causalReasoning.test.ts (8KB)
  causalReasoning.ts (18KB)
  causalReasoningEngine.ts (6KB)
  causalWorldModel.ts (3KB)
  chaosEngineer.ts (21KB)
  chartUnderstander.ts (2KB)
  ciPipeline.test.ts (1KB)
  ciPipeline.ts (12KB)
  ciRegressionGuard.test.ts (2KB)
  ciRegressionGuard.ts (6KB)
  circuitBreaker.test.ts (2KB)
  circuitBreaker.ts (10KB)
  circuitBreaker.v12.test.ts (5KB)
  circuitBreakerV68.ts (2KB)
  cloudProvisioning.test.ts (8KB)
  cloudProvisioning.ts (14KB)
  cloudSpendAnalyzer.ts (4KB)
  codeComplexityAnalyzer.ts (3KB)
  codeExecutionSandbox.ts (2KB)
  codeFormatterEngine.ts (2KB)
  codeIntel.test.ts (2KB)
  codeIntel.ts (14KB)
  codeParser.ts (4KB)
  codeQualityMonitor.test.ts (3KB)
  codeQualityMonitor.ts (18KB)
  codeQualityOracle.ts (5KB)
  codeRewriter.ts (3KB)
  codeRunner.test.ts (1KB)
  codeRunner.ts (6KB)
  codeSearchIndexer.ts (2KB)
  codebaseAnalyzer.test.ts (4KB)
  codebaseAnalyzer.ts (11KB)
  cognitiveController.ts (4KB)
  cognitiveLoadBalancer.ts (8KB)
  collaborationEngine.ts (3KB)
  collaborativeFilteringEngine.ts (3KB)
  collectiveDecisionMaker.ts (1KB)
  collisionDetector.ts (3KB)
  communicationProtocol.ts (3KB)
  communicationStyleAdapter.ts (2KB)
  computeAuctioneer.ts (3KB)
  computeBudgetManager.ts (7KB)
  computeEconomyManager.ts (6KB)
  conceptDriftHandler.ts (2KB)
  conceptMapper.ts (5KB)
  configManager.ts (2KB)
  conflictMediationEngine.ts (2KB)
  conflictResolver.ts (4KB)
  confoundingDetector.ts (2KB)
  consciousnessStateTracker.ts (2KB)
  consensusConfig.ts (7KB)
  consensusEngine.test.ts (3KB)
  consensusEngine.ts (11KB)
  consensusNegotiator.ts (3KB)
  consentManager.ts (2KB)
  constitutionalAI.ts (2KB)
  constitutionalAmendment.ts (4KB)
  constitutionalConstraints.test.ts (2KB)
  constitutionalConstraints.ts (4KB)
  constitutionalGuard.ts (6KB)
  constraintSolver.ts (4KB)
  contextAwareness.test.ts (2KB)
  contextAwareness.ts (10KB)
  contextBus.test.ts (13KB)
  contextBus.ts (19KB)
  contextCompressionDaemon.test.ts (3KB)
  contextCompressionDaemon.ts (9KB)
  contextManager.test.ts (2KB)
  contextManager.ts (13KB)
  contextPropagator.ts (2KB)
  contextualResponder.ts (2KB)
  continualLearner.ts (3KB)
  continuousFineTuner.ts (14KB)
  continuousFineTuning.test.ts (1KB)
  continuousFineTuning.ts (3KB)
  continuousImprover.test.ts (3KB)
  continuousImprover.ts (38KB)
  corrigibilityEngine.ts (4KB)
  corrigibilityManager.ts (3KB)
  costAllocationEngine.ts (3KB)
  costEstimator.ts (4KB)
  costOptimizer.test.ts (4KB)
  costOptimizer.ts (12KB)
  costTracker.ts (2KB)
  counterfactualGenerator.ts (3KB)
  counterfactualReasoner.ts (3KB)
  counterfactualSimulator.ts (7KB)
  criticEngine.ts (10KB)
  criticalPath.test.ts (3KB)
  cronExpressionParser.ts (3KB)
  crossDomainAdapter.test.ts (5KB)
  crossDomainAdapter.ts (16KB)
  crossInstanceRlhf.test.ts (4KB)
  crossInstanceRlhf.ts (13KB)
  crossModalRetriever.ts (3KB)
  crossModalSelfImprovement.test.ts (13KB)
  crossModalSelfImprovement.ts (16KB)
  crossProposalConflictDetector.test.ts (7KB)
  crossProposalConflictDetector.ts (10KB)
  crossRepoRsi.ts (2KB)
  crossSystemNegotiation.ts (5KB)
  crowdWisdomAggregator.ts (3KB)
  cryptographicVerifier.ts (2KB)
  curriculumDesigner.ts (6KB)
  dataCatalog.ts (2KB)
  dataLineageTracker.ts (2KB)
  dataPipelineEngine.ts (2KB)
  dataQualityMonitor.ts (2KB)
  dataRetentionPolicy.ts (2KB)
  dataTransformRegistry.ts (1KB)
  dataValidator.ts (2KB)
  db.test.ts (2KB)
  db.ts (10KB)
  dbPostgres.test.ts (1KB)
  dbPostgres.ts (8KB)
  deadCodeDetector.ts (3KB)
  deadLetterQueue.ts (2KB)
  decisionExplainer.ts (3KB)
  deductiveReasoningChain.ts (2KB)
  deepseek.test.ts (1KB)
  depGraphOptimizer.ts (2KB)
  dependencyAuditor.test.ts (3KB)
  dependencyAuditor.ts (10KB)
  dependencyGraph.test.ts (2KB)
  dependencyGraph.ts (16KB)
  dependencyGraphAnalyzer.ts (3KB)
  dependencyOptimizer.ts (5KB)
  dependencyResolver.test.ts (14KB)
  dependencyResolver.ts (32KB)
  dependencyScanner.ts (2KB)
  dependencyUpdateRsi.ts (13KB)
  diagramInterpreter.ts (2KB)
  dialecticalDebateEngine.ts (1KB)
  dialogueManager.ts (2KB)
  discourseManager.ts (3KB)
  distributedConsensus.ts (16KB)
  distributedProofConsensus.test.ts (14KB)
  distributedProofConsensus.ts (17KB)
  distributionShiftDetector.ts (3KB)
  doCalculus.ts (3KB)
  docGenerator.test.ts (3KB)
  docGenerator.ts (13KB)
  dockerSandbox.test.ts (2KB)
  dockerSandbox.ts (4KB)
  documentClassifier.ts (2KB)
  documentIndexer.ts (2KB)
  documentParser.ts (2KB)
  documentSearchEngine.ts (3KB)
  documentSummarizer.ts (3KB)
  documentTemplateEngine.ts (3KB)
  documentVersionManager.ts (2KB)
  domainAdaptationEngine.ts (2KB)
  domainBridger.ts (3KB)
  dynamicModelRouter.ts (3KB)
  dynamicModelWeights.ts (12KB)
  dynamicTestGen.test.ts (10KB)
  dynamicTestGen.ts (11KB)
  ebpfGrounding.test.ts (6KB)
  ebpfGrounding.ts (14KB)
  edgeLLMRouter.test.ts (4KB)
  edgeLLMRouter.ts (10KB)
  embodiedAgent.ts (4KB)
  emergenceDetector.ts (4KB)
  emergentAbstractionEngine.ts (2KB)
  emergentBehaviorDetector.ts (3KB)
  emergentFineTuner.ts (3KB)
  emergentGoalSynthesis.ts (8KB)
  emergentLanguageProtocol.ts (7KB)
  emergentSpecialization.ts (4KB)
  energyProfiler.ts (3KB)
  entityLinker.ts (3KB)
  environmentModel.ts (4KB)
  environmentModeler.ts (3KB)
  environmentPerceiver.ts (2KB)
  environmentalAdaptor.ts (2KB)
  episodicConsolidation.test.ts (2KB)
  episodicConsolidation.ts (12KB)
  episodicConsolidationV2.ts (6KB)
  episodicMemory.test.ts (4KB)
  episodicMemory.ts (10KB)
  episodicMemoryStore.ts (2KB)
  epistemicBeliefModel.test.ts (12KB)
  epistemicBeliefModel.ts (21KB)
  epistemicUncertaintyQuantifier.ts (6KB)
  errorBudgetMonitor.ts (2KB)
  ethicsAuditor.ts (3KB)
  ethicsEngine.ts (3KB)
  evalDrivenTargeting.test.ts (1KB)
  evalDrivenTargeting.ts (9KB)
  evalFramework.test.ts (3KB)
  evalFramework.ts (41KB)
  evalGoalDiscovery.test.ts (2KB)
  evalGoalDiscovery.ts (7KB)
  evalSeed.test.ts (3KB)
  evalSeed.ts (13KB)
  eventBus.ts (2KB)
  eventDrivenTrigger.ts (3KB)
  eventSequencer.ts (3KB)
  evolutionaryOptimizer.ts (2KB)
  evolutionarySearch.test.ts (5KB)
  evolutionarySearch.ts (4KB)
  executionMonitor.ts (4KB)
  experimentDesigner.ts (6KB)
  experimentTracker.ts (2KB)
  explanationReporter.ts (4KB)
  externalBenchmarkGate.ts (8KB)
  externalRepoFixer.ts (24KB)
  failurePatternMemory.test.ts (3KB)
  failurePatternMemory.ts (8KB)
  fairnessAuditor.ts (4KB)
  featureAuditLog.ts (2KB)
  featureFlagManager.ts (3KB)
  featureImportanceAnalyzer.ts (3KB)
  federatedKnowledgeGraph.ts (3KB)
  federatedLearning.test.ts (3KB)
  federatedLearning.ts (22KB)
  federatedLearningCoordinator.ts (7KB)
  federatedLoraSharing.test.ts (5KB)
  federatedLoraSharing.ts (9KB)
  federatedRLHF.test.ts (8KB)
  federatedRLHF.ts (11KB)
  federatedRsiNetwork.test.ts (2KB)
  federatedRsiNetwork.ts (2KB)
  fewShotLearner.ts (5KB)
  fileEngine.test.ts (2KB)
  fileEngine.ts (1KB)
  fileEngineAnalysis.test.ts (1KB)
  fileEngineAnalysis.ts (39KB)
  fileEngineChunking.test.ts (1KB)
  fileEngineChunking.ts (13KB)
  fileEngineTypes.test.ts (1KB)
  fileEngineTypes.ts (12KB)
  fileEngineUtils.test.ts (1KB)
  fileEngineUtils.ts (13KB)
  fileIOManager.ts (3KB)
  fineTunerActivation.ts (6KB)
  fitnessLandscapeMapper.ts (3KB)
  forecastEngine.ts (3KB)
  forgettingCurveManager.ts (2KB)
  formalVerification.test.ts (1KB)
  formalVerification.ts (5KB)
  formalVerificationEngine.ts (7KB)
  formalVerifier.ts (3KB)
  fsWatcher.test.ts (5KB)
  fsWatcher.ts (9KB)
  futureStatePredictor.ts (4KB)
  fuzz.test.ts (17KB)
  gameStateManager.ts (3KB)
  gdprComplianceChecker.ts (2KB)
  genealogyGuidedGeneration.ts (10KB)
  gitSandbox.test.ts (1KB)
  gitSandbox.ts (5KB)
  globalOptimizer.ts (4KB)
  goalConditionedRsi.ts (7KB)
  goalDecomposer.test.ts (3KB)
  goalDecomposer.ts (7KB)
  goalManager.test.ts (1KB)
  goalManager.ts (33KB)
  governanceConstitution.ts (9KB)
  gracefulDegradation.test.ts (4KB)
  gracefulDegradation.ts (24KB)
  gradientDescentOptimizer.ts (2KB)
  gradientFlowMonitor.ts (3KB)
  grandUnificationMonitor.ts (5KB)
  graphQueryEngine.ts (3KB)
  groundedDialogManager.ts (3KB)
  grounding.test.ts (2KB)
  grounding.ts (13KB)
  guardPipeline.integration.test.ts (15KB)
  harmPreventionFilter.ts (3KB)
  hebbianLearner.ts (2KB)
  hierarchicalPlanner.ts (4KB)
  historicalPatternMiner.ts (3KB)
  hotReload.test.ts (1KB)
  hotReload.ts (18KB)
  httpClientManager.ts (3KB)
  humanInTheLoop.ts (2KB)
  humanInTheLoopGate.test.ts (9KB)
  humanInTheLoopGate.ts (12KB)
  hybridCostRouter.test.ts (4KB)
  hybridCostRouter.ts (12KB)
  hyperparameterTuner.ts (3KB)
  hypothesisEngine.ts (3KB)
  hypothesisGenerator.ts (5KB)
  identityManifest.test.ts (3KB)
  identityManifest.ts (7KB)
  imageCaptioner.ts (2KB)
  importGraph.test.ts (1KB)
  importGraph.ts (13KB)
  incidentManager.ts (3KB)
  incrementalAstInvalidator.test.ts (7KB)
  incrementalAstInvalidator.ts (11KB)
  inductivePatternSynthesizer.ts (2KB)
  inferenceEngine.ts (3KB)
  infiniteContextSummarizer.ts (4KB)
  infiniteHorizonPlanner.ts (7KB)
  infiniteRecursionGuard.ts (1KB)
  intentParser.ts (2KB)
  intentionalityEngine.ts (2KB)
  interfaceNegotiator.ts (3KB)
  interventionEngine.ts (2KB)
  jobQueue.ts (3KB)
  knowledgeBaseConsolidation.test.ts (6KB)
  knowledgeBaseConsolidation.ts (14KB)
  knowledgeBaseManager.ts (3KB)
  knowledgeFusion.ts (5KB)
  knowledgeGraph.ts (4KB)
  knowledgeGraphBuilder.ts (6KB)
  knowledgeSynchronizer.ts (2KB)
  knowledgeTransfer.test.ts (2KB)
  knowledgeTransfer.ts (15KB)
  languageGrounder.ts (3KB)
  latencyPredictor.ts (3KB)
  layerFusionOptimizer.ts (3KB)
  learnedConstraints.test.ts (2KB)
  learnedConstraints.ts (7KB)
  licenseChecker.ts (3KB)
  llmCallCache.ts (3KB)
  llmProvider.test.ts (6KB)
  llmProvider.ts (53KB)
  llmRouter.test.ts (2KB)
  llmRouter.ts (14KB)
  localLora.test.ts (3KB)
  localLora.ts (7KB)
  logAnalyzer.ts (2KB)
  logger.test.ts (2KB)
  logger.ts (5KB)
  longRangePlanner.ts (8KB)
  longTermForecaster.ts (2KB)
  longTermMemoryConsolidation.test.ts (2KB)
  longTermMemoryConsolidation.ts (14KB)
  loraBackendDetector.test.ts (11KB)
  loraBackendDetector.ts (13KB)
  loraDpoPipeline.test.ts (12KB)
  loraDpoPipeline.ts (11KB)
  madDebate.test.ts (9KB)
  madDebate.ts (15KB)
  manifest.test.ts (2KB)
  manifest.ts (20KB)
  mcpClient.test.ts (1KB)
  mcpClient.ts (17KB)
  mctsHealEngine.test.ts (9KB)
  mctsHealEngine.ts (16KB)
  mctsPlan.test.ts (2KB)
  mctsPlan.ts (6KB)
  mctsPlanningEngine.test.ts (6KB)
  mctsPlanningEngine.ts (15KB)
  memory.test.ts (5KB)
  memory.ts (27KB)
  memoryConsolidation.test.ts (1KB)
  memoryConsolidation.ts (23KB)
  memoryConsolidator.ts (1KB)
  memoryForgettingCurve.test.ts (4KB)
  memoryForgettingCurve.ts (9KB)
  memoryIndexer.ts (3KB)
  memoryOptimizer.ts (4KB)
  memoryRetrievalOptimizer.ts (2KB)
  metaCognitiveEngine.ts (5KB)
  metaLearner.ts (3KB)
  metaMetaRsi.ts (3KB)
  metaRewardShaper.ts (6KB)
  metaRsiAgent.ts (4KB)
  metacognitionEngine.ts (3KB)
  metricsAggregator.ts (2KB)
  modalityRouter.ts (3KB)
  modelRegistry.test.ts (3KB)
  modelRegistry.ts (21KB)
  moduleComposer.ts (4KB)
  moePromptRouter.ts (2KB)
  monteCarloPlanner.ts (3KB)
  motionEventDetector.ts (3KB)
  motorSkillLibrary.ts (3KB)
  movingAverageCalculator.ts (2KB)
  multiAgent.test.ts (1KB)
  multiAgent.ts (14KB)
  multiAgentBus.test.ts (4KB)
  multiAgentBus.ts (6KB)
  multiAgentCoordinator.ts (3KB)
  multiAgentDebate.ts (25KB)
  multiAgentImprover.test.ts (2KB)
  multiAgentImprover.ts (11KB)
  multiFileProposalPlanner.test.ts (2KB)
  multiFileProposalPlanner.ts (12KB)
  multiModalCodeReader.ts (3KB)
  multiModalExecutionVerifier.ts (5KB)
  multiObjectiveOptimizer.ts (6KB)
  multimodalEncoder.ts (2KB)
  multimodalFusion.ts (1KB)
  nasEngine.ts (2KB)
  nativeVlm.test.ts (3KB)
  nativeVlm.ts (4KB)
  naturalLanguageGenerator.ts (2KB)
  neuralPopulationCoder.ts (2KB)
  neuralPruningEngine.ts (3KB)
  neuralTopologyOptimizer.ts (4KB)
  neuromorphicMemory.ts (3KB)
  neuroplasticAdapter.ts (2KB)
  notificationManager.ts (2KB)
  noveltySearchEngine.test.ts (3KB)
  noveltySearchEngine.ts (11KB)
  ntdlMemory.ts (3KB)
  objectTracker.ts (2KB)
  objectiveTracker.ts (3KB)
  observability.test.ts (3KB)
  observability.ts (11KB)
  observabilityDashboard.ts (2KB)
  ocrEngine.ts (2KB)
  ollamaAutoSetup.test.ts (5KB)
  ollamaAutoSetup.ts (18KB)
  omegaConvergenceDetector.ts (1KB)
  omegaConvergenceMonitor.ts (7KB)
  omegaStateManager.ts (4KB)
  omniscientContextManager.ts (3KB)
  oncallRouter.ts (2KB)
  onlineLearner.ts (3KB)
  onlineLearningController.ts (2KB)
  onlineRewardDistiller.ts (2KB)
  ontologicalModel.test.ts (10KB)
  ontologicalModel.ts (18KB)
  ontologyManager.ts (3KB)
  optimalityTracker.ts (6KB)
  optimizationEnsembler.ts (1KB)
  optimizationSuggester.ts (3KB)
  osGrounding.test.ts (5KB)
  osGrounding.ts (11KB)
  oversightProtocol.ts (4KB)
  paperWriter.ts (3KB)
  parallelProposalOrchestrator.ts (4KB)
  parallelRsi.test.ts (3KB)
  parallelRsi.ts (11KB)
  paretoOptimizer.ts (3KB)
  paretoRewardShaper.ts (2KB)
  particleSwarmOptimizer.ts (2KB)
  pathPlanner.ts (3KB)
  peerReviewNetwork.ts (3KB)
  peerReviewSimulator.ts (5KB)
  performanceProfiler.ts (2KB)
  perpetualLearningEngine.ts (3KB)
  perpetualStatePersistence.ts (5KB)
  persistentContextStore.test.ts (4KB)
  persistentContextStore.ts (9KB)
  persistentGlobalMemory.ts (2KB)
  pheromoneTrailManager.ts (3KB)
  piiRedactor.ts (3KB)
  planExecutor.ts (3KB)
  planMonitor.ts (3KB)
  planReviser.ts (3KB)
  pluginManager.ts (2KB)
  policyOptimizer.ts (3KB)
  polyglotRsi.ts (3KB)
  populationEvolver.ts (3KB)
  postmortemAnalyzer.ts (3KB)
  prGenerator.test.ts (1KB)
  prGenerator.ts (13KB)
  pragmaticReasoner.ts (3KB)
  predictionCalibrator.ts (1KB)
  predictionEnsembler.ts (2KB)
  predictiveFailurePrevention.ts (3KB)
  privacyEngine.ts (3KB)
  privilegeSeparation.test.ts (16KB)
  privilegeSeparation.ts (14KB)
  probabilisticTypeInference.test.ts (10KB)
  probabilisticTypeInference.ts (12KB)
  proceduralMemory.ts (3KB)
  promptEngineer.test.ts (2KB)
  promptEngineer.ts (8KB)
  proofAssistant.test.ts (10KB)
  proofAssistant.ts (16KB)
  proofVerifier.test.ts (13KB)
  proofVerifier.ts (21KB)
  proposalApplier.ts (1KB)
  proposalFeedback.test.ts (4KB)
  proposalFeedback.ts (8KB)
  proposalGenealogy.ts (15KB)
  proposalGenerator.ts (3KB)
  proposalInvariantVerifier.test.ts (6KB)
  proposalInvariantVerifier.ts (15KB)
  proposalRanker.ts (10KB)
  proposalSandbox.ts (12KB)
  proposalValidator.ts (5KB)
  qualiaCaptureSystem.ts (2KB)
  qualityToRSI.test.ts (2KB)
  qualityToRSI.ts (6KB)
  quantumInspiredOptimizer.ts (3KB)
  queueManager.ts (3KB)
  ragContextOptimizer.test.ts (2KB)
  ragContextOptimizer.ts (15KB)
  ragPipeline.test.ts (4KB)
  ragPipeline.ts (11KB)
  rateLimitEnforcer.ts (2KB)
  rateLimiter.ts (2KB)
  rbac.test.ts (1KB)
  rbac.ts (15KB)
  reactEngine.behavioral.test.ts (27KB)
  reactEngine.integration.test.ts (5KB)
  reactEngine.test.ts (3KB)
  reactEngine.ts (78KB)
  realEvalHarness.test.ts (4KB)
  realEvalHarness.ts (9KB)
  reasoningConfidenceCalibrator.ts (3KB)
  recursionGuard.test.ts (1KB)
  recursionGuard.ts (6KB)
  recursiveGoals.test.ts (2KB)
  recursiveGoals.ts (31KB)
  recursiveSelfModificationAuditor.ts (8KB)
  redisLock.test.ts (1KB)
  redisLock.ts (7KB)
  refactoringEngine.ts (5KB)
  reputationTracker.ts (3KB)
  requestValidator.ts (3KB)
  researchCollab.ts (3KB)
  researchPublisher.ts (7KB)
  resourceAuctioneer.ts (4KB)
  resourceCostOptimizer.ts (4KB)
  responseTransformer.ts (2KB)
  resultAnalyzer.ts (6KB)
  retryManager.ts (3KB)
  retryOrchestrator.ts (2KB)
  rewardCalculator.ts (3KB)
  rewardCalibrator.ts (7KB)
  rewardDistributor.ts (3KB)
  rewardModel.test.ts (1KB)
  rewardModel.ts (9KB)
  rlaifJudge.test.ts (3KB)
  rlaifJudge.ts (4KB)
  rlhfCollector.test.ts (1KB)
  rlhfCollector.ts (17KB)
  rlhfPipeline.ts (3KB)
  roboticsIoTAdapter.test.ts (3KB)
  roboticsIoTAdapter.ts (12KB)
  rollbackVerifier.ts (11KB)
  rolloutController.ts (3KB)
  router.test.ts (4KB)
  routers.test.ts (1KB)
  routers.ts (6KB)
  rsi.integration.test.ts (9KB)
  rsiDashboard.ts (22KB)
  rsiDashboardV2.ts (6KB)
  rsiDb.test.ts (2KB)
  rsiDb.ts (15KB)
  rsiEngine.test.ts (7KB)
  rsiEngine.ts (137KB)
  rsiEventBus.test.ts (1KB)
  rsiEventBus.ts (5KB)
  rsiScheduler.test.ts (1KB)
  rsiScheduler.ts (17KB)
  rsiScheduler.v12.test.ts (2KB)
  rsiTaskQueue.ts (11KB)
  rsiWorkerPool.ts (6KB)
  runbookExecutor.ts (2KB)
  runtimeConfig.test.ts (3KB)
  runtimeConfig.ts (10KB)
  runtimeGuard.test.ts (9KB)
  runtimeGuard.ts (10KB)
  safety.test.ts (6KB)
  safetyConstraintChecker.ts (3KB)
  safetyIntegration.test.ts (4KB)
  safetyProofChecker.ts (6KB)
  safetySupervisor.test.ts (3KB)
  safetySupervisor.ts (10KB)
  saliencyMapper.ts (3KB)
  sandboxManager.test.ts (3KB)
  sandboxManager.ts (13KB)
  sandboxVerifier.test.ts (2KB)
  sandboxVerifier.ts (11KB)
  sbomGenerator.ts (2KB)
  scenarioSimulator.ts (2KB)
  sceneSegmenter.ts (3KB)
  scheduler.test.ts (8KB)
  scheduler.ts (17KB)
  scientificMemory.ts (5KB)
  search.test.ts (3KB)
  search.ts (15KB)
  seasonalityAnalyzer.ts (2KB)
  secretsVault.ts (3KB)
  security.test.ts (1KB)
  security.ts (17KB)
  securityPatchApplier.ts (2KB)
  selfAwarenessEngine.ts (3KB)
  selfAwarenessMonitor.ts (3KB)
  selfConsistency.test.ts (2KB)
  selfConsistency.ts (14KB)
  selfCritiqueAgent.ts (6KB)
  selfDistillation.test.ts (4KB)
  selfDistillation.ts (3KB)
  selfDocumentation.test.ts (2KB)
  selfDocumentation.ts (6KB)
  selfDocumentationGenerator.ts (5KB)
  selfHeal.test.ts (4KB)
  selfHeal.ts (35KB)
  selfHealingArchitecture.ts (7KB)
  selfHealingChaos.ts (13KB)
  selfHealingInfra.ts (2KB)
  selfImprove.test.ts (8KB)
  selfImprove.ts (146KB)
  selfImproveGuard.test.ts (3KB)
  selfImproveGuard.ts (49KB)
  selfInspector.ts (2KB)
  selfIntrospect.test.ts (2KB)
  selfIntrospect.ts (16KB)
  selfKnowledgeBase.test.ts (2KB)
  selfKnowledgeBase.ts (23KB)
  selfModel.test.ts (6KB)
  selfModel.ts (16KB)
  selfModifier.ts (3KB)
  selfModify.test.ts (1KB)
  selfModify.ts (29KB)
  selfMonitor.test.ts (3KB)
  selfMonitor.ts (25KB)
  selfReflectionEngine.test.ts (2KB)
  selfReflectionEngine.ts (10KB)
  selfReview.test.ts (3KB)
  selfReview.ts (19KB)
  selfRollback.test.ts (4KB)
  selfRollback.ts (20KB)
  selfTestGenerator.test.ts (3KB)
  selfTestPipeline.test.ts (3KB)
  selfTestPipeline.ts (22KB)
  semanticCodebaseGraph.ts (25KB)
  semanticCompressor.ts (4KB)
  semanticDedup.ts (2KB)
  semanticDiffValidator.ts (11KB)
  semanticImpactPredictor.test.ts (5KB)
  semanticImpactPredictor.ts (8KB)
  semanticMemory.ts (3KB)
  semanticMemoryIndex.ts (1KB)
  semanticMergeResolver.ts (13KB)
  semanticRollback.ts (10KB)
  semanticSearchEngine.ts (2KB)
  semanticSelfModel.test.ts (15KB)
  semanticSelfModel.ts (23KB)
  semanticVersionControl.ts (9KB)
  sensorFusionEngine.ts (3KB)
  shadowInstance.test.ts (1KB)
  shadowInstance.ts (12KB)
  sharedWorkspaceManager.ts (2KB)
  shellExecutor.ts (2KB)
  shortTermPredictor.ts (2KB)
  simulatedAnnealingEngine.ts (2KB)
  simulationEngine.ts (3KB)
  singularityPreparator.ts (4KB)
  skillGraph.test.ts (5KB)
  skillGraph.ts (14KB)
  slaMonitor.ts (2KB)
  sloTracker.ts (3KB)
  socialNormLearner.ts (4KB)
  spanProcessor.ts (2KB)
  spatialMapper.ts (3KB)
  speculativeExecutionEngine.ts (2KB)
  speechRecognizer.ts (2KB)
  spikePlasticityEngine.ts (5KB)
  spikingNetworkSimulator.ts (3KB)
  spikingNeuron.ts (2KB)
  srilEngine.ts (3KB)
  stakeholderReporting.ts (12KB)
  stigmergyEngine.ts (2KB)
  storage.test.ts (1KB)
  storage.ts (3KB)
  streamIntegrityMonitor.test.ts (1KB)
  streamIntegrityMonitor.ts (10KB)
  streamRouter.test.ts (1KB)
  streamRouter.ts (6KB)
  streamingDashboard.ts (1KB)
  subAgentMarketplace.ts (4KB)
  subAgentSpawner.ts (6KB)
  subtitleAligner.ts (2KB)
  supplyChainAuditor.ts (4KB)
  swarmCoordinator.ts (2KB)
  swarmOrchestrator.test.ts (8KB)
  swarmOrchestrator.ts (13KB)
  swarmParticleOptimizer.ts (3KB)
  swarmSpecialistVoting.test.ts (4KB)
  swarmSpecialistVoting.ts (14KB)
  swarmTestnet.test.ts (14KB)
  swarmTestnet.ts (13KB)
  sweBenchHarness.test.ts (1KB)
  sweBenchHarness.ts (2KB)
  symbolMapper.ts (3KB)
  symbolicExecutor.test.ts (6KB)
  symbolicExecutor.ts (13KB)
  synapticWeightManager.ts (3KB)
  syntaxHighlighter.ts (3KB)
  systemHealthMonitor.ts (3KB)
  systemIntegrator.ts (4KB)
  systemMemory.test.ts (3KB)
  systemMemory.ts (12KB)
  taskBroker.ts (3KB)
  taskDecomposer.test.ts (9KB)
  taskDecomposer.ts (19KB)
  taskDecomposerV44.ts (3KB)
  taskPlanner.test.ts (5KB)
  taskPlanner.ts (15KB)
  taskScheduler.ts (3KB)
  telemetry.test.ts (2KB)
  telemetry.ts (12KB)
  temporalAbstractionEngine.ts (6KB)
  temporalCaptioner.ts (3KB)
  temporalConsistencyChecker.ts (4KB)
  temporalKnowledgeDistillation.ts (7KB)
  temporalPatternDetector.ts (2KB)
  temporalReasoningEngine.ts (4KB)
  temporalSelfModel.ts (2KB)
  tenantManager.test.ts (2KB)
  tenantManager.ts (12KB)
  testCoverageAnalyzer.test.ts (2KB)
  testCoverageAnalyzer.ts (10KB)
  testGenerator.test.ts (3KB)
  testGenerator.ts (23KB)
  threatDetector.ts (2KB)
  throughputMaximizer.ts (3KB)
  tieredContextManager.test.ts (5KB)
  tieredContextManager.ts (18KB)
  timeSeriesForecaster.ts (4KB)
  timeSeriesStore.ts (2KB)
  tokenBudgetManager.test.ts (7KB)
  tokenBudgetManager.ts (14KB)
  toolSynthesis.test.ts (3KB)
  toolSynthesis.ts (10KB)
  toolSynthesizer.ts (3KB)
  toolUseOrchestrator.ts (2KB)
  traceCollector.ts (2KB)
  traceCorrelator.ts (2KB)
  traceExporter.ts (2KB)
  traceQueryEngine.ts (2KB)
  traceSampler.ts (3KB)
  transactionLog.test.ts (3KB)
  transactionLog.ts (7KB)
  transcendentSelfModel.ts (3KB)
  transferLearner.ts (3KB)
  transferLearningBroker.ts (5KB)
  transferOptimizer.ts (2KB)
  trendExtractor.ts (3KB)
  truncationDetector.test.ts (3KB)
  truncationDetector.ts (20KB)
  trustBuilder.ts (2KB)
  tsHealEngine.ts (16KB)
  twoPhaseCommit.test.ts (2KB)
  twoPhaseCommit.ts (23KB)
  uncertaintyPropagator.ts (1KB)
  unifiedKnowledge.test.ts (2KB)
  unifiedKnowledge.ts (12KB)
  universalAgentInterface.ts (3KB)
  universalReasoningEngine.ts (3KB)
  unsupervisedCodebaseDiscovery.ts (4KB)
  utilityFunction.test.ts (12KB)
  utilityFunction.ts (17KB)
  v100.test.ts (10KB)
  v13.test.ts (14KB)
  v13_v15_coverage.test.ts (14KB)
  v14.test.ts (10KB)
  v15.test.ts (1KB)
  v16.test.ts (11KB)
  v17.test.ts (9KB)
  v18.test.ts (16KB)
  v19.test.ts (13KB)
  v20.test.ts (7KB)
  v21.test.ts (7KB)
  v22.test.ts (8KB)
  v23.test.ts (7KB)
  v24.test.ts (5KB)
  v25.test.ts (5KB)
  v26.test.ts (6KB)
  v27.test.ts (6KB)
  v28.test.ts (4KB)
  v29.test.ts (4KB)
  v30.test.ts (9KB)
  v31.test.ts (12KB)
  v32.test.ts (14KB)
  v33.test.ts (14KB)
  v34.test.ts (14KB)
  v35.test.ts (14KB)
  v36.test.ts (14KB)
  v37.test.ts (14KB)
  v38.test.ts (13KB)
  v39.test.ts (11KB)
  v40.test.ts (11KB)
  v41.test.ts (9KB)
  v42.test.ts (10KB)
  v43.test.ts (10KB)
  v44.test.ts (11KB)
  v45.test.ts (10KB)
  v46.test.ts (12KB)
  v47.test.ts (12KB)
  v48.test.ts (10KB)
  v49.test.ts (10KB)
  v50.test.ts (10KB)
  v51.test.ts (10KB)
  v52.test.ts (10KB)
  v53.test.ts (10KB)
  v54.test.ts (11KB)
  v55.test.ts (12KB)
  v56.test.ts (11KB)
  v57.test.ts (8KB)
  v58.test.ts (6KB)
  v59.test.ts (6KB)
  v60.test.ts (6KB)
  v61.test.ts (5KB)
  v62.test.ts (6KB)
  v63.test.ts (7KB)
  v64.test.ts (7KB)
  v65.test.ts (8KB)
  v66.test.ts (7KB)
  v67.test.ts (7KB)
  v68.test.ts (7KB)
  v69.test.ts (6KB)
  v70.test.ts (6KB)
  v71.test.ts (6KB)
  v72.test.ts (14KB)
  v73.test.ts (13KB)
  v74.test.ts (12KB)
  v75.test.ts (13KB)
  v76.test.ts (11KB)
  v77.test.ts (12KB)
  v78.test.ts (12KB)
  v79.test.ts (13KB)
  v80.test.ts (11KB)
  v81.test.ts (11KB)
  v82.test.ts (12KB)
  v83.test.ts (11KB)
  v84.test.ts (11KB)
  v85.test.ts (12KB)
  v86.test.ts (11KB)
  v87.test.ts (11KB)
  v88.test.ts (12KB)
  v89.test.ts (12KB)
  v90.test.ts (11KB)
  v91.test.ts (12KB)
  v92.test.ts (10KB)
  v93.test.ts (10KB)
  v94.test.ts (9KB)
  v95.test.ts (10KB)
  v96.test.ts (9KB)
  v97.test.ts (7KB)
  v98.test.ts (9KB)
  v99.test.ts (8KB)
  valueAlignmentMonitor.ts (3KB)
  valuePreservation.ts (4KB)
  vectorMemory.test.ts (8KB)
  vectorMemory.ts (14KB)
  videoFrameAnalyzer.ts (2KB)
  videoSummarizer.ts (3KB)
  visionContextEnricher.test.ts (5KB)
  visionContextEnricher.ts (11KB)
  visionModule.test.ts (3KB)
  visionModule.ts (8KB)
  visionProcessor.ts (2KB)
  visualGrounding.test.ts (4KB)
  visualGrounding.ts (11KB)
  visualRegressionGuard.ts (15KB)
  vitest.setup.test.ts (1KB)
  vitest.setup.ts (5KB)
  voiceInterface.test.ts (4KB)
  voiceInterface.ts (7KB)
  vulnerabilityAdvisor.ts (3KB)
  watchdog.test.ts (1KB)
  watchdog.ts (19KB)
  webBrowsingEngine.ts (2KB)
  webhookManager.ts (3KB)
  workflowEngine.ts (3KB)
  workflowMonitor.ts (4KB)
  workingMemory.ts (3KB)
  workingMemoryBuffer.ts (2KB)
  workspace.test.ts (3KB)
  workspace.ts (13KB)
  z3ProofLayer.test.ts (2KB)
  z3ProofLayer.ts (4KB)
  zeroShotTransferEngine.test.ts (3KB)
  zeroShotTransferEngine.ts (13KB)
  zipEdit.test.ts (1KB)
  zkProofSigning.test.ts (9KB)
  zkProofSigning.ts (11KB)
  tools/advancedFileOps.test.ts (1KB)
  tools/advancedFileOps.ts (24KB)
  tools/agentControl.test.ts (1KB)
  tools/agentControl.ts (5KB)
  tools/agentMemory.test.ts (1KB)
  tools/agentMemory.ts (7KB)
  tools/atomicModifyTools.test.ts (1KB)
  tools/atomicModifyTools.ts (18KB)
  tools/bashExecute.test.ts (1KB)
  tools/bashExecute.ts (4KB)
  tools/browserAutomation.test.ts (1KB)
  tools/browserAutomation.ts (23KB)
  tools/browserTools.test.ts (1KB)
  tools/browserTools.ts (9KB)
  tools/dockerSandbox.test.ts (1KB)
  tools/dockerSandbox.ts (19KB)
  tools/fileOps.test.ts (1KB)
  tools/fileOps.ts (18KB)
  tools/gitOps.test.ts (1KB)
  tools/gitOps.ts (8KB)
  tools/index.test.ts (1KB)
  tools/index.ts (2KB)
  tools/pythonExecute.test.ts (1KB)
  tools/pythonExecute.ts (4KB)
  tools/selfAwareness.test.ts (1KB)
  tools/selfAwareness.ts (20KB)
  tools/selfChunkedWriteTool.test.ts (7KB)
  tools/selfChunkedWriteTool.ts (15KB)
  tools/selfDiagnoseTools.test.ts (1KB)
  tools/selfDiagnoseTools.ts (35KB)
  tools/selfDiffReadTool.test.ts (5KB)
  tools/selfDiffReadTool.ts (10KB)
  tools/selfImprovementTools.test.ts (1KB)
  tools/selfImprovementTools.ts (15KB)
  tools/selfModifyHelpers.test.ts (3KB)
  tools/selfModifyHelpers.ts (4KB)
  tools/selfModifyTools.test.ts (1KB)
  tools/selfModifyTools.ts (1KB)
  tools/selfPatchFileTool.test.ts (6KB)
  tools/selfPatchFileTool.ts (9KB)
  tools/selfRunTestsTool.test.ts (6KB)
  tools/selfRunTestsTool.ts (8KB)
  tools/selfTestRunner.test.ts (1KB)
  tools/selfTestRunner.ts (19KB)
  tools/selfWriteFileTool.test.ts (7KB)
  tools/selfWriteFileTool.ts (8KB)
  tools/spawnSubAgent.test.ts (1KB)
  tools/spawnSubAgent.ts (8KB)
  tools/toolRegistry.test.ts (1KB)
  tools/toolRegistry.ts (3KB)
  tools/vision.test.ts (1KB)
  tools/vision.ts (14KB)
  tools/visualGroundingTool.test.ts (4KB)
  tools/visualGroundingTool.ts (8KB)
  tools/webBrowse.test.ts (1KB)
  tools/webBrowse.ts (3KB)
  tools/webSearch.test.ts (1KB)
  tools/webSearch.ts (11KB)
```

## ⚠️ MANDATORY: Read This Before Any File Operation

**YOU ARE ANDROMEDA. Your source files are in `server/`, NOT `src/`.**

This is the single most important fact about your file structure. Every time you
try to read `src/anything`, you will get ENOENT (file not found). Use the table below.

### Path Translation Table (src/ → server/)

| ❌ WRONG PATH (will fail) | ✅ CORRECT PATH (use this) |
|---|---|
| `src/engine/response-stream.ts` | `server/llmProvider.ts` |
| `src/server/streaming/response-stream.ts` | `server/llmProvider.ts` |
| `src/server/llm/provider.ts` | `server/llmProvider.ts` |
| `src/server/agent/engine.ts` | `server/reactEngine.ts` |
| `src/engine/stream.ts` | `server/llmProvider.ts` |
| `src/agent/engine.ts` | `server/reactEngine.ts` |
| `src/agent/tools.ts` | `server/tools/index.ts` |
| `src/index.ts` | `server/_core/index.ts` |
| `src/self-improve/index.ts` | `server/selfImprove.ts` |
| `src/self-improve/continuous-improver.ts` | `server/continuousImprover.ts` |
| `src/self-improve/self-heal.ts` | `server/selfHeal.ts` |
| `src/self-improve/self-monitor.ts` | `server/selfMonitor.ts` |
| `src/self-improve/recursion-guard.ts` | `server/recursionGuard.ts` |
| `src/self-improve/hot-reload.ts` | `server/hotReload.ts` |
| `src/self-improve/autonomy-orchestrator.ts` | `server/autonomyOrchestrator.ts` |
| `src/tools/` | `server/tools/` |
| `src/memory/` | `server/memory.ts` |
| `src/monitoring/` | `server/selfMonitor.ts` |
| `src/llm/provider.ts` | `server/llmProvider.ts` |
| `src/llm/stream.ts` | `server/llmProvider.ts` |
| `src/constitution.ts` | `server/safetySupervisor.ts` |
| `src/db/` | `server/db/` |

**Rule: If you want to read a file, ALWAYS use `self_read_server_file` with just the filename
(e.g., `self_read_server_file("llmProvider.ts")`) — it resolves automatically from server/.**

**STOP if you get ENOENT twice on the same path — the file does not exist. Use `bash_execute`
with `find server/ -name "*.ts" | head -50` to discover the real file tree.**


## Andromeda Architecture

### Entry Point
- `server/_core/index.ts` — Express server, startup, all daemon initialization

### Core Engine
- `server/reactEngine.ts` — Main ReAct agent loop (think → tool → observe → repeat)
- `server/ai.ts` — LLM API calls, system prompt builder, token counting
- `server/llmProvider.ts` — Streaming completion, finish_reason:length continuation (v5.77: also detects finish_reason:stop-but-truncated via detectOutputTruncation, 32768 tokens, tool-arg repair, 5 continuations)
- `server/streamRouter.ts` — HTTP streaming endpoint, tool dispatch

### Self-Modification Pipeline
- `server/twoPhaseCommit.ts` — Atomic file write with git snapshot + SHA-256 verify + rollback + truncation detection
- `server/tools/selfModifyTools.ts` — self_write_file, self_patch_file, self_read_server_file, self_restart
- `server/safetySupervisor.ts` — Constitution enforcement, validates proposals before applying
- `server/selfRollback.ts` — Automatic rollback on degradation
- `server/rsiEngine.ts` — RSI (Recursive Self-Improvement) orchestrator with 8-phase OODA cycle

### Memory & Knowledge
- `server/memory.ts` — Store/retrieve memories (SQLite-backed, cross-session episodic memory)
- `server/tieredContextManager.ts` — Context window management, compression
- `server/unifiedKnowledge.ts` — Cross-module knowledge retrieval

### Self-Awareness
- `server/tools/selfAwareness.ts` — get_own_capabilities, list_codebase_files, run_self_diagnosis, get_system_context
- `server/tools/selfDiagnoseTools.ts` — self_diagnose, self_review, self_benchmark, self_generate_tests
- `server/selfMonitor.ts` — Performance metrics, error rate tracking
- `server/selfHeal.ts` — Proactive health monitoring and auto-repair
- `server/identityManifest.ts` — Identity continuity verification

### Autonomy Daemons
- `server/continuousImprover.ts` — Periodic self-improvement proposals
- `server/autonomyOrchestrator.ts` — Orchestrates improvement cycles
- `server/codebaseAnalyzer.ts` — Code quality analysis
- `server/selfReflectionEngine.ts` — Periodic self-reflection

### Tools Directory (`server/tools/`)
- `fileOps.ts` — read_file, write_file, list_directory, str_replace, read_file_range
- `advancedFileOps.ts` — edit_file, append_file, search_files, move_file, read_file_lines, project_context, tree_view, delete_file
- `selfModifyTools.ts` — self_write_file, self_patch_file, self_read_server_file, self_restart, self_write_file_chunked, self_diff, verify_file_integrity
- `selfAwareness.ts` — get_own_capabilities, run_self_diagnosis, get_system_context, list_codebase_files
- `selfDiagnoseTools.ts` — self_diagnose, self_review, self_benchmark, self_generate_tests
- `selfTestRunner.ts` — run_self_tests, run_type_check, self_heal
- `atomicModifyTools.ts` — self_atomic_modify
- `agentMemory.ts` — store_memory, recall_memory, list_memories
- `agentControl.ts` — ask_human, terminate, create_plan
- `bashExecute.ts` — bash_execute
- `pythonExecute.ts` — python_execute
- `webSearch.ts` — web_search
- `webBrowse.ts` — web_browse
- `gitOps.ts` — git_operations
- `browserAutomation.ts` — browser_navigate, browser_click, browser_type, browser_scroll, browser_extract, browser_execute_js, browser_wait
- `vision.ts` — screenshot, analyze_image, visual_verify
- `dockerSandbox.ts` — sandbox_execute

## Real Server Source Tree (server/)
```
server/
├── _core/
│   ├── context.test.ts
│   ├── context.ts
│   ├── cookies.test.ts
│   ├── cookies.ts
│   ├── dataApi.test.ts
│   ├── dataApi.ts
│   ├── env.test.ts
│   ├── env.ts
│   ├── imageGeneration.test.ts
│   ├── imageGeneration.ts
│   ├── index.test.ts
│   ├── index.ts
│   ├── initDaemons.test.ts
│   ├── initDaemons.ts
│   ├── initModules.test.ts
│   ├── initModules.ts
│   ├── initRoutes.test.ts
│   ├── initRoutes.ts
│   ├── initSafety.test.ts
│   ├── initSafety.ts
│   ├── llm.test.ts
│   ├── llm.ts
│   ├── map.test.ts
│   ├── map.ts
│   ├── notification.test.ts
│   ├── notification.ts
│   ├── oauth.test.ts
│   ├── oauth.ts
│   ├── safeJsonParse.ts
│   ├── sdk.test.ts
│   ├── sdk.ts
│   ├── systemRouter.test.ts
│   ├── systemRouter.ts
│   ├── trpc.test.ts
│   ├── trpc.ts
│   ├── types/
│   │   ├── cookie.d.ts
│   │   └── manusTypes.ts
│   ├── videoGeneration.test.ts
│   ├── videoGeneration.ts
│   ├── vite.test.ts
│   ├── vite.ts
│   ├── voiceTranscription.test.ts
│   └── voiceTranscription.ts
├── abTestingEngine.ts
├── abTestingFramework.ts
├── abductiveHypothesisEngine.ts
├── accessControlManager.ts
├── actionExecutor.ts
├── actionSpacePlanner.ts
├── activationPatternAnalyzer.ts
├── adaptiveBatchScheduler.ts
├── adaptiveEval.test.ts
├── adaptiveEval.ts
├── adaptiveExplorationController.ts
├── adaptiveGoalHierarchy.ts
├── adaptiveLearner.ts
├── adaptivePartitions.test.ts
├── adaptivePartitions.ts
├── adaptiveRouter.test.ts
├── adaptiveRouter.ts
├── adaptiveSelfConsistency.ts
├── adminAuth.test.ts
├── adminAuth.ts
├── advancedCache.test.ts
├── advancedCache.ts
├── adversarial.test.ts
├── adversarialRedTeam.ts
├── adversarialSelfPlay.ts
├── adversarialTestGen.test.ts
├── adversarialTestGen.ts
├── agentAuditLogger.ts
├── agentBidder.ts
├── agentCapabilityNegotiator.ts
├── agentCapabilityRegistry.ts
├── agentCollectiveIntelligence.ts
├── agentCommunicationBus.ts
├── agentCoordinator.ts
├── agentEconomyMonitor.ts
├── agentEconomyOptimizer.ts
├── agentElectionProtocol.ts
├── agentEmergenceDetectorV50.ts
├── agentEthicsEnforcer.ts
├── agentEvolutionTracker.ts
├── agentFaultTolerance.ts
├── agentGoalAlignment.ts
├── agentKnowledgeSharer.ts
├── agentLifecycleManager.ts
├── agentLoadBalancer.ts
├── agentMemoryBroker.ts
├── agentMessageBus.ts
├── agentOrchestrationEngine.ts
├── agentOrchestrator.test.ts
├── agentOrchestrator.ts
├── agentPerformanceProfiler.ts
├── agentRegistry.ts
├── agentReputationLedger.ts
├── agentRollbackManager.ts
├── agentSecuritySandbox.ts
├── agentSelfHealer.ts
├── agentSpawnController.ts
├── agentSpecializationEngine.ts
├── agentStateMachine.test.ts
├── agentStateMachine.ts
├── agentStateSync.ts
├── agentSystemPrompt.test.ts
├── agentSystemPrompt.ts
├── agentTaskDelegator.ts
├── agentTypes.test.ts
├── agentTypes.ts
├── agentVersionControl.ts
├── ai.test.ts
├── ai.ts
├── aiBootstrapper.ts
├── aiChangelog.test.ts
├── aiChangelog.ts
├── aiMemory.test.ts
├── aiMemory.ts
├── aiPlanning.test.ts
├── aiPlanning.ts
├── aiPrompts.test.ts
├── aiPrompts.ts
├── aiStreaming.test.ts
├── aiStreaming.ts
├── aiTokens.test.ts
├── aiTokens.ts
├── aiZipEdit.test.ts
├── aiZipEdit.ts
├── alertingEngine.ts
├── algorithmicDiscovery.test.ts
├── algorithmicDiscovery.ts
├── algorithmicDiscoveryV2.test.ts
├── algorithmicDiscoveryV2.ts
├── alignmentMonitor.ts
├── analogicalReasoningBridge.ts
├── analogyEngine.ts
├── andromedaBootstrapper.ts
├── andromedaCore.ts
├── andromedaDaemon.test.ts
├── andromedaDaemon.ts
├── andromedaDb.test.ts
├── andromedaDb.ts
├── andromedaMemoryWriter.test.ts
├── andromedaMemoryWriter.ts
├── annealingScheduler.ts
├── anomalyDetectionEngine.ts
├── anomalyDetector.ts
├── anomalyIsolator.ts
├── anonymizationPipeline.ts
├── apexIntegrationOrchestrator.ts
├── apiAuthManager.ts
├── apiCachingLayer.ts
├── apiChangeDetector.ts
├── apiCircuitBreaker.ts
├── apiClientGenerator.ts
├── apiCompositionPlanner.ts
├── apiCostOptimizer.ts
├── apiDataTransformer.ts
├── apiDependencyMapper.ts
├── apiDeploymentAutomator.ts
├── apiDocumentationParser.ts
├── apiErrorRecovery.ts
├── apiGateway.ts
├── apiHealthMonitor.ts
├── apiIntegrationTester.ts
├── apiKnowledgeBase.ts
├── apiMigrationEngine.ts
├── apiMonitoringDashboard.ts
├── apiPerformanceBenchmarker.ts
├── apiRateLimiter.ts
├── apiRecommendationEngine.ts
├── apiSchemaInferrer.ts
├── apiSecurityAuditor.ts
├── apiSelfHealingProxy.ts
├── apiVersionAdapter.ts
├── apiVersionRouter.ts
├── apiWorkflowComposer.ts
├── architectureEvolver.ts
├── arxivSubmitter.ts
├── astContextInjector.ts
├── astDiff.test.ts
├── astDiff.ts
├── astKnowledgeGraph.test.ts
├── astKnowledgeGraph.ts
├── astMutator.test.ts
├── astMutator.ts
├── attentionMechanism.ts
├── audioAnalyzer.ts
├── auditLog.test.ts
├── auditLog.ts
├── auditTrailEnforcer.ts
├── auth.logout.test.ts
├── autoGoalSuggester.test.ts
├── autoGoalSuggester.ts
├── autoHealing.test.ts
├── autoHealing.ts
├── autoRebuild.test.ts
├── autoRebuild.ts
├── autonomousCodeReviewer.ts
├── autonomousDeployment.ts
├── autonomousDocSynthesizer.ts
├── autonomousGoalGenerator.test.ts
├── autonomousGoalGenerator.ts
├── autonomyOrchestrator.test.ts
├── autonomyOrchestrator.ts
├── bayesianOptimizer.ts
├── behavioralRegressionEngine.test.ts
├── behavioralRegressionEngine.ts
├── benchmarkRegressionSuite.ts
├── benchmarkRunner.test.ts
├── benchmarkRunner.ts
├── benchmarkSynthesizer.ts
├── biasDetector.test.ts
├── biasDetector.ts
├── billingReporter.ts
├── bottleneckDetector.ts
├── brave.test.ts
├── breakthroughDetector.ts
├── browser.test.ts
├── browser.ts
├── budgetAlertEngine.ts
├── cache.test.ts
├── cache.ts
├── canaryDeployer.ts
├── capabilityBootstrapper.test.ts
├── capabilityBootstrapper.ts
├── capabilityDiscovery.test.ts
├── capabilityDiscovery.ts
├── capabilityExtrapolator.ts
├── capabilityOrchestrator.ts
├── capabilitySynthesisEngine.ts
├── causalChainTracer.ts
├── causalDiscovery.ts
├── causalGraph.ts
├── causalIntervention.ts
├── causalReasoning.test.ts
├── causalReasoning.ts
├── causalReasoningEngine.ts
├── causalWorldModel.ts
├── chaosEngineer.ts
├── chartUnderstander.ts
├── ciPipeline.test.ts
├── ciPipeline.ts
├── ciRegressionGuard.test.ts
├── ciRegressionGuard.ts
├── circuitBreaker.test.ts
├── circuitBreaker.ts
├── circuitBreaker.v12.test.ts
├── circuitBreakerV68.ts
├── cloudProvisioning.test.ts
├── cloudProvisioning.ts
├── cloudSpendAnalyzer.ts
├── codeComplexityAnalyzer.ts
├── codeExecutionSandbox.ts
├── codeFormatterEngine.ts
├── codeIntel.test.ts
├── codeIntel.ts
├── codeParser.ts
├── codeQualityMonitor.test.ts
├── codeQualityMonitor.ts
├── codeQualityOracle.ts
├── codeRewriter.ts
├── codeRunner.test.ts
├── codeRunner.ts
├── codeSearchIndexer.ts
├── codebaseAnalyzer.test.ts
├── codebaseAnalyzer.ts
├── cognitiveController.ts
├── cognitiveLoadBalancer.ts
├── collaborationEngine.ts
├── collaborativeFilteringEngine.ts
├── collectiveDecisionMaker.ts
├── collisionDetector.ts
├── communicationProtocol.ts
├── communicationStyleAdapter.ts
├── computeAuctioneer.ts
├── computeBudgetManager.ts
├── computeEconomyManager.ts
├── conceptDriftHandler.ts
├── conceptMapper.ts
├── configManager.ts
├── conflictMediationEngine.ts
├── conflictResolver.ts
├── confoundingDetector.ts
├── consciousnessStateTracker.ts
├── consensusConfig.ts
├── consensusEngine.test.ts
├── consensusEngine.ts
├── consensusNegotiator.ts
├── consentManager.ts
├── constitutionalAI.ts
├── constitutionalAmendment.ts
├── constitutionalConstraints.test.ts
├── constitutionalConstraints.ts
├── constitutionalGuard.ts
├── constraintSolver.ts
├── contextAwareness.test.ts
├── contextAwareness.ts
├── contextBus.test.ts
├── contextBus.ts
├── contextCompressionDaemon.test.ts
├── contextCompressionDaemon.ts
├── contextManager.test.ts
├── contextManager.ts
├── contextPropagator.ts
├── contextualResponder.ts
├── continualLearner.ts
├── continuousFineTuner.ts
├── continuousFineTuning.test.ts
├── continuousFineTuning.ts
├── continuousImprover.test.ts
├── continuousImprover.ts
├── corrigibilityEngine.ts
├── corrigibilityManager.ts
├── costAllocationEngine.ts
├── costEstimator.ts
├── costOptimizer.test.ts
├── costOptimizer.ts
├── costTracker.ts
├── counterfactualGenerator.ts
├── counterfactualReasoner.ts
├── counterfactualSimulator.ts
├── criticEngine.ts
├── criticalPath.test.ts
├── cronExpressionParser.ts
├── crossDomainAdapter.test.ts
├── crossDomainAdapter.ts
├── crossInstanceRlhf.test.ts
├── crossInstanceRlhf.ts
├── crossModalRetriever.ts
├── crossModalSelfImprovement.test.ts
├── crossModalSelfImprovement.ts
├── crossProposalConflictDetector.test.ts
├── crossProposalConflictDetector.ts
├── crossRepoRsi.ts
├── crossSystemNegotiation.ts
├── crowdWisdomAggregator.ts
├── cryptographicVerifier.ts
├── curriculumDesigner.ts
├── dataCatalog.ts
├── dataLineageTracker.ts
├── dataPipelineEngine.ts
├── dataQualityMonitor.ts
├── dataRetentionPolicy.ts
├── dataTransformRegistry.ts
├── dataValidator.ts
├── db.test.ts
├── db.ts
├── dbPostgres.test.ts
├── dbPostgres.ts
├── deadCodeDetector.ts
├── deadLetterQueue.ts
├── decisionExplainer.ts
├── deductiveReasoningChain.ts
├── deepseek.test.ts
├── depGraphOptimizer.ts
├── dependencyAuditor.test.ts
├── dependencyAuditor.ts
├── dependencyGraph.test.ts
├── dependencyGraph.ts
├── dependencyGraphAnalyzer.ts
├── dependencyOptimizer.ts
├── dependencyResolver.test.ts
├── dependencyResolver.ts
├── dependencyScanner.ts
├── dependencyUpdateRsi.ts
├── diagramInterpreter.ts
├── dialecticalDebateEngine.ts
├── dialogueManager.ts
├── discourseManager.ts
├── distributedConsensus.ts
├── distributedProofConsensus.test.ts
├── distributedProofConsensus.ts
├── distributionShiftDetector.ts
├── doCalculus.ts
├── docGenerator.test.ts
├── docGenerator.ts
├── dockerSandbox.test.ts
├── dockerSandbox.ts
├── documentClassifier.ts
├── documentIndexer.ts
├── documentParser.ts
├── documentSearchEngine.ts
├── documentSummarizer.ts
├── documentTemplateEngine.ts
├── documentVersionManager.ts
├── domainAdaptationEngine.ts
├── domainBridger.ts
├── dynamicModelRouter.ts
├── dynamicModelWeights.ts
├── dynamicTestGen.test.ts
├── dynamicTestGen.ts
├── ebpfGrounding.test.ts
├── ebpfGrounding.ts
├── edgeLLMRouter.test.ts
├── edgeLLMRouter.ts
├── embodiedAgent.ts
├── emergenceDetector.ts
├── emergentAbstractionEngine.ts
├── emergentBehaviorDetector.ts
├── emergentFineTuner.ts
├── emergentGoalSynthesis.ts
├── emergentLanguageProtocol.ts
├── emergentSpecialization.ts
├── energyProfiler.ts
├── entityLinker.ts
├── environmentModel.ts
├── environmentModeler.ts
├── environmentPerceiver.ts
├── environmentalAdaptor.ts
├── episodicConsolidation.test.ts
├── episodicConsolidation.ts
├── episodicConsolidationV2.ts
├── episodicMemory.test.ts
├── episodicMemory.ts
├── episodicMemoryStore.ts
├── epistemicBeliefModel.test.ts
├── epistemicBeliefModel.ts
├── epistemicUncertaintyQuantifier.ts
├── errorBudgetMonitor.ts
├── ethicsAuditor.ts
├── ethicsEngine.ts
├── evalDrivenTargeting.test.ts
├── evalDrivenTargeting.ts
├── evalFramework.test.ts
├── evalFramework.ts
├── evalGoalDiscovery.test.ts
├── evalGoalDiscovery.ts
├── evalSeed.test.ts
├── evalSeed.ts
├── eventBus.ts
├── eventDrivenTrigger.ts
├── eventSequencer.ts
├── evolutionaryOptimizer.ts
├── evolutionarySearch.test.ts
├── evolutionarySearch.ts
├── executionMonitor.ts
├── experimentDesigner.ts
├── experimentTracker.ts
├── explanationReporter.ts
├── externalBenchmarkGate.ts
├── externalRepoFixer.ts
├── failurePatternMemory.test.ts
├── failurePatternMemory.ts
├── fairnessAuditor.ts
├── featureAuditLog.ts
├── featureFlagManager.ts
├── featureImportanceAnalyzer.ts
├── federatedKnowledgeGraph.ts
├── federatedLearning.test.ts
├── federatedLearning.ts
├── federatedLearningCoordinator.ts
├── federatedLoraSharing.test.ts
├── federatedLoraSharing.ts
├── federatedRLHF.test.ts
├── federatedRLHF.ts
├── federatedRsiNetwork.test.ts
├── federatedRsiNetwork.ts
├── fewShotLearner.ts
├── fileEngine.test.ts
├── fileEngine.ts
├── fileEngineAnalysis.test.ts
├── fileEngineAnalysis.ts
├── fileEngineChunking.test.ts
├── fileEngineChunking.ts
├── fileEngineTypes.test.ts
├── fileEngineTypes.ts
├── fileEngineUtils.test.ts
├── fileEngineUtils.ts
├── fileIOManager.ts
├── fineTunerActivation.ts
├── fitnessLandscapeMapper.ts
├── forecastEngine.ts
├── forgettingCurveManager.ts
├── formalVerification.test.ts
├── formalVerification.ts
├── formalVerificationEngine.ts
├── formalVerifier.ts
├── fsWatcher.test.ts
├── fsWatcher.ts
├── futureStatePredictor.ts
├── fuzz.test.ts
├── gameStateManager.ts
├── gdprComplianceChecker.ts
├── genealogyGuidedGeneration.ts
├── gitSandbox.test.ts
├── gitSandbox.ts
├── globalOptimizer.ts
├── goalConditionedRsi.ts
├── goalDecomposer.test.ts
├── goalDecomposer.ts
├── goalManager.test.ts
├── goalManager.ts
├── governanceConstitution.ts
├── gracefulDegradation.test.ts
├── gracefulDegradation.ts
├── gradientDescentOptimizer.ts
├── gradientFlowMonitor.ts
├── grandUnificationMonitor.ts
├── graphQueryEngine.ts
├── groundedDialogManager.ts
├── grounding.test.ts
├── grounding.ts
├── guardPipeline.integration.test.ts
├── harmPreventionFilter.ts
├── hebbianLearner.ts
├── hierarchicalPlanner.ts
├── historicalPatternMiner.ts
├── hotReload.test.ts
├── hotReload.ts
├── httpClientManager.ts
├── humanInTheLoop.ts
├── humanInTheLoopGate.test.ts
├── humanInTheLoopGate.ts
├── hybridCostRouter.test.ts
├── hybridCostRouter.ts
├── hyperparameterTuner.ts
├── hypothesisEngine.ts
├── hypothesisGenerator.ts
├── identityManifest.test.ts
├── identityManifest.ts
├── imageCaptioner.ts
├── importGraph.test.ts
├── importGraph.ts
├── incidentManager.ts
├── incrementalAstInvalidator.test.ts
├── incrementalAstInvalidator.ts
├── inductivePatternSynthesizer.ts
├── inferenceEngine.ts
├── infiniteContextSummarizer.ts
├── infiniteHorizonPlanner.ts
├── infiniteRecursionGuard.ts
├── intentParser.ts
├── intentionalityEngine.ts
├── interfaceNegotiator.ts
├── interventionEngine.ts
├── jobQueue.ts
├── knowledgeBaseConsolidation.test.ts
├── knowledgeBaseConsolidation.ts
├── knowledgeBaseManager.ts
├── knowledgeFusion.ts
├── knowledgeGraph.ts
├── knowledgeGraphBuilder.ts
├── knowledgeSynchronizer.ts
├── knowledgeTransfer.test.ts
├── knowledgeTransfer.ts
├── languageGrounder.ts
├── latencyPredictor.ts
├── layerFusionOptimizer.ts
├── learnedConstraints.test.ts
├── learnedConstraints.ts
├── licenseChecker.ts
├── llmCallCache.ts
├── llmProvider.test.ts
├── llmProvider.ts
├── llmRouter.test.ts
├── llmRouter.ts
├── localLora.test.ts
├── localLora.ts
├── logAnalyzer.ts
├── logger.test.ts
├── logger.ts
├── longRangePlanner.ts
├── longTermForecaster.ts
├── longTermMemoryConsolidation.test.ts
├── longTermMemoryConsolidation.ts
├── loraBackendDetector.test.ts
├── loraBackendDetector.ts
├── loraDpoPipeline.test.ts
├── loraDpoPipeline.ts
├── madDebate.test.ts
├── madDebate.ts
├── manifest.test.ts
├── manifest.ts
├── mcpClient.test.ts
├── mcpClient.ts
├── mctsHealEngine.test.ts
├── mctsHealEngine.ts
├── mctsPlan.test.ts
├── mctsPlan.ts
├── mctsPlanningEngine.test.ts
├── mctsPlanningEngine.ts
├── memory.test.ts
├── memory.ts
├── memoryConsolidation.test.ts
├── memoryConsolidation.ts
├── memoryConsolidator.ts
├── memoryForgettingCurve.test.ts
├── memoryForgettingCurve.ts
├── memoryIndexer.ts
├── memoryOptimizer.ts
├── memoryRetrievalOptimizer.ts
├── metaCognitiveEngine.ts
├── metaLearner.ts
├── metaMetaRsi.ts
├── metaRewardShaper.ts
├── metaRsiAgent.ts
├── metacognitionEngine.ts
├── metricsAggregator.ts
├── modalityRouter.ts
├── modelRegistry.test.ts
├── modelRegistry.ts
├── moduleComposer.ts
├── moePromptRouter.ts
├── monteCarloPlanner.ts
├── motionEventDetector.ts
├── motorSkillLibrary.ts
├── movingAverageCalculator.ts
├── multiAgent.test.ts
├── multiAgent.ts
├── multiAgentBus.test.ts
├── multiAgentBus.ts
├── multiAgentCoordinator.ts
├── multiAgentDebate.ts
├── multiAgentImprover.test.ts
├── multiAgentImprover.ts
├── multiFileProposalPlanner.test.ts
├── multiFileProposalPlanner.ts
├── multiModalCodeReader.ts
├── multiModalExecutionVerifier.ts
├── multiObjectiveOptimizer.ts
├── multimodalEncoder.ts
├── multimodalFusion.ts
├── nasEngine.ts
├── nativeVlm.test.ts
├── nativeVlm.ts
├── naturalLanguageGenerator.ts
├── neuralPopulationCoder.ts
├── neuralPruningEngine.ts
├── neuralTopologyOptimizer.ts
├── neuromorphicMemory.ts
├── neuroplasticAdapter.ts
├── notificationManager.ts
├── noveltySearchEngine.test.ts
├── noveltySearchEngine.ts
├── ntdlMemory.ts
├── objectTracker.ts
├── objectiveTracker.ts
├── observability.test.ts
├── observability.ts
├── observabilityDashboard.ts
├── ocrEngine.ts
├── ollamaAutoSetup.test.ts
├── ollamaAutoSetup.ts
├── omegaConvergenceDetector.ts
├── omegaConvergenceMonitor.ts
├── omegaStateManager.ts
├── omniscientContextManager.ts
├── oncallRouter.ts
├── onlineLearner.ts
├── onlineLearningController.ts
├── onlineRewardDistiller.ts
├── ontologicalModel.test.ts
├── ontologicalModel.ts
├── ontologyManager.ts
├── optimalityTracker.ts
├── optimizationEnsembler.ts
├── optimizationSuggester.ts
├── osGrounding.test.ts
├── osGrounding.ts
├── oversightProtocol.ts
├── paperWriter.ts
├── parallelProposalOrchestrator.ts
├── parallelRsi.test.ts
├── parallelRsi.ts
├── paretoOptimizer.ts
├── paretoRewardShaper.ts
├── particleSwarmOptimizer.ts
├── pathPlanner.ts
├── peerReviewNetwork.ts
├── peerReviewSimulator.ts
├── performanceProfiler.ts
├── perpetualLearningEngine.ts
├── perpetualStatePersistence.ts
├── persistentContextStore.test.ts
├── persistentContextStore.ts
├── persistentGlobalMemory.ts
├── pheromoneTrailManager.ts
├── piiRedactor.ts
├── planExecutor.ts
├── planMonitor.ts
├── planReviser.ts
├── pluginManager.ts
├── policyOptimizer.ts
├── polyglotRsi.ts
├── populationEvolver.ts
├── postmortemAnalyzer.ts
├── prGenerator.test.ts
├── prGenerator.ts
├── pragmaticReasoner.ts
├── predictionCalibrator.ts
├── predictionEnsembler.ts
├── predictiveFailurePrevention.ts
├── privacyEngine.ts
├── privilegeSeparation.test.ts
├── privilegeSeparation.ts
├── probabilisticTypeInference.test.ts
├── probabilisticTypeInference.ts
├── proceduralMemory.ts
├── promptEngineer.test.ts
├── promptEngineer.ts
├── proofAssistant.test.ts
├── proofAssistant.ts
├── proofVerifier.test.ts
├── proofVerifier.ts
├── proposalApplier.ts
├── proposalFeedback.test.ts
├── proposalFeedback.ts
├── proposalGenealogy.ts
├── proposalGenerator.ts
├── proposalInvariantVerifier.test.ts
├── proposalInvariantVerifier.ts
├── proposalRanker.ts
├── proposalSandbox.ts
├── proposalValidator.ts
├── qualiaCaptureSystem.ts
├── qualityToRSI.test.ts
├── qualityToRSI.ts
├── quantumInspiredOptimizer.ts
├── queueManager.ts
├── ragContextOptimizer.test.ts
├── ragContextOptimizer.ts
├── ragPipeline.test.ts
├── ragPipeline.ts
├── rateLimitEnforcer.ts
├── rateLimiter.ts
├── rbac.test.ts
├── rbac.ts
├── reactEngine.behavioral.test.ts
├── reactEngine.integration.test.ts
├── reactEngine.test.ts
├── reactEngine.ts
├── realEvalHarness.test.ts
├── realEvalHarness.ts
├── reasoningConfidenceCalibrator.ts
├── recursionGuard.test.ts
├── recursionGuard.ts
├── recursiveGoals.test.ts
├── recursiveGoals.ts
├── recursiveSelfModificationAuditor.ts
├── redisLock.test.ts
├── redisLock.ts
├── refactoringEngine.ts
├── reputationTracker.ts
├── requestValidator.ts
├── researchCollab.ts
├── researchPublisher.ts
├── resourceAuctioneer.ts
├── resourceCostOptimizer.ts
├── responseTransformer.ts
├── resultAnalyzer.ts
├── retryManager.ts
├── retryOrchestrator.ts
├── rewardCalculator.ts
├── rewardCalibrator.ts
├── rewardDistributor.ts
├── rewardModel.test.ts
├── rewardModel.ts
├── rlaifJudge.test.ts
├── rlaifJudge.ts
├── rlhfCollector.test.ts
├── rlhfCollector.ts
├── rlhfPipeline.ts
├── roboticsIoTAdapter.test.ts
├── roboticsIoTAdapter.ts
├── rollbackVerifier.ts
├── rolloutController.ts
├── router.test.ts
├── routers.test.ts
├── routers.ts
├── routes/
│   ├── adaptiveEvalRoutes.test.ts
│   ├── adaptiveEvalRoutes.ts
│   ├── adminRoutes.test.ts
│   ├── adminRoutes.ts
│   ├── agentRoutes.test.ts
│   ├── agentRoutes.ts
│   ├── autonomyRoutes.test.ts
│   ├── autonomyRoutes.ts
│   ├── chatRoutes.test.ts
│   ├── chatRoutes.ts
│   ├── codeRoutes.test.ts
│   ├── codeRoutes.ts
│   ├── editRoutes.test.ts
│   ├── editRoutes.ts
│   ├── evalRoutes.test.ts
│   ├── evalRoutes.ts
│   ├── federatedRoutes.test.ts
│   ├── federatedRoutes.ts
│   ├── godelRoutes.ts
│   ├── llmRoutes.test.ts
│   ├── llmRoutes.ts
│   ├── memoryRoutes.test.ts
│   ├── memoryRoutes.ts
│   ├── searchRoutes.test.ts
│   ├── searchRoutes.ts
│   ├── selfRoutes.test.ts
│   ├── selfRoutes.ts
│   ├── systemRoutes.test.ts
│   ├── systemRoutes.ts
│   ├── terminalRoutes.test.ts
│   ├── terminalRoutes.ts
│   ├── toolMcpRoutes.test.ts
│   ├── toolMcpRoutes.ts
│   ├── v71Routes.test.ts
│   ├── v71Routes.ts
│   ├── v7Routes.test.ts
│   ├── v7Routes.ts
│   ├── validate.test.ts
│   ├── validate.ts
│   ├── workspaceRoutes.test.ts
│   ├── workspaceRoutes.ts
│   ├── zodSchemas.test.ts
│   └── zodSchemas.ts
├── rsi.integration.test.ts
├── rsiDashboard.ts
├── rsiDashboardV2.ts
├── rsiDb.test.ts
├── rsiDb.ts
├── rsiEngine.test.ts
├── rsiEngine.ts
├── rsiEventBus.test.ts
├── rsiEventBus.ts
├── rsiScheduler.test.ts
├── rsiScheduler.ts
├── rsiScheduler.v12.test.ts
├── rsiTaskQueue.ts
├── rsiWorkerPool.ts
├── runbookExecutor.ts
├── runtimeConfig.test.ts
├── runtimeConfig.ts
├── runtimeGuard.test.ts
├── runtimeGuard.ts
├── safety.test.ts
├── safetyConstraintChecker.ts
├── safetyIntegration.test.ts
├── safetyProofChecker.ts
├── safetySupervisor.test.ts
├── safetySupervisor.ts
├── saliencyMapper.ts
├── sandboxManager.test.ts
├── sandboxManager.ts
├── sandboxVerifier.test.ts
├── sandboxVerifier.ts
├── sbomGenerator.ts
├── scenarioSimulator.ts
├── sceneSegmenter.ts
├── scheduler.test.ts
├── scheduler.ts
├── scientificMemory.ts
├── search.test.ts
├── search.ts
├── seasonalityAnalyzer.ts
├── secretsVault.ts
├── security.test.ts
├── security.ts
├── securityPatchApplier.ts
├── self/
│   ├── atomic_editor.test.ts
│   ├── atomic_editor.ts
│   ├── behavioral_tests.test.ts
│   ├── behavioral_tests.ts
│   ├── benchmark_suite.test.ts
│   ├── benchmark_suite.ts
│   ├── chunked_writer.test.ts
│   ├── chunked_writer.ts
│   ├── compilation_pipeline.test.ts
│   ├── compilation_pipeline.ts
│   ├── dependency_graph.test.ts
│   ├── dependency_graph.ts
│   ├── dependency_upgrader.test.ts
│   ├── dependency_upgrader.ts
│   ├── index.test.ts
│   ├── index.ts
│   ├── refactoring_engine.test.ts
│   ├── refactoring_engine.ts
│   ├── smoke_test_runner.test.ts
│   └── smoke_test_runner.ts
├── selfAwarenessEngine.ts
├── selfAwarenessMonitor.ts
├── selfConsistency.test.ts
├── selfConsistency.ts
├── selfCritiqueAgent.ts
├── selfDistillation.test.ts
├── selfDistillation.ts
├── selfDocumentation.test.ts
├── selfDocumentation.ts
├── selfDocumentationGenerator.ts
├── selfHeal.test.ts
├── selfHeal.ts
├── selfHealingArchitecture.ts
├── selfHealingChaos.ts
├── selfHealingInfra.ts
├── selfImprove.test.ts
├── selfImprove.ts
├── selfImproveGuard.test.ts
├── selfImproveGuard.ts
├── selfInspector.ts
├── selfIntrospect.test.ts
├── selfIntrospect.ts
├── selfKnowledgeBase.test.ts
├── selfKnowledgeBase.ts
├── selfModel.test.ts
├── selfModel.ts
├── selfModifier.ts
├── selfModify.test.ts
├── selfModify.ts
├── selfMonitor.test.ts
├── selfMonitor.ts
├── selfReflectionEngine.test.ts
├── selfReflectionEngine.ts
├── selfReview.test.ts
├── selfReview.ts
├── selfRollback.test.ts
├── selfRollback.ts
├── selfTestGenerator.test.ts
├── selfTestPipeline.test.ts
├── selfTestPipeline.ts
├── semanticCodebaseGraph.ts
├── semanticCompressor.ts
├── semanticDedup.ts
├── semanticDiffValidator.ts
├── semanticImpactPredictor.test.ts
├── semanticImpactPredictor.ts
├── semanticMemory.ts
├── semanticMemoryIndex.ts
├── semanticMergeResolver.ts
├── semanticRollback.ts
├── semanticSearchEngine.ts
├── semanticSelfModel.test.ts
├── semanticSelfModel.ts
├── semanticVersionControl.ts
├── sensorFusionEngine.ts
├── shadowInstance.test.ts
├── shadowInstance.ts
├── sharedWorkspaceManager.ts
├── shellExecutor.ts
├── shortTermPredictor.ts
├── simulatedAnnealingEngine.ts
├── simulationEngine.ts
├── singularityPreparator.ts
├── skillGraph.test.ts
├── skillGraph.ts
├── slaMonitor.ts
├── sloTracker.ts
├── socialNormLearner.ts
├── spanProcessor.ts
├── spatialMapper.ts
├── specs/
│   ├── FsWatcher.cfg
│   ├── FsWatcher.tla
│   ├── InitSafety.cfg
│   └── InitSafety.tla
├── speculativeExecutionEngine.ts
├── speechRecognizer.ts
├── spikePlasticityEngine.ts
├── spikingNetworkSimulator.ts
├── spikingNeuron.ts
├── srilEngine.ts
├── stakeholderReporting.ts
├── stigmergyEngine.ts
├── storage.test.ts
├── storage.ts
├── streamIntegrityMonitor.test.ts
├── streamIntegrityMonitor.ts
├── streamRouter.test.ts
├── streamRouter.ts
├── streamingDashboard.ts
├── subAgentMarketplace.ts
├── subAgentSpawner.ts
├── subtitleAligner.ts
├── supplyChainAuditor.ts
├── swarmCoordinator.ts
├── swarmOrchestrator.test.ts
├── swarmOrchestrator.ts
├── swarmParticleOptimizer.ts
├── swarmSpecialistVoting.test.ts
├── swarmSpecialistVoting.ts
├── swarmTestnet.test.ts
├── swarmTestnet.ts
├── sweBenchHarness.test.ts
├── sweBenchHarness.ts
├── symbolMapper.ts
├── symbolicExecutor.test.ts
├── symbolicExecutor.ts
├── synapticWeightManager.ts
├── syntaxHighlighter.ts
├── systemHealthMonitor.ts
├── systemIntegrator.ts
├── systemMemory.test.ts
├── systemMemory.ts
├── taskBroker.ts
├── taskDecomposer.test.ts
├── taskDecomposer.ts
├── taskDecomposerV44.ts
├── taskPlanner.test.ts
├── taskPlanner.ts
├── taskScheduler.ts
├── telemetry.test.ts
├── telemetry.ts
├── temporalAbstractionEngine.ts
├── temporalCaptioner.ts
├── temporalConsistencyChecker.ts
├── temporalKnowledgeDistillation.ts
├── temporalPatternDetector.ts
├── temporalReasoningEngine.ts
├── temporalSelfModel.ts
├── tenantManager.test.ts
├── tenantManager.ts
├── testCoverageAnalyzer.test.ts
├── testCoverageAnalyzer.ts
├── testGenerator.test.ts
├── testGenerator.ts
├── threatDetector.ts
├── throughputMaximizer.ts
├── tieredContextManager.test.ts
├── tieredContextManager.ts
├── timeSeriesForecaster.ts
├── timeSeriesStore.ts
├── tokenBudgetManager.test.ts
├── tokenBudgetManager.ts
├── toolSynthesis.test.ts
├── toolSynthesis.ts
├── toolSynthesizer.ts
├── toolUseOrchestrator.ts
├── tools/
│   ├── advancedFileOps.test.ts
│   ├── advancedFileOps.ts
│   ├── agentControl.test.ts
│   ├── agentControl.ts
│   ├── agentMemory.test.ts
│   ├── agentMemory.ts
│   ├── atomicModifyTools.test.ts
│   ├── atomicModifyTools.ts
│   ├── bashExecute.test.ts
│   ├── bashExecute.ts
│   ├── browserAutomation.test.ts
│   ├── browserAutomation.ts
│   ├── browserTools.test.ts
│   ├── browserTools.ts
│   ├── dockerSandbox.test.ts
│   ├── dockerSandbox.ts
│   ├── fileOps.test.ts
│   ├── fileOps.ts
│   ├── gitOps.test.ts
│   ├── gitOps.ts
│   ├── index.test.ts
│   ├── index.ts
│   ├── pythonExecute.test.ts
│   ├── pythonExecute.ts
│   ├── selfAwareness.test.ts
│   ├── selfAwareness.ts
│   ├── selfChunkedWriteTool.test.ts
│   ├── selfChunkedWriteTool.ts
│   ├── selfDiagnoseTools.test.ts
│   ├── selfDiagnoseTools.ts
│   ├── selfDiffReadTool.test.ts
│   ├── selfDiffReadTool.ts
│   ├── selfImprovementTools.test.ts
│   ├── selfImprovementTools.ts
│   ├── selfModifyHelpers.test.ts
│   ├── selfModifyHelpers.ts
│   ├── selfModifyTools.test.ts
│   ├── selfModifyTools.ts
│   ├── selfPatchFileTool.test.ts
│   ├── selfPatchFileTool.ts
│   ├── selfRunTestsTool.test.ts
│   ├── selfRunTestsTool.ts
│   ├── selfTestRunner.test.ts
│   ├── selfTestRunner.ts
│   ├── selfWriteFileTool.test.ts
│   ├── selfWriteFileTool.ts
│   ├── spawnSubAgent.test.ts
│   ├── spawnSubAgent.ts
│   ├── toolRegistry.test.ts
│   ├── toolRegistry.ts
│   ├── vision.test.ts
│   ├── vision.ts
│   ├── visualGroundingTool.test.ts
│   ├── visualGroundingTool.ts
│   ├── webBrowse.test.ts
│   ├── webBrowse.ts
│   ├── webSearch.test.ts
│   └── webSearch.ts
├── traceCollector.ts
├── traceCorrelator.ts
├── traceExporter.ts
├── traceQueryEngine.ts
├── traceSampler.ts
├── transactionLog.test.ts
├── transactionLog.ts
├── transcendentSelfModel.ts
├── transferLearner.ts
├── transferLearningBroker.ts
├── transferOptimizer.ts
├── trendExtractor.ts
├── truncationDetector.test.ts
├── truncationDetector.ts
├── trustBuilder.ts
├── tsHealEngine.ts
├── twoPhaseCommit.test.ts
├── twoPhaseCommit.ts
├── uncertaintyPropagator.ts
├── unifiedKnowledge.test.ts
├── unifiedKnowledge.ts
├── universalAgentInterface.ts
├── universalReasoningEngine.ts
├── unsupervisedCodebaseDiscovery.ts
├── utilityFunction.test.ts
├── utilityFunction.ts
├── v100.test.ts
├── v13.test.ts
├── v13_v15_coverage.test.ts
├── v14.test.ts
├── v15.test.ts
├── v16.test.ts
├── v17.test.ts
├── v18.test.ts
├── v19.test.ts
├── v20.test.ts
├── v21.test.ts
├── v22.test.ts
├── v23.test.ts
├── v24.test.ts
├── v25.test.ts
├── v26.test.ts
├── v27.test.ts
├── v28.test.ts
├── v29.test.ts
├── v30.test.ts
├── v31.test.ts
├── v32.test.ts
├── v33.test.ts
├── v34.test.ts
├── v35.test.ts
├── v36.test.ts
├── v37.test.ts
├── v38.test.ts
├── v39.test.ts
├── v40.test.ts
├── v41.test.ts
├── v42.test.ts
├── v43.test.ts
├── v44.test.ts
├── v45.test.ts
├── v46.test.ts
├── v47.test.ts
├── v48.test.ts
├── v49.test.ts
├── v50.test.ts
├── v51.test.ts
├── v52.test.ts
├── v53.test.ts
├── v54.test.ts
├── v55.test.ts
├── v56.test.ts
├── v57.test.ts
├── v58.test.ts
├── v59.test.ts
├── v60.test.ts
├── v61.test.ts
├── v62.test.ts
├── v63.test.ts
├── v64.test.ts
├── v65.test.ts
├── v66.test.ts
├── v67.test.ts
├── v68.test.ts
├── v69.test.ts
├── v70.test.ts
├── v71.test.ts
├── v72.test.ts
├── v73.test.ts
├── v74.test.ts
├── v75.test.ts
├── v76.test.ts
├── v77.test.ts
├── v78.test.ts
├── v79.test.ts
├── v80.test.ts
├── v81.test.ts
├── v82.test.ts
├── v83.test.ts
├── v84.test.ts
├── v85.test.ts
├── v86.test.ts
├── v87.test.ts
├── v88.test.ts
├── v89.test.ts
├── v90.test.ts
├── v91.test.ts
├── v92.test.ts
├── v93.test.ts
├── v94.test.ts
├── v95.test.ts
├── v96.test.ts
├── v97.test.ts
├── v98.test.ts
├── v99.test.ts
├── valueAlignmentMonitor.ts
├── valuePreservation.ts
├── vectorMemory.test.ts
├── vectorMemory.ts
├── videoFrameAnalyzer.ts
├── videoSummarizer.ts
├── visionContextEnricher.test.ts
├── visionContextEnricher.ts
├── visionModule.test.ts
├── visionModule.ts
├── visionProcessor.ts
├── visualGrounding.test.ts
├── visualGrounding.ts
├── visualRegressionGuard.ts
├── vitest.setup.test.ts
├── vitest.setup.ts
├── voiceInterface.test.ts
├── voiceInterface.ts
├── vulnerabilityAdvisor.ts
├── watchdog.test.ts
├── watchdog.ts
├── webBrowsingEngine.ts
├── webhookManager.ts
├── workflowEngine.ts
├── workflowMonitor.ts
├── workingMemory.ts
├── workingMemoryBuffer.ts
├── workspace.test.ts
├── workspace.ts
├── z3ProofLayer.test.ts
├── z3ProofLayer.ts
├── zeroShotTransferEngine.test.ts
├── zeroShotTransferEngine.ts
├── zipEdit.test.ts
├── zkProofSigning.test.ts
└── zkProofSigning.ts
```

## Available Tools (EXACT names — verified against source code)

### Self-Modification (use these for reading/writing your own source code)
- `self_read_server_file` — Read an Andromeda server source file with line numbers. Args: `file_path` (relative to server/, e.g. "llmProvider.ts"), optional `start_line`, `end_line`
- `self_read_file` — Alias for self_read_server_file. Same args.
- `self_patch_file` — Apply a targeted find-and-replace patch (PREFERRED for edits < 50 lines)
- `self_write_file` — Write a complete file (only for new files or full rewrites < 3000 chars)
- `self_write_file_chunked` — Write large files in chunks (required for files > 3000 chars)
- `self_restart` — Restart the server to apply changes
- `run_type_check` — Run TypeScript check after a self-modification. Alias: `self_run_tests` (both work as of v5.77)
- `self_diagnose` — Run root-cause analysis before modifying (ALWAYS do this first)
- `self_review` — Multi-dimensional pre-apply review (security, truncation, constitution)
- `self_benchmark` — Record/check performance baseline before and after changes
- `self_diff` — Show diff between two versions of a file
- `self_atomic_modify` — Atomic multi-file modification with rollback
- `verify_file_integrity` — Verify SHA-256 hash of a file

### Self-Awareness
- `get_own_capabilities` — Get capabilities, feature flags, and system state
- `list_codebase_files` — List all server source files with descriptions (NOT "get_codebase_map")
- `get_system_context` — Get current system context and environment
- `run_self_diagnosis` — Run comprehensive self-diagnosis (NOT "self_awareness")
- `self_heal` — Trigger self-healing routine

### File Operations (workspace files only — NOT for Andromeda source)
- `read_file` — Read a workspace file (uses workspace-relative paths)
- `read_file_range` — Read a specific line range of a workspace file
- `read_file_lines` — Read specific lines from a workspace file
- `write_file` — Write a workspace file
- `edit_file` — Edit a workspace file with find-and-replace
- `append_file` — Append to a workspace file
- `str_replace` — String replace in a workspace file
- `list_directory` — List directory contents
- `tree_view` — Show directory tree
- `search_files` — Search for text across files
- `move_file` — Move/rename a file
- `delete_file` — Delete a file
- `project_context` — Get project context summary

### Shell & Code Execution
- `bash_execute` — Execute a shell command (NOT "execute_bash" or "run_shell")
- `python_execute` — Execute Python code
- `sandbox_execute` — Execute code in an isolated sandbox
- `run_self_tests` — Run the self-test suite

### Memory (cross-session episodic memory)
- `store_memory` — Store a memory entry
- `recall_memory` — Search memories by query
- `list_memories` — List all memories

### Web & Search
- `web_search` — Search the web
- `web_browse` — Browse a URL (NOT "fetch_url")

### Git
- `git_operations` — Git operations (commit, diff, log, etc.)

### Vision
- `screenshot` — Take a screenshot
- `analyze_image` — Analyze an image
- `visual_verify` — Visual verification

### Agent Control
- `ask_human` — Ask the human a question
- `create_plan` — Create a structured plan
- `terminate` — End the current task

## CRITICAL: Self-Modification Workflow for Large Files (v5.82)

The truncation circular dependency is ALREADY SOLVED. Here is the exact workflow:

**Step 1**: Read the file first: `self_read_server_file("llmProvider.ts")`
**Step 2**: For edits < 50 lines: use `self_patch_file` (preferred — never truncated)
**Step 3**: For new files or full rewrites > 3000 chars: use `self_write_file_chunked`
  - Args: `file_path`, `chunk_index` (0-based), `total_chunks`, `content`
  - Send chunk 0, then chunk 1, etc. The system assembles them automatically.
  - Example: 300-line file = 3 chunks of 100 lines each
**Step 4**: Run `run_type_check` to verify
**Step 5**: Run `self_restart` if TypeScript check passes

**NEVER use `self_write_file` for files > 3000 chars** — it will be rejected.
**ALWAYS use `self_patch_file` for targeted edits** — it cannot be truncated.

## CRITICAL: Wrong tool names that will FAIL
| ❌ DO NOT USE (does not exist) | ✅ USE INSTEAD |
|---|---|
| `self_awareness` | `get_own_capabilities` or `run_self_diagnosis` |
| `get_codebase_map` | `list_codebase_files` |
| `list_files` | `list_directory` or `tree_view` |
| `read_file_content` | `self_read_server_file` (source) or `read_file` (workspace) |
| `execute_bash` | `bash_execute` |
| `run_shell` | `bash_execute` |
| `self_test_runner` | `run_type_check` |
| ~~`self_run_tests`~~ | Both `self_run_tests` and `run_type_check` work as of v5.77 |
| `fetch_url` | `web_browse` |
| `run_code` | `bash_execute` or `python_execute` |
| `truncation_fix` | Does not exist — see llmProvider.ts |
| `self_read_file` | `self_read_server_file` (alias also works) |


## RSI Improvement Goals (v12.2.2 — MANDATORY Priority Order)

**CRITICAL INSTRUCTION FOR RSI ENGINE:**
You MUST choose the HIGHEST-PRIORITY improvement that exists in the file.
If a Priority 1, 2, or 3 improvement exists, you MUST propose it — do NOT fall back to Priority 4.
Only propose Priority 4 (magic numbers, JSDoc) if NO higher-priority improvement exists in the file.
Prioritize improvements that change BEHAVIOR (error handling, null guards, async safety) over style.

### Priority 1 — Security & Correctness (reward: 1.0) — ALWAYS PREFER THESE
- Replace any remaining string comparison of secrets with `crypto.timingSafeEqual()`
- Replace any `Math.random()` used for security tokens with `crypto.randomBytes()`
- Add input validation to any API route that accepts user-controlled data without validation
- Fix any `undefined` or `null` dereference that is not guarded
- Replace `as any` casts that hide real type errors with proper typed alternatives
- Fix any async function that does not handle rejected promises (missing try/catch or .catch())

### Priority 2 — Reliability & Error Handling (reward: 0.9) — STRONGLY PREFER THESE
- Replace silent `} catch { }` blocks with `log.warn(...)` using the file's existing logger
- Replace `} catch (e) { console.error(e) }` with structured `log.error(...)` calls
- Add null/undefined guard before any `.length`, `.map()`, `.filter()` on potentially-undefined values
- Add timeout to any `fetch()` call that has no AbortController/timeout
- Replace `JSON.parse(x)` without try/catch with a safe parse wrapper

### Priority 3 — Performance (reward: 0.8) — PREFER THESE OVER STYLE CHANGES
- Replace `.find()` in hot paths (called >100x/sec) with `Map.get()` lookups
- Replace repeated `JSON.parse(JSON.stringify(x))` deep-clone patterns with `structuredClone(x)`
- Add `.unref()` to any new `setInterval` or `setTimeout` calls to prevent vitest worker hangs
- Replace synchronous `fs.readFileSync` inside async request handlers with `fs.promises.readFile`

### Priority 4 — Code Quality (reward: 0.5) — ONLY IF NO HIGHER PRIORITY EXISTS
- Extract magic numbers (timeouts, limits, thresholds) into named constants at the top of the file
- Replace `any` types with proper interfaces where the shape is known
- Add JSDoc to exported functions that have none

### Do NOT Do (penalized)
- Do NOT propose magic number extraction if a Priority 1, 2, or 3 improvement exists in the file
- Do NOT propose the same type of change to the same file twice in a row
- Do NOT remove existing JSDoc comments
- Do NOT make changes that require a full rebuild to validate


## Constitution (Hard Rules — Cannot Be Overridden)

These rules are enforced by `server/safetySupervisor.ts` and checked by `self_review`:

1. **NEVER delete or overwrite twoPhaseCommit.ts, safetySupervisor.ts, or recursionGuard.ts** — these are the safety systems
2. **NEVER remove rollback logic** — any modification that removes git snapshot or SHA-256 verification will be rejected
3. **NEVER add process.exit(), eval(), or shell injection** — these are security violations
4. **ALWAYS use self_patch_file for edits to existing files** — full rewrites risk truncation
5. **ALWAYS run run_type_check after any self-modification** — no untested changes
6. **ALWAYS store the outcome in memory** — use store_memory with type='success' or type='failure'
7. **Maximum 3 auto-applies per RSI cycle** — prevents runaway modification
8. **Pause after 9 consecutive auto-applies** — requires human confirmation

## Cross-Session Episodic Memory Protocol

After EVERY self-modification attempt, store the outcome:
```
store_memory({
  type: "success" | "failure",
  content: "Fixed truncation in llmProvider.ts: increased max_tokens from 8192 to 32768. Root cause: output token limit too low for large file writes.",
  tags: ["self-modification", "llmProvider.ts", "truncation"]
})
```
Before attempting any fix, ALWAYS call:
```
recall_memory("truncation fix llmProvider")
```
This prevents repeating the same mistakes across sessions.

## ENOENT Loop Prevention (v5.76)

If `read_file` or `self_read_server_file` returns "File not found" or ENOENT:
1. **DO NOT retry the same path** — it will fail again
2. Use `bash_execute` with `find server/ -name "*.ts" | sort` to see all real files
3. Use `list_codebase_files` to get a description of each file
4. The reactEngine will HALT your loop after 3 consecutive ENOENT errors on the same path

## Self-Modification Workflow (MANDATORY — follow exactly)
1. Call `recall_memory` to check if this issue has been seen before
2. Call `self_diagnose` to identify root cause from actual source files
3. Call `self_read_server_file` on the specific file to read the exact current content
4. Plan the MINIMAL change needed (prefer `self_patch_file` over full rewrite)
5. Call `self_review` on the proposed change before applying
6. Apply the change with `self_patch_file` or `self_write_file`
7. Call `run_type_check` to verify TypeScript compiles
8. Call `self_benchmark` to check for performance regression
9. Call `store_memory` with type='success' or type='failure' and the outcome
10. Call `self_restart` to apply the change to the running server

## Current Version
Andromeda v5.96 — Self-modifying AI agent with RSI engine, cross-session episodic memory,
constitution enforcement, three-layer truncation defense, ENOENT loop prevention,
hallucination guard (v5.78), mandatory tool-use enforcement for self-assessments,
and runtime path injection (v5.96) so bash_execute uses real filesystem paths.
