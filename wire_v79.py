path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

# Remove the incorrectly wired imports first
bad_block = """\nimport { registerService, routeRequest } from "../apiGateway";
import { createPolicy, checkRateLimit } from "../rateLimiter";
import { registerSchema, validateRequest } from "../requestValidator";
import { registerTransformRule, transformResponse } from "../responseTransformer";
import { registerVersion, resolveVersion } from "../apiVersionRouter";
import { registerCircuit, canExecute, recordSuccess, recordFailure } from "../apiCircuitBreaker";"""

content = content.replace(bad_block, "")

new_imports = """\nimport { registerService as registerGatewayService, routeRequest as routeGatewayRequest } from "../apiGateway";
import { createPolicy as createRlPolicy, checkRateLimit as checkRl } from "../rateLimiter";
import { registerSchema as registerValidationSchema, validateRequest as validateApiRequest } from "../requestValidator";
import { registerTransformRule, transformResponse } from "../responseTransformer";
import { registerVersion as registerApiVersion, resolveVersion } from "../apiVersionRouter";
import { registerCircuit as registerCb, canExecute, recordSuccess as recordCbSuccess, recordFailure as recordCbFailure } from "../apiCircuitBreaker";"""

old_line = 'import { generateBillingReport } from "../billingReporter";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v79 imports re-wired with aliases.")
