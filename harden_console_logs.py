"""
harden_console_logs.py — Replace console.log/warn/error with structured logger
in all v72-v100 production modules that don't already import logger.
"""
import os, re

server_dir = "/home/ubuntu/andromeda_full/server"

v72_plus_modules = [
    "videoFrameAnalyzer", "speechRecognizer", "dialogActClassifier", "crossModalRetriever",
    "audioAnalyzer", "imageCaptioner", "sceneSegmenter", "objectTracker", "motionEventDetector",
    "temporalCaptioner", "subtitleAligner", "videoSummarizer",
    "privacyEngine", "piiRedactor", "consentManager", "dataRetentionPolicy",
    "anonymizationPipeline", "gdprComplianceChecker",
    "incidentManager", "runbookExecutor", "postmortemAnalyzer", "sloTracker",
    "errorBudgetMonitor", "oncallRouter",
    "dependencyScanner", "vulnerabilityAdvisor", "licenseChecker", "sbomGenerator",
    "supplyChainAuditor", "dependencyGraphAnalyzer",
    "featureFlagManager", "abTestingEngine", "experimentTracker", "canaryDeployer",
    "rolloutController", "featureAuditLog",
    "costTracker", "budgetAlertEngine", "resourceCostOptimizer", "cloudSpendAnalyzer",
    "costAllocationEngine", "billingReporter",
    "apiGateway", "rateLimiter", "requestValidator", "responseTransformer",
    "apiVersionRouter", "apiCircuitBreaker",
    "traceCollector", "spanProcessor", "traceSampler", "traceExporter",
    "contextPropagator", "traceQueryEngine",
    "codeParser", "syntaxHighlighter", "codeComplexityAnalyzer", "deadCodeDetector",
    "codeFormatterEngine", "codeSearchIndexer",
    "documentIndexer", "documentSummarizer", "documentClassifier", "documentVersionManager",
    "documentTemplateEngine", "documentSearchEngine",
    "timeSeriesStore", "movingAverageCalculator", "anomalyDetector", "forecastEngine",
    "seasonalityAnalyzer", "trendExtractor",
    "workflowEngine", "jobQueue", "retryManager", "cronExpressionParser",
    "workflowMonitor", "eventDrivenTrigger",
    "knowledgeGraph", "ontologyManager", "inferenceEngine", "graphQueryEngine",
    "entityLinker", "knowledgeBaseManager",
    "agentRegistry", "agentMessageBus", "agentCapabilityNegotiator", "agentTaskDelegator",
    "agentStateSync", "agentElectionProtocol",
    "simulationEngine", "gameStateManager", "rewardCalculator", "policyOptimizer",
    "environmentModel", "monteCarloPlanner",
    "featureImportanceAnalyzer", "saliencyMapper", "decisionExplainer",
    "counterfactualGenerator", "fairnessAuditor", "explanationReporter",
    "hierarchicalPlanner", "planExecutor", "planMonitor", "planReviser",
    "objectiveTracker", "constraintSolver",
    "metaLearner", "adaptiveLearner", "onlineLearner", "transferLearner",
    "continualLearner", "fewShotLearner",
    "workingMemory", "semanticMemory", "proceduralMemory", "attentionMechanism",
    "cognitiveController", "memoryIndexer",
    "selfInspector", "codeRewriter", "performanceProfiler", "bottleneckDetector",
    "optimizationSuggester", "selfModifier",
    "ethicsEngine", "safetyConstraintChecker", "valueAlignmentMonitor", "harmPreventionFilter",
    "corrigibilityManager", "ethicsAuditor",
    "languageGrounder", "symbolMapper", "pragmaticReasoner", "discourseManager",
    "communicationProtocol", "groundedDialogManager",
    "spatialMapper", "pathPlanner", "collisionDetector", "environmentPerceiver",
    "actionExecutor", "embodiedAgent",
    "annealingScheduler", "populationEvolver", "fitnessLandscapeMapper", "paretoOptimizer",
    "hyperparameterTuner",
    "spikingNeuron", "neuralPopulationCoder", "temporalPatternDetector",
    "spikingNetworkSimulator", "hebbianLearner",
    "causalGraph", "interventionEngine", "counterfactualReasoner", "confoundingDetector",
    "causalDiscovery", "doCalculus",
    "stigmergyEngine", "pheromoneTrailManager", "emergentBehaviorDetector",
    "crowdWisdomAggregator", "swarmParticleOptimizer",
    "andromedaCore", "systemHealthMonitor", "selfAwarenessEngine",
    "universalReasoningEngine", "andromedaBootstrapper",
    "advancedCache",
]

fixed = 0
skipped = 0

for module_name in v72_plus_modules:
    filepath = os.path.join(server_dir, f"{module_name}.ts")
    if not os.path.exists(filepath):
        continue

    with open(filepath, 'r') as f:
        content = f.read()

    # Skip if already imports logger
    if 'from "./logger' in content or "from './logger" in content:
        skipped += 1
        continue

    # Skip if no console usage
    if 'console.' not in content:
        skipped += 1
        continue

    # Build logger import and instance
    module_tag = module_name[0].upper() + module_name[1:]
    logger_import_line = 'import { createLogger } from "./logger.js";'
    logger_var_line = f'const log = createLogger("{module_tag}");'

    # Insert after the last import line
    lines = content.split('\n')
    last_import_idx = -1
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('import '):
            last_import_idx = i

    if last_import_idx >= 0:
        lines.insert(last_import_idx + 1, logger_var_line)
        lines.insert(last_import_idx + 1, logger_import_line)
    else:
        lines.insert(0, logger_var_line)
        lines.insert(0, logger_import_line)

    new_content = '\n'.join(lines)

    # Replace console calls with structured logger
    new_content = re.sub(r'console\.log\(', 'log.info(', new_content)
    new_content = re.sub(r'console\.warn\(', 'log.warn(', new_content)
    new_content = re.sub(r'console\.error\(', 'log.error(', new_content)
    new_content = re.sub(r'console\.debug\(', 'log.debug(', new_content)

    with open(filepath, 'w') as f:
        f.write(new_content)

    fixed += 1

print(f"Fixed: {fixed} modules (added logger, replaced console.* calls)")
print(f"Skipped: {skipped} modules (already had logger or no console calls)")
