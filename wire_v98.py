path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { addNode as addCausalNode, addEdge as addCausalEdge, getParents, getChildren, findPaths as findCausalPaths } from "../causalGraph";
import { registerVariable, intervene, measureEffect, removeIntervention } from "../interventionEngine";
import { createScenario, query as counterfactualQuery, compareScenarios } from "../counterfactualReasoner";
import { analyzeConfounding } from "../confoundingDetector";
import { discoverStructure, getStructures as getCausalStructures } from "../causalDiscovery";
import { createDoExpression, applyRule as applyDoRule, identifyAdjustmentSet, computeATE } from "../doCalculus";"""

old_line = 'import { createSynapse as createHebbianSynapse, applyHebbianRule, getSynapse as getHebbianSynapse } from "../hebbianLearner";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v98 imports wired successfully.")
