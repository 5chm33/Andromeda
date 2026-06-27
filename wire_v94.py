path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { groundSymbol, groundText, getSymbol, getAllSymbols } from "../languageGrounder";
import { addMapping, storeEmbedding, findSimilarSymbols, getMappings } from "../symbolMapper";
import { analyzeUtterance, getAnalyses } from "../pragmaticReasoner";
import { createDiscourse, addTurn as addDiscurseTurn, getDiscourse, getUnits } from "../discourseManager";
import { startConversation, sendMessage as sendProtocolMessage, acknowledgeMessage, closeConversation } from "../communicationProtocol";
import { createDialogContext, processDialogTurn, getContext as getDialogContext, getTurns as getDialogTurns } from "../groundedDialogManager";"""

old_line = 'import { createAudit, addFinding, completeAudit, getAudits } from "../ethicsAuditor";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v94 imports wired successfully.")
