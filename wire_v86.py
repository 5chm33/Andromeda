path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { registerAgent, updateHeartbeat, findAgentsByCapability } from "../agentRegistry";
import { publish, subscribe, getMessagesForAgent } from "../agentMessageBus";
import { makeOffer, acceptOffer, getActiveContracts } from "../agentCapabilityNegotiator";
import { registerAgentInPool, delegate } from "../agentTaskDelegator";
import { writeState, readState } from "../agentStateSync";
import { joinElection, runElection, getCurrentLeader } from "../agentElectionProtocol";"""

old_line = 'import { addArticle, queryKnowledgeBase } from "../knowledgeBaseManager";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v86 imports wired successfully.")
