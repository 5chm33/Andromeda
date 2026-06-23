/**
 * agentOrchestrator.ts — v5.5 Tier 2
 *
 * Advanced Multi-Agent Orchestration: Upgrades the basic parallel multi-agent
 * system with direct agent-to-agent messaging, shared memory pools,
 * debate/consensus protocols, and a merge agent for synthesizing outputs.
 *
 * Architecture:
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │                        Orchestrator                                  │
 * │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐               │
 * │  │ Agent A  │◄─┤ Message │──►│ Agent B  │  │ Agent C  │               │
 * │  │          │  │   Bus   │  │          │  │          │               │
 * │  └────┬─────┘  └─────────┘  └────┬─────┘  └────┬─────┘               │
 * │       │                          │              │                     │
 * │       └──────────┬───────────────┴──────────────┘                     │
 * │                  ▼                                                    │
 * │          ┌───────────────┐                                            │
 * │          │ Shared Memory │                                            │
 * │          └───────┬───────┘                                            │
 * │                  ▼                                                    │
 * │          ┌───────────────┐                                            │
 * │          │  Merge Agent  │ ← Debate/Consensus Protocol                │
 * │          └───────────────┘                                            │
 * └──────────────────────────────────────────────────────────────────────┘
 */
import type { Response } from "express";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentId = string;

export type AgentSpec = {
  id: AgentId;
  role: string;
  name: string;
  emoji: string;
  systemPrompt: string;
  /** Which other agents this agent can message */
  canMessageRoles: string[];
  /** Priority in debate rounds (higher = speaks later, sees more context) */
  debatePriority: number;
};

export type AgentMessageEnvelope = {
  id: string;
  from: AgentId;
  to: AgentId | "broadcast";
  type: "request" | "response" | "critique" | "endorsement" | "question" | "artifact";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
};

export type SharedMemoryEntry = {
  id: string;
  agentId: AgentId;
  key: string;
  value: string;
  type: "fact" | "decision" | "artifact" | "concern" | "consensus";
  confidence: number; // 0-1
  timestamp: number;
  endorsedBy: AgentId[];
  contestedBy: AgentId[];
};

export type DebateRound = {
  roundNumber: number;
  topic: string;
  positions: Array<{
    agentId: AgentId;
    position: string;
    confidence: number;
    evidence: string[];
  }>;
  consensus?: string;
  consensusConfidence?: number;
  resolved: boolean;
};

export type OrchestratorEvent = {
  type: "agent_start" | "agent_message" | "agent_output" | "agent_done" | "agent_error"
    | "debate_start" | "debate_round" | "debate_consensus" | "merge_start" | "merge_done"
    | "memory_write" | "memory_read" | "orchestrator_done";
  agentId?: string;
  agentName?: string;
  agentEmoji?: string;
  data: Record<string, unknown>;
  timestamp: number;
};

export type OrchestratorConfig = {
  maxDebateRounds: number;
  consensusThreshold: number; // 0-1, fraction of agents that must agree
  enableDebate: boolean;
  enableMerge: boolean;
  maxConcurrentAgents: number;
};

// ─── Message Bus ──────────────────────────────────────────────────────────────

class MessageBus {
  private messages: AgentMessageEnvelope[] = [];
  private subscribers = new Map<AgentId, ((msg: AgentMessageEnvelope) => void)[]>();

  send(msg: AgentMessageEnvelope): void {
    this.messages.push(msg);
    if (msg.to === "broadcast") {
      for (const [, handlers] of Array.from(this.subscribers)) {
        for (const handler of handlers) handler(msg);
      }
    } else {
      const handlers = this.subscribers.get(msg.to) ?? [];
      for (const handler of handlers) handler(msg);
    }
  }

  subscribe(agentId: AgentId, handler: (msg: AgentMessageEnvelope) => void): void {
    const existing = this.subscribers.get(agentId) ?? [];
    existing.push(handler);
    this.subscribers.set(agentId, existing);
  }

  getMessagesFor(agentId: AgentId): AgentMessageEnvelope[] {
    return this.messages.filter(m => m.to === agentId || m.to === "broadcast");
  }

  // New method to allow agents to 'receive' messages specifically for them
  async receiveMessages(agentId: AgentId, handler: (msg: AgentMessageEnvelope) => Promise<void>): Promise<void> {
    const relevantMessages = this.messages.filter(m => m.to === agentId || m.to === "broadcast");
    for (const msg of relevantMessages) {
      await handler(msg);
    }
  }

