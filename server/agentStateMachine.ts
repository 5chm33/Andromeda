/**
 * agentStateMachine.ts — v6.26
 * AgentStateMachine class and AgentState type.
 * Extracted from reactEngine.ts (god-module split).
 */

// ─── v6.18: Agent State Machine ───────────────────────────────────────────────
// Replaces ad-hoc boolean flags with a proper state machine.
// States: IDLE → THINKING → TOOL_CALL → TOOL_RESULT → RESPONDING → DONE | ERROR
// Guards still exist as plugins but state transitions are now explicit.
export type AgentState =
  | "IDLE"          // waiting for input
  | "THINKING"      // model is generating a response
  | "TOOL_CALL"     // model requested a tool call, executing
  | "TOOL_RESULT"   // tool returned, injecting result into context
  | "RESPONDING"    // model is generating final text response
  | "HUMAN_PAUSE"   // waiting for human input (clarification)
  | "DONE"          // task complete
  | "ERROR"         // unrecoverable error
  | "GUARD_BLOCKED" // a guard blocked the current action, retrying

export interface StateTransition {
  from: AgentState;
  to: AgentState;
  reason: string;
  timestamp: number;
}

export class AgentStateMachine {
  private _state: AgentState = "IDLE";
  private _history: StateTransition[] = [];
  private _maxHistory = 50;
  private _onTransition?: (transition: StateTransition) => void;

  get state(): AgentState { return this._state; }
  get history(): StateTransition[] { return [...this._history]; }

  set onTransition(callback: ((transition: StateTransition) => void) | undefined) {
    this._onTransition = callback;
  }

  /**
   * Valid state transitions for the ReAct agent loop.
   * Designed to match actual usage patterns in reactEngine.ts:
   * - THINKING→THINKING: loop re-enters THINKING at each step
   * - TOOL_CALL→THINKING: loop continues to next step after tool execution
   * - RESPONDING→THINKING: loop continues if agent produces text but not terminate
   * - THINKING→DONE: abort/interrupt before LLM call
   * - TOOL_CALL→DONE: max steps reached while executing tools
   * - TOOL_RESULT→DONE: max steps reached after tool result
   * - ERROR→DONE: finally block cleanup after catch
   */
  private static readonly VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
    IDLE:          ['THINKING', 'ERROR', 'GUARD_BLOCKED'],
    THINKING:      ['THINKING', 'TOOL_CALL', 'RESPONDING', 'HUMAN_PAUSE', 'ERROR', 'GUARD_BLOCKED', 'DONE'],
    TOOL_CALL:     ['TOOL_RESULT', 'THINKING', 'ERROR', 'GUARD_BLOCKED', 'DONE'],
    TOOL_RESULT:   ['THINKING', 'RESPONDING', 'ERROR', 'GUARD_BLOCKED', 'DONE'],
    RESPONDING:    ['DONE', 'THINKING', 'ERROR', 'GUARD_BLOCKED'],
    HUMAN_PAUSE:   ['THINKING', 'ERROR', 'GUARD_BLOCKED'],
    DONE:          [],
    ERROR:         ['IDLE', 'DONE'],
    GUARD_BLOCKED: ['THINKING', 'TOOL_CALL', 'RESPONDING', 'ERROR', 'DONE'],
  };

  transition(to: AgentState, reason: string): void {
    const from = this._state;
    const allowed = AgentStateMachine.VALID_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new Error(`Invalid transition from ${from} to ${to}`);
    }
    this._state = to;
    const entry: StateTransition = { from, to, reason, timestamp: Date.now() };
    this._history.push(entry);
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }
    // v11.15.0 Audit 7 Fix D: invoke onTransition callback if registered
    if (this._onTransition) {
      try { this._onTransition(entry); } catch { /* non-fatal */ }
    }
  }

  is(state: AgentState): boolean { return this._state === state; }
  isAny(...states: AgentState[]): boolean { return states.includes(this._state); }

  reset(): void {
    this._state = "IDLE";
    this._history = [];
  }

  toJSON() {
    return { state: this._state, history: this._history.slice(-10) };
  }
}
// ─────────────────────────────────────────────────────────────────────────────
