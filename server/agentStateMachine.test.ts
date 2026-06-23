import { describe, it, expect } from "vitest";
import { AgentStateMachine } from "./agentStateMachine.js";

describe("AgentStateMachine", () => {
  it("starts in IDLE state with empty history", () => {
    const sm = new AgentStateMachine();
    expect(sm.state).toBe("IDLE");
    expect(sm.history).toHaveLength(0);
  });

  it("transitions IDLE → THINKING and records history", () => {
    const sm = new AgentStateMachine();
    sm.transition("THINKING", "starting reasoning");
    expect(sm.state).toBe("THINKING");
    expect(sm.history[0].from).toBe("IDLE");
    expect(sm.history[0].to).toBe("THINKING");
    expect(sm.history[0].reason).toBe("starting reasoning");
  });

  it("transitions through a full ReAct cycle", () => {
    const sm = new AgentStateMachine();
    sm.transition("THINKING", "start");
    sm.transition("TOOL_CALL", "invoke tool");
    sm.transition("TOOL_RESULT", "got result");
    sm.transition("RESPONDING", "formulating response");
    sm.transition("DONE", "finished");
    expect(sm.state).toBe("DONE");
    expect(sm.history).toHaveLength(5);
  });

  it("throws on invalid transition", () => {
    const sm = new AgentStateMachine();
    expect(() => sm.transition("DONE", "jump to done from idle")).toThrow("Invalid transition from IDLE to DONE");
  });

  it("is() and isAny() helpers work correctly", () => {
    const sm = new AgentStateMachine();
    expect(sm.is("IDLE")).toBe(true);
    sm.transition("THINKING", "start");
    expect(sm.isAny("THINKING", "TOOL_CALL")).toBe(true);
    expect(sm.isAny("IDLE", "DONE")).toBe(false);
  });

  it("reset() returns to IDLE and clears history", () => {
    const sm = new AgentStateMachine();
    sm.transition("THINKING", "start");
    sm.reset();
    expect(sm.state).toBe("IDLE");
    expect(sm.history).toHaveLength(0);
  });

  it("THINKING → THINKING self-loop is valid", () => {
    const sm = new AgentStateMachine();
    sm.transition("THINKING", "step 1");
    sm.transition("THINKING", "step 2");
    expect(sm.state).toBe("THINKING");
    expect(sm.history).toHaveLength(2);
  });

  it("ERROR → IDLE recovery path works", () => {
    const sm = new AgentStateMachine();
    sm.transition("ERROR", "unexpected error");
    sm.transition("IDLE", "recovered");
    expect(sm.state).toBe("IDLE");
  });

  it("toJSON() returns current state and history", () => {
    const sm = new AgentStateMachine();
    sm.transition("THINKING", "start");
    const json = sm.toJSON();
    expect(json.state).toBe("THINKING");
    expect(Array.isArray(json.history)).toBe(true);
  });

  it("history has timestamp on each transition", () => {
    const sm = new AgentStateMachine();
    sm.transition("THINKING", "start");
    expect(typeof sm.history[0].timestamp).toBe("number");
    expect(sm.history[0].timestamp).toBeGreaterThan(0);
  });

  it("onTransition callback fires on each transition (Fix 7D)", () => {
    const sm = new AgentStateMachine();
    const events: string[] = [];
    sm.onTransition = (t) => events.push(`${t.from}\u2192${t.to}`);
    sm.transition("THINKING", "start");
    sm.transition("DONE", "abort");
    expect(events).toEqual(["IDLE\u2192THINKING", "THINKING\u2192DONE"]);
  });
});
