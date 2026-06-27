path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { assessCapabilities, reflect, getLatestReport } from "../selfInspector";
import { defineRule, applyRules as applyRewriteRules, getRules as getRewriteRules } from "../codeRewriter";
import { startSession as startProfileSession, record as recordProfile, endSession as endProfileSession, getHotspots } from "../performanceProfiler";
import { registerStage, detectBottlenecks, getBottlenecks } from "../bottleneckDetector";
import { suggestOptimization, generatePlan as generateOptPlan, getSuggestions as getOptSuggestions } from "../optimizationSuggester";
import { proposeModification, runSafetyTests, applyModification, rollback as rollbackMod } from "../selfModifier";"""

old_line = 'import { createMemoryIndex, indexMemory, searchMemory, getImportantMemories } from "../memoryIndexer";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v92 imports wired successfully.")
