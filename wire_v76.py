path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """import { scanDependencies } from "../dependencyScanner";
import { generateAdvisoryReport } from "../vulnerabilityAdvisor";
import { checkLicenses } from "../licenseChecker";
import { generateSbom } from "../sbomGenerator";
import { auditSupplyChain } from "../supplyChainAuditor";
import { analyzeDependencyGraph } from "../dependencyGraphAnalyzer";
"""

old_line = 'import { registerOncallSchedule, routeIncident } from "../oncallRouter";'
content = content.replace(old_line, old_line + "\n" + new_imports.rstrip())

with open(path, "w") as f:
    f.write(content)

print("v76 imports wired successfully.")
