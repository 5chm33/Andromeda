path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """import { recordCostEvent, getCostSummary } from "../costTracker";
import { createBudget, checkBudget } from "../budgetAlertEngine";
import { generateOptimizationReport } from "../resourceCostOptimizer";
import { analyzeSpend } from "../cloudSpendAnalyzer";
import { createAllocationRule, allocateCost } from "../costAllocationEngine";
import { generateBillingReport } from "../billingReporter";
"""

old_line = 'import { logAuditEntry, getAuditLog } from "../featureAuditLog";'
content = content.replace(old_line, old_line + "\n" + new_imports.rstrip())

with open(path, "w") as f:
    f.write(content)

print("v78 imports wired successfully.")
