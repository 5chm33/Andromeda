path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { createWorkingMemory, store as wmStore, retrieve as wmRetrieve, rehearse, decay } from "../workingMemory";
import { createSemanticMemory, addConcept, addRelation, queryConcept, getRelatedConcepts } from "../semanticMemory";
import { defineSkill, executeSkill, getSkillsByDomain, getSuccessRate } from "../proceduralMemory";
import { createAttentionController, addStimulus, computeAttention } from "../attentionMechanism";
import { createCognitiveArchitecture, startCycle, completeCycle } from "../cognitiveController";
import { createMemoryIndex, indexMemory, searchMemory, getImportantMemories } from "../memoryIndexer";"""

old_line = 'import { createFewShotClassifier, buildPrototypes, classify as fewShotClassify, runEpisode } from "../fewShotLearner";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v91 imports wired successfully.")
