/**
 * simulationEngine.ts — v87.0.0 "Simulation & Game Theory"
 * Discrete-event simulation engine with step-based execution and event queuing.
 */
export type SimulationStatus = "idle" | "running" | "paused" | "completed" | "error";

export interface SimEvent {
  eventId: string;
  scheduledAt: number;
  type: string;
  payload: Record<string, unknown>;
  processed: boolean;
}

export interface SimulationState {
  simId: string;
  name: string;
  currentTime: number;
  stepCount: number;
  status: SimulationStatus;
  eventQueue: SimEvent[];
  metrics: Record<string, number>;
  createdAt: number;
}

const simulations = new Map<string, SimulationState>();
let simCounter = 0;
let eventCounter = 0;

export function createSimulation(name: string): SimulationState {
  const sim: SimulationState = {
    simId: `sim-${++simCounter}`,
    name,
    currentTime: 0,
    stepCount: 0,
    status: "idle",
    eventQueue: [],
    metrics: {},
    createdAt: Date.now(),
  };
  simulations.set(sim.simId, sim);
  return sim;
}

export function scheduleEvent(simId: string, scheduledAt: number, type: string, payload: Record<string, unknown> = {}): SimEvent | null {
  const sim = simulations.get(simId);
  if (!sim) return null;
  const event: SimEvent = { eventId: `evt-${++eventCounter}`, scheduledAt, type, payload, processed: false };
  sim.eventQueue.push(event);
  sim.eventQueue.sort((a, b) => a.scheduledAt - b.scheduledAt);
  return event;
}

export function stepSimulation(simId: string): SimEvent[] {
  const sim = simulations.get(simId);
  if (!sim || sim.status === "completed") return [];
  sim.status = "running";
  sim.stepCount++;

  const nextTime = sim.eventQueue[0]?.scheduledAt ?? sim.currentTime + 1;
  sim.currentTime = nextTime;

  const processed: SimEvent[] = [];
  while (sim.eventQueue.length > 0 && sim.eventQueue[0].scheduledAt <= sim.currentTime) {
    const event = sim.eventQueue.shift()!;
    event.processed = true;
    processed.push(event);
    sim.metrics[event.type] = (sim.metrics[event.type] ?? 0) + 1;
  }

  if (sim.eventQueue.length === 0) sim.status = "completed";
  return processed;
}

export function runSimulation(simId: string, maxSteps = 1000): SimulationState | null {
  const sim = simulations.get(simId);
  if (!sim) return null;
  let steps = 0;
  while (sim.status !== "completed" && steps < maxSteps) {
    stepSimulation(simId);
    steps++;
  }
  return sim;
}

export function getSimulation(simId: string): SimulationState | undefined { return simulations.get(simId); }
export function _resetSimulationEngineForTest(): void { simulations.clear(); simCounter = 0; eventCounter = 0; }
