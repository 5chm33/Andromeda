/**
 * dialogueManager.ts — v60.0.0 "The Communication Layer"
 * Manages multi-turn dialogue state with slot tracking and clarification requests.
 */

export interface DialogueTurn { turnId: string; speaker: "user" | "agent"; utterance: string; timestamp: number; }
export interface DialogueSession {
  sessionId: string;
  turns: DialogueTurn[];
  currentIntent: string;
  filledSlots: Record<string, string>;
  pendingSlots: string[];
  state: "active" | "completed" | "abandoned";
}

const sessions = new Map<string, DialogueSession>();
let sessCounter = 0, turnCounter = 0;

export function createSession(initialIntent: string, requiredSlots: string[]): DialogueSession {
  const session: DialogueSession = {
    sessionId: `sess-${++sessCounter}`,
    turns: [],
    currentIntent: initialIntent,
    filledSlots: {},
    pendingSlots: [...requiredSlots],
    state: "active",
  };
  sessions.set(session.sessionId, session);
  return session;
}

export function addTurn(sessionId: string, speaker: "user" | "agent", utterance: string): DialogueTurn {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`[DialogueManager] Session not found: ${sessionId}`);
  const turn: DialogueTurn = { turnId: `turn-${++turnCounter}`, speaker, utterance, timestamp: Date.now() };
  session.turns.push(turn);
  return turn;
}

export function fillSlot(sessionId: string, slot: string, value: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.filledSlots[slot] = value;
  session.pendingSlots = session.pendingSlots.filter(s => s !== slot);
  if (session.pendingSlots.length === 0) session.state = "completed";
}

export function getSession(sessionId: string): DialogueSession | null { return sessions.get(sessionId) ?? null; }
export function _resetDialogueManagerForTest(): void { sessions.clear(); sessCounter = 0; turnCounter = 0; }
