path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { createNeuron, injectCurrent, getNeuron, resetNeuron } from "../spikingNeuron";
import { encode as populationEncode, decode as populationDecode, getCodes as getPopulationCodes } from "../neuralPopulationCoder";
import { registerPattern as registerSpikePattern, recordSpike, detectPatterns, getMatches as getSpikeMatches } from "../temporalPatternDetector";
import { createSimulation, addNeuron as addNetNeuron, addSynapse as addNetSynapse, runTimestep } from "../spikingNetworkSimulator";
import { createSynapse as createHebbianSynapse, applyHebbianRule, getSynapse as getHebbianSynapse } from "../hebbianLearner";"""

old_line = 'import { createExperiment, suggestTrial, reportTrialResult, getExperiment } from "../hyperparameterTuner";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v97 imports wired successfully.")
