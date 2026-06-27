path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { createSession as createAnnealingSession, step as annealingStep, getSession as getAnnealingSession } from "../annealingScheduler";
import { initializePopulation, evolveGeneration, getState as getEvoState } from "../populationEvolver";
import { addPoint as addLandscapePoint, analyzeLandscape, getPoints as getLandscapePoints } from "../fitnessLandscapeMapper";
import { addObjective, addSolution as addParetoSolution, computeParetoFront, getBestByObjective } from "../paretoOptimizer";
import { createExperiment, suggestTrial, reportTrialResult, getExperiment } from "../hyperparameterTuner";"""

old_line = 'import { createEmbodiedAgent, setGoal, stepTowardGoal, interact as agentInteract, rest as agentRest, getStatus as getEmbodiedStatus } from "../embodiedAgent";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v96 imports wired successfully.")
