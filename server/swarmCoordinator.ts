/**
 * swarmCoordinator.ts — v23.0.0
 * 
 * Distributed Swarm Intelligence.
 * Gossip protocol for sharing validated hypotheses and high-fitness NAS configurations
 * across multiple Andromeda instances.
 */

import * as fs from "fs";
import * as path from "path";

export interface SwarmMessage {
  type: "HYPOTHESIS_VALIDATED" | "NAS_DISCOVERY" | "PHEROMONE_TRAIL";
  senderId: string;
  payload: any;
  timestamp: number;
}

const SWARM_STATE_FILE = path.join(process.cwd(), ".swarm_state.json");
const INSTANCE_ID = `node_${Math.random().toString(36).substring(2, 9)}`;

export function initSwarmCoordinator(): void {
  if (!fs.existsSync(SWARM_STATE_FILE)) {
    fs.writeFileSync(SWARM_STATE_FILE, JSON.stringify({
      instanceId: INSTANCE_ID,
      knownPeers: [],
      receivedMessages: [],
      pheromoneTrails: {}
    }, null, 2));
  }
}

export function getSwarmState(): any {
  try {
    return JSON.parse(fs.readFileSync(SWARM_STATE_FILE, "utf-8"));
  } catch {
    return { instanceId: INSTANCE_ID, knownPeers: [], receivedMessages: [], pheromoneTrails: {} };
  }
}

function saveSwarmState(state: any): void {
  fs.writeFileSync(SWARM_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Broadcasts a discovery to the swarm.
 */
export function broadcastToSwarm(type: SwarmMessage["type"], payload: any): void {
  const state = getSwarmState();
  const message: SwarmMessage = {
    type,
    senderId: state.instanceId,
    payload,
    timestamp: Date.now()
  };
  
  // In a real implementation, this would use gRPC or WebSockets to reach peers.
  // For the daemon, we simulate it by writing to the state file.
  state.receivedMessages.push(message);
  
  if (type === "PHEROMONE_TRAIL") {
    const targetFile = payload.targetFile;
    state.pheromoneTrails[targetFile] = (state.pheromoneTrails[targetFile] || 0) + payload.strength;
  }
  
  saveSwarmState(state);
}

/**
 * Gets the strongest pheromone trails (files that peers found highly improvable).
 */
export function getStrongestPheromoneTrails(limit: number = 5): string[] {
  const state = getSwarmState();
  const trails = Object.entries(state.pheromoneTrails) as [string, number][];
  
  return trails
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(t => t[0]);
}
