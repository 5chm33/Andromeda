path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { analyzeFeatureImportance, getTopFeatures } from "../featureImportanceAnalyzer";
import { generateTextSaliency, generateTabularSaliency, getHighSaliencyRegions } from "../saliencyMapper";
import { extractRule, explainDecision } from "../decisionExplainer";
import { generateCounterfactual } from "../counterfactualGenerator";
import { auditFairness } from "../fairnessAuditor";
import { generateXAIReport, summarizeExplanations } from "../explanationReporter";"""

old_line = 'import { createMCTSTree, expandNode, backpropagate, selectBestAction } from "../monteCarloPlanner";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v88 imports wired successfully.")
