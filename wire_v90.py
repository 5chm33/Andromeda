path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { createMetaModel, recordEpisode as recordMetaEpisode, recommendLearningRate } from "../metaLearner";
import { createAdaptiveLearner, addAdaptationRule, processFeedback, getPerformanceTrend } from "../adaptiveLearner";
import { createOnlineModel, predict as onlinePredict, updateModel as onlineUpdate, batchUpdate } from "../onlineLearner";
import { registerDomain, findSharedFeatures, transferKnowledge } from "../transferLearner";
import { createContinualModel, learnTask, evaluateForgetting, replayExemplars } from "../continualLearner";
import { createFewShotClassifier, buildPrototypes, classify as fewShotClassify, runEpisode } from "../fewShotLearner";"""

old_line = 'import { createProblem, addVariable, addConstraint, solve } from "../constraintSolver";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v90 imports wired successfully.")
