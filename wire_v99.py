path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { createField, depositTrace, evaporateField, getTracesNear } from "../stigmergyEngine";
import { addEdge as addPheromoneEdge, depositPheromone, evaporatePheromones, getNeighbors as getPheromoneNeighbors, recordPath as recordAntPath, getBestPath } from "../pheromoneTrailManager";
import { recordObservation as recordSwarmObservation, detectEmergence, getEvents as getEmergentEvents } from "../emergentBehaviorDetector";
import { aggregate as aggregateCrowdWisdom, getEstimates as getCrowdEstimates } from "../crowdWisdomAggregator";
import { createSwarm, stepSwarm, getSwarm } from "../swarmParticleOptimizer";"""

old_line = 'import { createDoExpression, applyRule as applyDoRule, identifyAdjustmentSet, computeATE } from "../doCalculus";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v99 imports wired successfully.")
