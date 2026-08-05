/**
 * neuromorphicMemory.ts — v21.0.0
 * 
 * Neuromorphic Memory Architecture.
 * A 5-tier biologically-inspired memory hierarchy:
 * Sensory -> Working -> Episodic -> Semantic -> Procedural
 */

import * as fs from "fs";
import * as path from "path";

export type MemoryTier = "sensory" | "working" | "episodic" | "semantic" | "procedural";

export interface Neuromemory {
  id: string;
  tier: MemoryTier;
  content: string;
  activationCount: number;
  lastActivated: number;
  decayRate: number; // How quickly it drops tiers
}

function getMemoryFile(): string {
  return path.join(process.cwd(), ".andromeda_neuromemory.json");
}

export function initNeuromorphicMemory(): void {
  const file = getMemoryFile();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify([]));
  }
}

function loadMemory(): Neuromemory[] {
  try {
    return JSON.parse(fs.readFileSync(getMemoryFile(), "utf-8"));
  } catch {
    return [];
  }
}

function saveMemory(mems: Neuromemory[]): void {
  fs.writeFileSync(getMemoryFile(), JSON.stringify(mems, null, 2));
}

/**
 * Ingests raw data into the Sensory buffer.
 */
export function ingestSensory(content: string): Neuromemory {
  initNeuromorphicMemory();
  const mems = loadMemory();
  
  const mem: Neuromemory = {
    id: `mem-${Date.now()}-${Math.random().toString(36).substring(2,9)}`,
    tier: "sensory",
    content,
    activationCount: 1,
    lastActivated: Date.now(),
    decayRate: 0.1 // Fast decay
  };
  
  mems.push(mem);
  saveMemory(mems);
  return mem;
}

/**
 * Activates (recalls) a memory, increasing its strength and potentially promoting it.
 */
export function activateMemory(id: string): void {
  const mems = loadMemory();
  const mem = mems.find(m => m.id === id);
  if (!mem) return;

  mem.activationCount += 1;
  mem.lastActivated = Date.now();

  // Promotion logic
  if (mem.tier === "sensory" && mem.activationCount > 3) mem.tier = "working";
  else if (mem.tier === "working" && mem.activationCount > 10) mem.tier = "episodic";
  else if (mem.tier === "episodic" && mem.activationCount > 50) mem.tier = "semantic";
  else if (mem.tier === "semantic" && mem.activationCount > 100) mem.tier = "procedural";

  saveMemory(mems);
}

/**
 * Simulates sleep/consolidation. Demotes unused memories and culls dead ones.
 */
export function consolidateMemories(): void {
  initNeuromorphicMemory();
  let mems = loadMemory();
  const now = Date.now();

  mems = mems.filter(mem => {
    const hoursSinceActive = (now - mem.lastActivated) / (1000 * 60 * 60);
    const decayThreshold = 24 / mem.decayRate; // E.g., sensory decays in 240 hours if untouched

    if (hoursSinceActive > decayThreshold) {
      // Demote or forget
      if (mem.tier === "procedural") mem.tier = "semantic";
      else if (mem.tier === "semantic") mem.tier = "episodic";
      else if (mem.tier === "episodic") mem.tier = "working";
      else if (mem.tier === "working") mem.tier = "sensory";
      else return false; // Forget sensory
    }
    return true;
  });

  saveMemory(mems);
}
