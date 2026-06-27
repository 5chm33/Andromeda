path = "server/_core/initDaemons.ts"
with open(path, "r") as f:
    content = f.read()

new_imports = """
import { initializeAndromeda, registerCapability, invokeCapability, getSystemMetrics, getCapabilitiesByDomain, setCapabilityHealth, shutdown as shutdownAndromeda, getSystemStatus, getEvents as getAndromedaEvents } from "../andromedaCore";
import { registerSubsystem, updateHealth, generateReport, getSubsystem, getReports as getHealthReports } from "../systemHealthMonitor";
import { addCapability as addSelfCapability, addLimitation, setGoal, removeGoal, reflect, getSelfModel, getReflections } from "../selfAwarenessEngine";
import { addPremise, reason, getChains, getPremises as getReasoningPremises } from "../universalReasoningEngine";
import { configure as configureBootstrapper, registerModule, bootstrap, getManifest, getAllManifests, getBootstrapHistory } from "../andromedaBootstrapper";"""

old_line = 'import { createSwarm, stepSwarm, getSwarm } from "../swarmParticleOptimizer";'
content = content.replace(old_line, old_line + new_imports)

with open(path, "w") as f:
    f.write(content)

print("v100 imports wired successfully.")
