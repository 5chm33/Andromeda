path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { defineWorkflow, startExecution, completeStep } from "../workflowEngine";
import { enqueue, dequeue, completeJob, failJob } from "../jobQueue";
import { createRetryPolicy, computeDelay, shouldRetry } from "../retryManager";
import { parseCron, getNextRun, isValidCron } from "../cronExpressionParser";
import { registerSLA, recordExecution as recordWfExecution, getStats as getWfStats } from "../workflowMonitor";
import { registerTrigger, processEvent, disableTrigger } from "../eventDrivenTrigger";"""

old_line = 'import { extractTrend, detectChangePoints } from "../trendExtractor";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v84 imports wired successfully.")
