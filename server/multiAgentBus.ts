/**
 * multiAgentBus.ts — Multi-Agent Collaboration Bus (v11.0.0)
 * Breaks Andromeda into specialized sub-agents (Planner, Coder, Reviewer, Tester)
 * that collaborate over an internal async message bus. Each agent has a role,
 * a message queue, and can publish/subscribe to typed events.
 */

export type AgentRole = 'planner' | 'coder' | 'reviewer' | 'tester' | 'orchestrator';

export interface AgentMessage {
  id: string;
  from: AgentRole;
  to: AgentRole | 'broadcast';
  type: 'task' | 'result' | 'review' | 'approval' | 'rejection' | 'status';
  payload: unknown;
  timestamp: number;
  correlationId?: string;
}

export interface AgentState {
  role: AgentRole;
  status: 'idle' | 'busy' | 'waiting';
  tasksCompleted: number;
  lastActivity: number;
}

type MessageHandler = (msg: AgentMessage) => void | Promise<void>;

const agents = new Map<AgentRole, AgentState>();
const subscribers = new Map<AgentRole, MessageHandler[]>();
const messageLog: AgentMessage[] = [];
let msgCounter = 0;

function makeId(): string {
  return `msg_${++msgCounter}_${Date.now()}`;
}

/**
 * Register an agent with the bus.
 */
export function registerAgent(role: AgentRole): void {
  agents.set(role, {
    role,
    status: 'idle',
    tasksCompleted: 0,
    lastActivity: Date.now(),
  });
  if (!subscribers.has(role)) {
    subscribers.set(role, []);
  }
}

/**
 * Subscribe an agent to incoming messages.
 */
export function subscribe(role: AgentRole, handler: MessageHandler): void {
  if (!subscribers.has(role)) {
    subscribers.set(role, []);
  }
  subscribers.get(role)!.push(handler);
}

/**
 * Publish a message to a specific agent or broadcast to all.
 */
export async function publish(
  from: AgentRole,
  to: AgentRole | 'broadcast',
  type: AgentMessage['type'],
  payload: unknown,
  correlationId?: string
): Promise<AgentMessage> {
  const msg: AgentMessage = {
    id: makeId(),
    from,
    to,
    type,
    payload,
    timestamp: Date.now(),
    correlationId,
  };

  messageLog.push(msg);

  // Update sender state
  const senderState = agents.get(from);
  if (senderState) {
    senderState.lastActivity = Date.now();
  }

  // Deliver to target(s)
  if (to === 'broadcast') {
    const deliveries: Promise<void>[] = [];
    for (const [role, handlers] of subscribers) {
      if (role !== from) {
        for (const handler of handlers) {
          deliveries.push(Promise.resolve(handler(msg)));
        }
      }
    }
    await Promise.all(deliveries);
  } else {
    const handlers = subscribers.get(to) ?? [];
    for (const handler of handlers) {
      await Promise.resolve(handler(msg));
    }
  }

  return msg;
}

/**
 * Update an agent's status.
 */
export function setAgentStatus(role: AgentRole, status: AgentState['status']): void {
  const state = agents.get(role);
  if (state) {
    state.status = status;
    state.lastActivity = Date.now();
    if (status === 'idle') state.tasksCompleted++;
  }
}

/**
 * Get all agent states.
 */
export function getAgentStates(): AgentState[] {
  return Array.from(agents.values());
}

/**
 * Get message log (for debugging / audit).
 */
export function getMessageLog(limit = 50): AgentMessage[] {
  return messageLog.slice(-limit);
}

/**
 * Clear the bus (for testing).
 */
export function resetBus(): void {
  agents.clear();
  subscribers.clear();
  messageLog.length = 0;
  msgCounter = 0;
}

/**
 * High-level orchestration: run a task through the full Planner → Coder → Reviewer → Tester pipeline.
 * Returns the final approved result or a rejection reason.
 */
export async function orchestrate(
  task: string,
  handlers: {
    planner: (task: string) => Promise<string[]>;
    coder: (plan: string[]) => Promise<string>;
    reviewer: (code: string) => Promise<{ approved: boolean; feedback: string }>;
    tester: (code: string) => Promise<{ passed: boolean; report: string }>;
  }
): Promise<{ success: boolean; result: string; log: AgentMessage[] }> {
  // Register all agents
  (['orchestrator', 'planner', 'coder', 'reviewer', 'tester'] as AgentRole[]).forEach(registerAgent);

  const correlationId = `orch_${Date.now()}`;

  // Step 1: Planner
  await publish('orchestrator', 'planner', 'task', task, correlationId);
  setAgentStatus('planner', 'busy');
  const plan = await handlers.planner(task);
  setAgentStatus('planner', 'idle');
  await publish('planner', 'coder', 'result', plan, correlationId);

  // Step 2: Coder
  setAgentStatus('coder', 'busy');
  const code = await handlers.coder(plan);
  setAgentStatus('coder', 'idle');
  await publish('coder', 'reviewer', 'result', code, correlationId);

  // Step 3: Reviewer
  setAgentStatus('reviewer', 'busy');
  const review = await handlers.reviewer(code);
  setAgentStatus('reviewer', 'idle');

  if (!review.approved) {
    await publish('reviewer', 'orchestrator', 'rejection', review.feedback, correlationId);
    return { success: false, result: review.feedback, log: getMessageLog() };
  }

  await publish('reviewer', 'tester', 'approval', code, correlationId);

  // Step 4: Tester
  setAgentStatus('tester', 'busy');
  const testResult = await handlers.tester(code);
  setAgentStatus('tester', 'idle');

  if (!testResult.passed) {
    await publish('tester', 'orchestrator', 'rejection', testResult.report, correlationId);
    return { success: false, result: testResult.report, log: getMessageLog() };
  }

  await publish('tester', 'orchestrator', 'approval', testResult.report, correlationId);
  return { success: true, result: code, log: getMessageLog() };
}
