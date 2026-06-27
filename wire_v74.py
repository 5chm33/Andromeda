path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """import { evaluatePrivacy } from "../privacyEngine";
import { redactPii } from "../piiRedactor";
import { grantConsent, hasConsent } from "../consentManager";
import { addRetentionRule, enforceRetention } from "../dataRetentionPolicy";
import { runAnonymizationPipeline } from "../anonymizationPipeline";
import { checkGdprCompliance } from "../gdprComplianceChecker";
"""

old_line = 'import { summarizeVideo } from "../videoSummarizer";'
content = content.replace(old_line, old_line + "\n" + new_imports.rstrip())

with open(path, "w") as f:
    f.write(content)

print("v74 imports wired successfully.")
