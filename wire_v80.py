path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { startSpan, finishSpan, getTrace } from "../traceCollector";
import { configureProcessor, processSpan, flushBatch } from "../spanProcessor";
import { configureSampler, shouldSample } from "../traceSampler";
import { registerExportTarget, exportTrace } from "../traceExporter";
import { injectContext, extractContext, propagate } from "../contextPropagator";
import { indexTrace, queryTraces } from "../traceQueryEngine";"""

old_line = 'import { registerCb, canExecute, recordCbSuccess, recordCbFailure } from "../apiCircuitBreaker";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v80 imports wired successfully.")
