path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { createMap, addRegion, findNearestRegion, getRegionsInRadius, getMap } from "../spatialMapper";
import { createGrid, setObstacle, planPath, getPaths } from "../pathPlanner";
import { registerObject as registerCollisionObject, updatePosition, detectCollision, detectAllCollisions } from "../collisionDetector";
import { recordReading, updatePerceptualModel, getPerceivedObjects, getReadings as getSensorReadings } from "../environmentPerceiver";
import { registerAgent as registerEmbodiedActionAgent, queueAction, executeNextAction, getAgentState as getActionAgentState } from "../actionExecutor";
import { createEmbodiedAgent, setGoal, stepTowardGoal, interact as agentInteract, rest as agentRest, getStatus as getEmbodiedStatus } from "../embodiedAgent";"""

old_line = 'import { createDialogContext, processDialogTurn, getContext as getDialogContext, getTurns as getDialogTurns } from "../groundedDialogManager";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v95 imports wired successfully.")
