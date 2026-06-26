import fs from "fs";
import path from "path";
import crypto from "crypto";

const FEDERATED_DB = path.join(process.cwd(), "data", "federated_knowledge.json");

export interface KnowledgeNode {
  id: string;
  pattern: string;
  solution: string;
  successRate: number;
  merkleHash: string;
  timestamp: number;
}

function loadFederatedGraph(): Record<string, KnowledgeNode> {
  if (fs.existsSync(FEDERATED_DB)) {
    try {
      return JSON.parse(fs.readFileSync(FEDERATED_DB, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveFederatedGraph(graph: Record<string, KnowledgeNode>) {
  const dir = path.dirname(FEDERATED_DB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FEDERATED_DB, JSON.stringify(graph, null, 2));
}

function generateHash(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Publishes a highly successful pattern to the federated knowledge graph.
 * Uses Merkle hashing for integrity verification.
 */
export function publishToFederatedGraph(pattern: string, solution: string, successRate: number): string {
  const graph = loadFederatedGraph();
  const id = `kn_${Date.now()}`;
  
  const node: KnowledgeNode = {
    id,
    pattern,
    solution,
    successRate,
    merkleHash: generateHash(`${pattern}:${solution}:${successRate}`),
    timestamp: Date.now()
  };
  
  graph[id] = node;
  saveFederatedGraph(graph);
  console.log(`[FederatedKnowledge] Published pattern ${id} with success rate ${(successRate * 100).toFixed(1)}%`);
  return id;
}

/**
 * Queries the federated knowledge graph for solutions to a specific pattern.
 * Verifies the Merkle hash before returning the solution to ensure integrity.
 */
export function queryFederatedGraph(patternKeyword: string): KnowledgeNode | null {
  const graph = loadFederatedGraph();
  
  // Find the highest success rate node matching the pattern
  const matches = Object.values(graph)
    .filter(n => n.pattern.toLowerCase().includes(patternKeyword.toLowerCase()))
    .sort((a, b) => b.successRate - a.successRate);
    
  if (matches.length === 0) return null;
  
  const bestMatch = matches[0];
  
  // Verify integrity
  const expectedHash = generateHash(`${bestMatch.pattern}:${bestMatch.solution}:${bestMatch.successRate}`);
  if (expectedHash !== bestMatch.merkleHash) {
    console.warn(`[FederatedKnowledge] Integrity check failed for node ${bestMatch.id}. Discarding.`);
    return null;
  }
  
  console.log(`[FederatedKnowledge] Found verified solution for pattern: ${patternKeyword}`);
  return bestMatch;
}

/**
 * Simulates the gossip protocol syncing with other Andromeda instances.
 */
export function syncFederatedGossip() {
  console.log(`[FederatedKnowledge] Syncing gossip protocol with peer instances...`);
  // Mock implementation for the gossip sync
  return true;
}
