path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { createSimulation, scheduleEvent, runSimulation } from "../simulationEngine";
import { createGame, startGame, applyAction as applyGameAction } from "../gameStateManager";
import { defineRewardFunction, calculateReward, getCumulativeReward } from "../rewardCalculator";
import { createPolicy, selectAction, updatePolicy } from "../policyOptimizer";
import { createEnvironment, addState, addTransition, step as envStep } from "../environmentModel";
import { createMCTSTree, expandNode, backpropagate, selectBestAction } from "../monteCarloPlanner";"""

old_line = 'import { joinElection, runElection, getCurrentLeader } from "../agentElectionProtocol";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v87 imports wired successfully.")