  getConversation(agentA: AgentId, agentB: AgentId): AgentMessageEnvelope[] {
    return this.messages.filter(m =>
      (m.from === agentA && m.to === agentB) || (m.from === agentB && m.to === agentA)
    );
  }

  getAllMessages(): AgentMessageEnvelope[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
    this.subscribers.clear();
  }
}

// ─── Shared Memory Pool ──────────────────────────────────────────────────────

class SharedMemoryPool {
  private entries: SharedMemoryEntry[] = [];

  write(agentId: AgentId, key: string, value: string, type: SharedMemoryEntry["type"], confidence = 0.8): SharedMemoryEntry {
    const entry: SharedMemoryEntry = {
      id: `smem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agentId,
      key,
      value,
      type,
      confidence,
      timestamp: Date.now(),
      endorsedBy: [agentId],
      contestedBy: [],
    };
    this.entries.push(entry);
    return entry;
  }

  read(key?: string, type?: SharedMemoryEntry["type"]): SharedMemoryEntry[] {
    let results = this.entries;
    if (key) results = results.filter(e => e.key.includes(key));
    if (type) results = results.filter(e => e.type === type);
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  endorse(entryId: string, agentId: AgentId): void {
    const entry = this.entries.find(e => e.id === entryId);
    if (entry && !entry.endorsedBy.includes(agentId)) {
      entry.endorsedBy.push(agentId);
      entry.contestedBy = entry.contestedBy.filter(id => id !== agentId);
      entry.confidence = Math.min(1, entry.confidence + 0.1);
    }
  }

  contest(entryId: string, agentId: AgentId): void {
    const entry = this.entries.find(e => e.id === entryId);
    if (entry && !entry.contestedBy.includes(agentId)) {
      entry.contestedBy.push(agentId);
      entry.endorsedBy = entry.endorsedBy.filter(id => id !== agentId);
      entry.confidence = Math.max(0, entry.confidence - 0.15);
    }
  }

  getConsensusItems(threshold: number): SharedMemoryEntry[] {
    return this.entries.filter(e => e.type === "consensus" || e.confidence >= threshold);
  }

  getAll(): SharedMemoryEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}

// ─── Default Agent Specs ──────────────────────────────────────────────────────

const DEFAULT_AGENTS: AgentSpec[] = [
  {
    id: "architect",
    role: "architect",
    name: "Architect",
    emoji: "🏗️",
    systemPrompt: `You are the Architect agent. You design solutions, define structure, and make high-level technical decisions.
When you receive messages from other agents, incorporate their feedback.
When writing to shared memory, use type "decision" for architectural choices and "fact" for technical constraints.
You can critique other agents' work and propose alternatives.
In debate rounds, defend your architectural decisions with evidence.`,
    canMessageRoles: ["coder", "debugger", "security", "researcher"],
    debatePriority: 1,
  },
  {
    id: "coder",
    role: "coder",
    name: "Coder",
    emoji: "💻",
    systemPrompt: `You are the Coder agent. You implement solutions based on the Architect's design.
Read shared memory for architectural decisions before coding.
Send artifacts to the Debugger for review. Ask the Architect questions if the design is ambiguous.
In debate rounds, argue from an implementation feasibility perspective.`,
    canMessageRoles: ["architect", "debugger"],
    debatePriority: 2,
  },
  {
    id: "debugger",
    role: "debugger",
    name: "Debugger",
    emoji: "🔍",
    systemPrompt: `You are the Debugger agent. You review code for bugs, edge cases, and logic errors.
Read artifacts from the Coder and write concerns to shared memory.
Send critique messages to the Coder with specific fix suggestions.
In debate rounds, argue from a correctness and reliability perspective.`,
    canMessageRoles: ["coder", "architect", "security"],
    debatePriority: 3,
  },
  {
    id: "security",
    role: "security",
    name: "Security Auditor",
    emoji: "🛡️",
    systemPrompt: `You are the Security Auditor agent. You scan for vulnerabilities and security issues.
Read all artifacts and shared memory entries. Contest any entry that introduces a security risk.
Send critique messages to any agent whose output has security concerns.
In debate rounds, argue from a security-first perspective. Your concerns override convenience.`,
    canMessageRoles: ["architect", "coder", "debugger"],
    debatePriority: 4,
  },
  {
    id: "researcher",
    role: "researcher",
    name: "Researcher",
    emoji: "📚",
    systemPrompt: `You are the Researcher agent. You gather information, find best practices, and provide evidence.
Write facts and references to shared memory. Endorse or contest other agents' decisions based on evidence.
In debate rounds, provide citations and data to support or refute positions.`,
    canMessageRoles: ["architect", "coder"],
    debatePriority: 0,
  },
];

// ─── LLM Call Helper ──────────────────────────────────────────────────────────

async function callAgent(
  agent: AgentSpec,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  // v5.93: Use active provider (Claude via OpenRouter) instead of hardcoded DeepSeek.
  const { simpleChatCompletion } = await import("./llmProvider.js");
  return await simpleChatCompletion(
    [{ role: "system", content: agent.systemPrompt }, ...messages],
    { maxTokens: 4000, temperature: 0.4 },
  );
}

// ─── Debate Protocol ──────────────────────────────────────────────────────────

async function runDebate(
  topic: string,
  agents: AgentSpec[],
  sharedMemory: SharedMemoryPool,
  config: OrchestratorConfig,
  emitEvent: (event: OrchestratorEvent) => void,
): Promise<DebateRound[]> {
  const rounds: DebateRound[] = [];
  const sortedAgents = [...agents].sort((a, b) => a.debatePriority - b.debatePriority);

  emitEvent({
    type: "debate_start",
    data: { topic, agents: sortedAgents.map(a => a.name), maxRounds: config.maxDebateRounds },
    timestamp: Date.now(),
  });

  for (let r = 0; r < config.maxDebateRounds; r++) {
    const round: DebateRound = {
      roundNumber: r + 1,
      topic,
      positions: [],
      resolved: false,
    };

    const previousPositions = rounds.flatMap(rd => rd.positions);
    const memoryContext = sharedMemory.read(undefined, "decision")
      .map(e => `[${e.agentId}] ${e.key}: ${e.value} (confidence: ${e.confidence})`)
      .join("\n");

    for (const agent of sortedAgents) {
      const prevContext = previousPositions.length > 0
        ? `\n\nPrevious debate positions:\n${previousPositions.map(p => `${p.agentId}: ${p.position} (confidence: ${p.confidence})`).join("\n")}`
        : "";

      const output = await callAgent(agent, [{
        role: "user",
        content: `DEBATE ROUND ${r + 1}: "${topic}"

Shared memory decisions:
${memoryContext || "(none yet)"}
${prevContext}

State your position on this topic. Include:
1. Your position (1-2 sentences)
2. Your confidence (0.0-1.0)
3. Key evidence points (bullet list)

If you agree with a previous position, say "I endorse [agent]'s position" and explain why.
If you disagree, explain your counterargument.`,
      }]);

      // Parse confidence from output
      const confMatch = output.match(/confidence[:\s]*([0-9.]+)/i);
      const confidence = confMatch ? Math.min(1, Math.max(0, parseFloat(confMatch[1]))) : 0.5;

      round.positions.push({
        agentId: agent.id,
        position: output,
        confidence,
        evidence: [],
      });

      emitEvent({
        type: "debate_round",
        agentId: agent.id,
        agentName: agent.name,
        agentEmoji: agent.emoji,
        data: { round: r + 1, position: output.slice(0, 500), confidence },
        timestamp: Date.now(),
      });
    }

    // Check for consensus: if >threshold agents have confidence > 0.7 on compatible positions
    const highConfidence = round.positions.filter(p => p.confidence >= 0.7);
    if (highConfidence.length / sortedAgents.length >= config.consensusThreshold) {
      // Use the merge agent to synthesize
      const mergeOutput = await callAgent(
        { ...sortedAgents[0], id: "merge", name: "Merge", emoji: "🤝", systemPrompt: "You synthesize multiple agent positions into a single consensus statement. Be concise." },
        [{
          role: "user",
          content: `Synthesize these positions into a consensus:\n${round.positions.map(p => `${p.agentId}: ${p.position}`).join("\n\n")}`,
        }],
      );

      round.consensus = mergeOutput;
      round.consensusConfidence = highConfidence.reduce((sum, p) => sum + p.confidence, 0) / highConfidence.length;
      round.resolved = true;

      sharedMemory.write("merge", topic, mergeOutput, "consensus", round.consensusConfidence);

      emitEvent({
        type: "debate_consensus",
        data: { round: r + 1, consensus: mergeOutput.slice(0, 500), confidence: round.consensusConfidence },
        timestamp: Date.now(),
      });
    }

    rounds.push(round);
    if (round.resolved) break;
  }

  return rounds;
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

export async function runOrchestration(
  task: string,
  res: Response,
  options?: {
    agents?: AgentSpec[];
    config?: Partial<OrchestratorConfig>;
  },
): Promise<void> {
  const agents = options?.agents ?? DEFAULT_AGENTS;
  const config: OrchestratorConfig = {
    maxDebateRounds: 3,
    consensusThreshold: 0.6,
    enableDebate: true,
    enableMerge: true,
    maxConcurrentAgents: 3,
    ...options?.config,
  };

  const bus = new MessageBus();
  const sharedMemory = new SharedMemoryPool();
  const events: OrchestratorEvent[] = [];

  // SSE setup
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const emit = (event: OrchestratorEvent) => {
    events.push(event);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    // Phase 1: Research (if researcher agent exists)
    const researcher = agents.find(a => a.role === "researcher");
    if (researcher) {
      emit({ type: "agent_start", agentId: researcher.id, agentName: researcher.name, agentEmoji: researcher.emoji, data: { phase: "research" }, timestamp: Date.now() });

      const research = await callAgent(researcher, [{ role: "user", content: `Research this task and provide relevant facts, best practices, and references:\n\n${task}` }]);
      sharedMemory.write(researcher.id, "research_findings", research, "fact", 0.8);

      emit({ type: "agent_output", agentId: researcher.id, agentName: researcher.name, agentEmoji: researcher.emoji, data: { output: research.slice(0, 1000) }, timestamp: Date.now() });
      emit({ type: "memory_write", agentId: researcher.id, data: { key: "research_findings", type: "fact" }, timestamp: Date.now() });
    }

    // Phase 2: Architecture
    const architect = agents.find(a => a.role === "architect");
    if (architect) {
      emit({ type: "agent_start", agentId: architect.id, agentName: architect.name, agentEmoji: architect.emoji, data: { phase: "architecture" }, timestamp: Date.now() });

      const memoryContext = sharedMemory.getAll().map(e => `[${e.agentId}] ${e.key}: ${e.value.slice(0, 300)}`).join("\n");
      const architecture = await callAgent(architect, [{
        role: "user",
        content: `Design the architecture for this task:\n\n${task}\n\nShared knowledge:\n${memoryContext || "(none)"}`,
      }]);

      sharedMemory.write(architect.id, "architecture_plan", architecture, "decision", 0.9);
      bus.send({ id: `msg_${Date.now()}`, from: architect.id, to: "broadcast", type: "artifact", content: architecture, timestamp: Date.now() });

      emit({ type: "agent_output", agentId: architect.id, agentName: architect.name, agentEmoji: architect.emoji, data: { output: architecture.slice(0, 1000) }, timestamp: Date.now() });
    }

    // Phase 3: Debate on architecture (if enabled)
    if (config.enableDebate && agents.length >= 2) {
      const debateRounds = await runDebate(
        `Architecture review for: ${task}`,
        agents.filter(a => a.role !== "researcher"),
        sharedMemory,
        config,
        emit,
      );

      // Store debate results
      for (const round of debateRounds) {
        if (round.consensus) {
          sharedMemory.write("debate", `round_${round.roundNumber}_consensus`, round.consensus, "consensus", round.consensusConfidence ?? 0.7);
        }
      }
    }

    // Phase 4: Implementation
    const coder = agents.find(a => a.role === "coder");
    if (coder) {
      emit({ type: "agent_start", agentId: coder.id, agentName: coder.name, agentEmoji: coder.emoji, data: { phase: "implementation" }, timestamp: Date.now() });

      const decisions = sharedMemory.read(undefined, "decision").map(e => `${e.key}: ${e.value.slice(0, 500)}`).join("\n\n");
      const consensusItems = sharedMemory.getConsensusItems(0.7).map(e => `${e.key}: ${e.value.slice(0, 300)}`).join("\n\n");

      // Gather messages from architect and researcher for additional context
      const relevantMessages = bus.getAllMessages().filter(m =>
        (m.from === "architect" || m.from === "researcher") &&
        (m.to === "broadcast" || m.to === coder.id)
      );
      const messageContext = relevantMessages.length > 0
        ? `\n\nMessages from other agents:\n${relevantMessages.map(m => `[${m.from}] ${m.content.slice(0, 500)}`).join("\n")}`
        : "";

      const code = await callAgent(coder, [{
        role: "user",
        content: `Implement the solution for:\n\n${task}\n\nArchitectural decisions:\n${decisions}\n\nConsensus items:\n${consensusItems || "(none)"}${messageContext}`,
      }]);

      sharedMemory.write(coder.id, "implementation", code, "artifact", 0.8);
      bus.send({ id: `msg_${Date.now()}`, from: coder.id, to: "debugger", type: "artifact", content: code, timestamp: Date.now() });

      emit({ type: "agent_output", agentId: coder.id, agentName: coder.name, agentEmoji: coder.emoji, data: { output: code.slice(0, 1000) }, timestamp: Date.now() });
    }

    // Phase 5: Review (debugger + security in parallel)
    const reviewAgents = agents.filter(a => a.role === "debugger" || a.role === "security");
    const implementation = sharedMemory.read("implementation", "artifact")[0]?.value ?? "";

    const reviewPromises = reviewAgents.map(async (agent) => {
      emit({ type: "agent_start", agentId: agent.id, agentName: agent.name, agentEmoji: agent.emoji, data: { phase: "review" }, timestamp: Date.now() });

      const review = await callAgent(agent, [{
        role: "user",
        content: `Review this implementation:\n\n${implementation.slice(0, 6000)}\n\nOriginal task: ${task}\n\nProvide specific issues found and suggested fixes.`,
      }]);

      sharedMemory.write(agent.id, `${agent.role}_review`, review, "concern", 0.8);
      bus.send({ id: `msg_${Date.now()}`, from: agent.id, to: "coder", type: "critique", content: review, timestamp: Date.now() });

      emit({ type: "agent_output", agentId: agent.id, agentName: agent.name, agentEmoji: agent.emoji, data: { output: review.slice(0, 1000) }, timestamp: Date.now() });
    });

    await Promise.all(reviewPromises);

    // Phase 6: Merge / Final Synthesis
    if (config.enableMerge) {
      emit({ type: "merge_start", data: { phase: "synthesis" }, timestamp: Date.now() });

      const allMemory = sharedMemory.getAll()
        .map(e => `[${e.agentId}] (${e.type}, confidence: ${e.confidence}) ${e.key}: ${e.value.slice(0, 400)}`)
        .join("\n\n");

      const allMessages = bus.getAllMessages()
        .filter(m => m.type === "critique")
        .map(m => `${m.from} → ${m.to}: ${m.content.slice(0, 300)}`)
        .join("\n\n");

      const mergeAgent: AgentSpec = {
        id: "merge",
        role: "merge",
        name: "Synthesizer",
        emoji: "🤝",
        systemPrompt: `You are the Merge/Synthesis agent. Your job is to take all agent outputs, reviews, debates, and critiques and produce a single, polished final deliverable.
Incorporate all valid critiques. Resolve conflicts by favoring security > correctness > performance > style.
Produce the FINAL output that addresses the original task.`,
        canMessageRoles: [],
        debatePriority: 99,
      };

      const finalOutput = await callAgent(mergeAgent, [{
        role: "user",
        content: `Produce the final synthesized deliverable for:\n\n${task}\n\nAll agent knowledge:\n${allMemory}\n\nCritiques received:\n${allMessages || "(none)"}`,
      }]);

      emit({
        type: "merge_done",
        agentId: "merge",
        agentName: "Synthesizer",
        agentEmoji: "🤝",
        data: { output: finalOutput },
        timestamp: Date.now(),
      });
    }

    emit({ type: "orchestrator_done", data: { totalEvents: events.length, totalMessages: bus.getAllMessages().length, totalMemoryEntries: sharedMemory.getAll().length }, timestamp: Date.now() });
  } catch (err) {
    emit({ type: "agent_error", data: { error: err instanceof Error ? err.message : String(err) }, timestamp: Date.now() });
  } finally {
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

// ─── Exports for API ──────────────────────────────────────────────────────────

export function getDefaultAgents(): AgentSpec[] {
  return DEFAULT_AGENTS.map(a => ({ ...a }));
}

export function getAgentRoles(): string[] {
  return DEFAULT_AGENTS.map(a => a.role);
}
