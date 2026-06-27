path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { definePrimitiveTask, defineCompoundTask, createPlan } from "../hierarchicalPlanner";
import { startPlanExecution, executeNextStep, abortExecution } from "../planExecutor";
import { checkStateDeviation, recordDeviation, requiresReplanning } from "../planMonitor";
import { createRevisionRequest, revisePlan, getRevisionHistory } from "../planReviser";
import { createObjective, addKeyResult, updateKeyResult } from "../objectiveTracker";
import { createProblem, addVariable, addConstraint, solve } from "../constraintSolver";"""

old_line = 'import { generateXAIReport, summarizeExplanations } from "../explanationReporter";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v89 imports wired successfully.")
