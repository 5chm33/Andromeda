path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { addPrinciple, evaluateAction as evaluateEthicalAction, getPrinciples, getEvaluations } from "../ethicsEngine";
import { addConstraint, checkAction as checkSafetyAction, getConstraints, getResults as getSafetyResults } from "../safetyConstraintChecker";
import { registerValue, updateAlignment, generateAlignmentReport } from "../valueAlignmentMonitor";
import { addHarmPattern, filterContent, getPatterns as getHarmPatterns } from "../harmPreventionFilter";
import { registerAgent as registerCorrigibleAgent, issueOverride, acknowledgeOverride, resume as resumeAgent } from "../corrigibilityManager";
import { createAudit, addFinding, completeAudit, getAudits } from "../ethicsAuditor";"""

old_line = 'import { proposeModification, runSafetyTests, applyModification, rollback as rollbackMod } from "../selfModifier";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v93 imports wired successfully.")
