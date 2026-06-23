/**
 * capabilityDiscovery.ts — Proactive Capability Discovery
 * Andromeda v5.68
 *
 * Proactively discovers new capabilities Andromeda could develop:
 * - Scans tool list for combination opportunities
 * - Analyzes conversation history for failed tasks
 * - Generates capability proposals (new features, not just bug fixes)
 * - Tracks capability gaps identified by users
 */

import * as fs from "fs";
import * as path from "path";
import { backgroundChatCompletion } from "./llmProvider.js"; // v6.16: cheap background provider
import { storeMemory, searchMemory } from "./memory.js";
import { getAllTools } from "./tools/toolRegistry.js";

const CAPABILITY_PROPOSALS_PATH = path.join(process.cwd(), "data", "capability_proposals.jsonl");
const DISCOVERY_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface CapabilityProposal {
  id: string;
  timestamp: string;
  title: string;
  description: string;
  motivation: string; // Why this capability is needed
  implementationApproach: string;
  estimatedComplexity: "low" | "medium" | "high";
  estimatedImpact: "low" | "medium" | "high";
  status: "proposed" | "in_progress" | "implemented" | "rejected";
  relatedTools: string[];
  tags: string[];
}

let discoveryTimer: ReturnType<typeof setInterval> | null = null;

