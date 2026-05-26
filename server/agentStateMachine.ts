/**
 * agentStateMachine.ts — v6.25
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

  get state(): AgentState { return this._state; }
  get history(): StateTransition[] { return [...this._history]; }

  transition(to: AgentState, reason: string): void {
    const from = this._state;
    this._state = to;
    this._history.push({ from, to, reason, timestamp: Date.now() });
    if (this._history.length > this._maxHistory) {
      this._history.shift();
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
