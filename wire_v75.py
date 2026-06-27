path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """import { openIncident, updateIncidentStatus } from "../incidentManager";
import { registerRunbook, executeRunbook } from "../runbookExecutor";
import { generatePostmortem } from "../postmortemAnalyzer";
import { registerSlo, recordMeasurement, getSloStatus } from "../sloTracker";
import { initErrorBudget, consumeErrorBudget } from "../errorBudgetMonitor";
import { registerOncallSchedule, routeIncident } from "../oncallRouter";
"""

old_line = 'import { checkGdprCompliance } from "../gdprComplianceChecker";'
content = content.replace(old_line, old_line + "\n" + new_imports.rstrip())

with open(path, "w") as f:
    f.write(content)

print("v75 imports wired successfully.")
