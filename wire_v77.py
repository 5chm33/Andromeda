path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """import { createFlag, evaluateFlag } from "../featureFlagManager";
import { createExperiment, exposeUser, recordConversion } from "../abTestingEngine";
import { trackExperiment, updateExperimentStatus } from "../experimentTracker";
import { createCanaryDeployment, activateCanary, recordHealthCheck } from "../canaryDeployer";
import { createRolloutPlan, advanceRollout } from "../rolloutController";
import { logAuditEntry, getAuditLog } from "../featureAuditLog";
"""

old_line = 'import { analyzeDependencyGraph } from "../dependencyGraphAnalyzer";'
content = content.replace(old_line, old_line + "\n" + new_imports.rstrip())

with open(path, "w") as f:
    f.write(content)

print("v77 imports wired successfully.")