function ensureDataDir(): void {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function generateId(): string {
  return `cap_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
}

/**
 * Store a capability proposal.
 */
export function storeCapabilityProposal(proposal: Omit<CapabilityProposal, "id" | "timestamp">): CapabilityProposal {
  ensureDataDir();
  const full: CapabilityProposal = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    ...proposal,
  };
  fs.appendFileSync(CAPABILITY_PROPOSALS_PATH, JSON.stringify(full) + "\n", "utf-8");
  return full;
}

/**
 * Get all capability proposals.
 */
export function getCapabilityProposals(status?: CapabilityProposal["status"]): CapabilityProposal[] {
  ensureDataDir();
  try {
    if (!fs.existsSync(CAPABILITY_PROPOSALS_PATH)) return [];
    const lines = fs.readFileSync(CAPABILITY_PROPOSALS_PATH, "utf-8").trim().split("\n").filter(Boolean);
    const proposals = lines
      .map((l) => { try { return JSON.parse(l) as CapabilityProposal; } catch (e) { console.warn("[CapabilityDiscovery] Error parsing proposal JSON:", (e as Error).message); return null; } })
      .filter((p): p is CapabilityProposal => p !== null);
    return status ? proposals.filter((p) => p.status === status) : proposals;
  } catch (e) {
    console.error("[CapabilityDiscovery] Error reading capability proposals file:", (e as Error).message);
    return [];
  }
}

/**
 * Run a capability discovery cycle.
 */
async function runDiscoveryCycle(): Promise<void> {
  console.log("[CapabilityDiscovery] Starting discovery cycle...");

  // Get current tool list
  const tools = getAllTools();
  const toolNames = tools.map((t) => t.name).join(", ");

  // Search memory for capability gaps
  let capabilityGaps = "";
  try {
    const results = await searchMemory("capability gap missing feature user needed", 5);
    capabilityGaps = results.map((r) => r.entry.content).join("\n");
  } catch {
    // Non-fatal
  }

  // Get recent proposals to avoid duplicates
  const existingProposals = getCapabilityProposals("proposed")
    .slice(-10)
    .map((p) => p.title)
    .join(", ");

  const systemInstruction = `You are Andromeda analyzing your own capabilities to discover what you should build next.`;
  const toolsSection = `## Current Tools Available\n${toolNames}`; 
  const gapsSection = `## Known Capability Gaps (from memory)\n${capabilityGaps || "None recorded yet"}`;
  const proposedSection = `## Already Proposed (avoid duplicates)\n${existingProposals || "None yet"}`;
  const taskInstruction = `## Discovery Task\nAnalyze the above and identify 2-3 high-value capabilities that would significantly improve your autonomy or usefulness. For each, provide:\n\nReturn as JSON array:\n[\n  {\n    "title": "Short capability name",\n    "description": "What it does",\n    "motivation": "Why users need this / what failures it prevents",\n    "implementationApproach": "How to implement it (1-2 sentences)",\n    "estimatedComplexity": "low|medium|high",\n    "estimatedImpact": "low|medium|high",\n    "relatedTools": ["tool1", "tool2"],\n    "tags": ["tag1", "tag2"]\n  }\n]\n\nFocus on capabilities that: (1) combine existing tools in new ways, (2) address known failure patterns, or (3) fill obvious gaps in the tool list.`;

  const prompt = [
    systemInstruction,
    toolsSection,
    gapsSection,
    proposedSection,
    taskInstruction
  ].join('\n\n');

  try {
    const response = await backgroundChatCompletion([{ role: "user", content: prompt }], {
      maxTokens: 800,
      temperature: 0.4,
    }); // v6.16: routes to DeepSeek, not OpenRouter

    const content = response.content || "[]";
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const proposals: Omit<CapabilityProposal, "id" | "timestamp" | "status">[] = JSON.parse(jsonMatch[0]);

    for (const proposal of proposals) {
      const stored = storeCapabilityProposal({ ...proposal, status: "proposed" });
      console.log(`[CapabilityDiscovery] New proposal: "${stored.title}" (${stored.estimatedImpact} impact, ${stored.estimatedComplexity} complexity)`);

      // Store in memory for future reference
      storeMemory(
        `Capability proposal: "${stored.title}" — ${stored.description}. Motivation: ${stored.motivation}`,
        "fact",
        ["capability-discovery", "proposal", ...stored.tags]
      );
    }
  } catch (err) {
    console.warn("[CapabilityDiscovery] Discovery cycle failed:", (err as Error).message);
  }
}

/**
 * Record a user-identified capability gap.
 */
export async function recordCapabilityGap(description: string, context: string): Promise<void> {
  ensureDataDir();

  storeMemory(
    `User-identified capability gap: ${description}. Context: ${context}`,
    "fact",
    ["capability-gap", "user-feedback", "improvement"]
  );

  storeCapabilityProposal({
    title: `User-requested: ${description.substring(0, 50)}`,
    description,
    motivation: `User encountered this gap in context: ${context}`,
    implementationApproach: "To be determined during implementation",
    estimatedComplexity: "medium",
    estimatedImpact: "high",
    status: "proposed",
    relatedTools: [],
    tags: ["user-requested", "capability-gap"],
  });
}

/**
 * Get capability discovery stats for the diagnostic endpoint.
 */
export function getCapabilityStats(): {
  totalProposals: number;
  proposed: number;
  implemented: number;
  inProgress: number;
} {
  const all = getCapabilityProposals();
  return {
    totalProposals: all.length,
    proposed: all.filter((p) => p.status === "proposed").length,
    implemented: all.filter((p) => p.status === "implemented").length,
    inProgress: all.filter((p) => p.status === "in_progress").length,
  };
}

/**
 * Start the Capability Discovery daemon.
 */
export function startCapabilityDiscovery(): void {
  ensureDataDir();
  console.log("[CapabilityDiscovery] Daemon started (interval: 4 hours)");

  // First run after 15 minutes
  setTimeout(() => {
    runDiscoveryCycle().catch(() => {});
  }, 15 * 60 * 1000);

  discoveryTimer = setInterval(() => {
    runDiscoveryCycle().catch(() => {});
  }, DISCOVERY_INTERVAL_MS);
}

/**
 * Stop the Capability Discovery daemon.
 */
export function stopCapabilityDiscovery(): void {
  if (discoveryTimer) {
    clearInterval(discoveryTimer);
    discoveryTimer = null;
  }
}
