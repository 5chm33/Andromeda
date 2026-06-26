/**
 * researchCollab.ts — v21.0.0
 * 
 * Multi-Agent Collaborative Research.
 * Orchestrates a team of 4 specialized LLM personas (Theorist, Implementer, Critic, Synthesizer)
 * to debate and refine architectural proposals before implementation.
 */

import { getApiKey, getApiUrl, getProviderHeaders } from "./aiTokens.js";

export interface CollabProposal {
  id: string;
  topic: string;
  theory: string;
  implementation: string;
  critique: string;
  synthesis: string;
  consensusReached: boolean;
}

async function callAgent(persona: string, prompt: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) return `[Simulated ${persona} Response]`;

  const systemPrompts: Record<string, string> = {
    Theorist: "You are the Theorist. Propose high-level architectural paradigm shifts. Focus on abstract concepts, algorithms, and data structures.",
    Implementer: "You are the Implementer. Translate the Theorist's abstract ideas into concrete TypeScript code. Focus on edge cases and performance.",
    Critic: "You are the Critic. Attack the Implementer's code and the Theorist's assumptions. Find security flaws, race conditions, and performance bottlenecks.",
    Synthesizer: "You are the Synthesizer. Review the Theory, Implementation, and Critique. Resolve the conflicts and output the final, robust proposal. If the critique is fatal, declare consensus failed."
  };

  try {
    const response = await fetch(`${getApiUrl()}/chat/completions`, {
      method: "POST",
      headers: getProviderHeaders(),
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompts[persona] || "You are an AI assistant." },
          { role: "user", content: prompt }
        ]
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (response.ok) {
      const data = await response.json() as any;
      return data.choices?.[0]?.message?.content || "";
    }
  } catch {}
  
  return `[Simulated ${persona} Response]`;
}

/**
 * Runs a full collaborative research cycle on a given topic.
 */
export async function runCollaborativeResearch(topic: string): Promise<CollabProposal> {
  console.log(`[ResearchCollab] Starting research cycle on: ${topic}`);

  // 1. Theorist
  const theory = await callAgent("Theorist", `Propose a novel architectural solution for: ${topic}`);
  
  // 2. Implementer
  const implementation = await callAgent("Implementer", `Here is the theory:\n${theory}\n\nProvide the concrete TypeScript implementation.`);
  
  // 3. Critic
  const critique = await callAgent("Critic", `Here is the theory:\n${theory}\n\nHere is the implementation:\n${implementation}\n\nCritique this proposal mercilessly.`);
  
  // 4. Synthesizer
  const synthesisPrompt = `
    Theory:\n${theory}\n\n
    Implementation:\n${implementation}\n\n
    Critique:\n${critique}\n\n
    Synthesize the final proposal. If the critique found fatal flaws that cannot be easily fixed, start your response with "CONSENSUS_FAILED". Otherwise, provide the final refined code.
  `;
  const synthesis = await callAgent("Synthesizer", synthesisPrompt);

  const consensusReached = !synthesis.startsWith("CONSENSUS_FAILED");

  return {
    id: `collab-${Date.now()}`,
    topic,
    theory,
    implementation,
    critique,
    synthesis,
    consensusReached
  };
}
