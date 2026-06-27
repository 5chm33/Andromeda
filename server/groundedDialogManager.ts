/**
 * groundedDialogManager.ts — v94.0.0 "Emergent Communication & Language Grounding"
 * Manages grounded dialog sessions with context tracking and reference resolution.
 */
export interface DialogContext {
  contextId: string;
  sessionId: string;
  entities: Map<string, { type: string; attributes: Record<string, unknown> }>;
  recentTopics: string[];
  sharedBeliefs: Record<string, boolean>;
  turnCount: number;
  lastUpdatedAt: number;
}

export interface DialogTurn {
  turnId: string;
  sessionId: string;
  speakerId: string;
  utterance: string;
  resolvedReferences: Record<string, string>;
  groundedEntities: string[];
  responseGenerated: string;
  groundingScore: number;
  timestamp: number;
}

const contexts = new Map<string, DialogContext>();
const turns: DialogTurn[] = [];
let contextCounter = 0;
let turnCounter = 0;

export function createDialogContext(sessionId: string): DialogContext {
  const ctx: DialogContext = { contextId: `dc-${++contextCounter}`, sessionId, entities: new Map(), recentTopics: [], sharedBeliefs: {}, turnCount: 0, lastUpdatedAt: Date.now() };
  contexts.set(sessionId, ctx);
  return ctx;
}

export function processDialogTurn(sessionId: string, speakerId: string, utterance: string, entities: Array<{ name: string; type: string; attributes: Record<string, unknown> }> = []): DialogTurn | null {
  let ctx = contexts.get(sessionId);
  if (!ctx) ctx = createDialogContext(sessionId);

  // Register entities
  const groundedEntities: string[] = [];
  for (const entity of entities) {
    ctx.entities.set(entity.name, { type: entity.type, attributes: entity.attributes });
    groundedEntities.push(entity.name);
  }

  // Resolve pronouns/references
  const resolvedReferences: Record<string, string> = {};
  const tokens = utterance.split(/\s+/);
  for (const token of tokens) {
    if (["it", "this", "that", "they", "them"].includes(token.toLowerCase())) {
      const lastEntity = [...ctx.entities.keys()].slice(-1)[0];
      if (lastEntity) resolvedReferences[token] = lastEntity;
    }
  }

  const groundingScore = entities.length > 0 ? Math.min(1.0, 0.5 + entities.length * 0.1) : 0.3;
  const responseGenerated = `Acknowledged: "${utterance.slice(0, 50)}${utterance.length > 50 ? "..." : ""}"`;

  ctx.turnCount++;
  ctx.lastUpdatedAt = Date.now();

  const turn: DialogTurn = { turnId: `dt-${++turnCounter}`, sessionId, speakerId, utterance, resolvedReferences, groundedEntities, responseGenerated, groundingScore, timestamp: Date.now() };
  turns.push(turn);
  return turn;
}

export function getContext(sessionId: string): DialogContext | undefined { return contexts.get(sessionId); }
export function getTurns(sessionId: string): DialogTurn[] { return turns.filter(t => t.sessionId === sessionId); }
export function addSharedBelief(sessionId: string, belief: string, value: boolean): void { const ctx = contexts.get(sessionId); if (ctx) ctx.sharedBeliefs[belief] = value; }
export function _resetGroundedDialogManagerForTest(): void { contexts.clear(); turns.length = 0; contextCounter = 0; turnCounter = 0; }
