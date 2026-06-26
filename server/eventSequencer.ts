/**
 * Event Sequencer — orders and sequences events for temporal reasoning.
 * Implements Allen's interval algebra and temporal ordering constraints.
 */

export type TemporalRelation = "before" | "after" | "during" | "overlaps" | "meets" | "equals";

export interface TemporalEvent {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  domain: string;
  importance: number;
}

export interface EventSequence {
  events: TemporalEvent[];
  relations: Array<{ eventA: string; relation: TemporalRelation; eventB: string }>;
  isConsistent: boolean;
}

export interface SequencerReport {
  totalEvents: number;
  totalRelations: number;
  consistencyRate: number;
  avgSequenceLength: number;
}

class EventSequencerEngine {
  private events: Map<string, TemporalEvent> = new Map();
  private sequences: EventSequence[] = [];
  private counter = 0;

  addEvent(name: string, startTime: number, endTime: number, domain: string, importance = 0.5): TemporalEvent {
    const event: TemporalEvent = {
      id: `event-${++this.counter}`,
      name, startTime, endTime, domain, importance,
    };
    this.events.set(event.id, event);
    return event;
  }

  computeRelation(eventA: TemporalEvent, eventB: TemporalEvent): TemporalRelation {
    if (eventA.endTime < eventB.startTime) return "before";
    if (eventA.startTime > eventB.endTime) return "after";
    if (eventA.startTime === eventB.startTime && eventA.endTime === eventB.endTime) return "equals";
    if (eventA.endTime === eventB.startTime) return "meets";
    if (eventA.startTime >= eventB.startTime && eventA.endTime <= eventB.endTime) return "during";
    return "overlaps";
  }

  buildSequence(eventIds: string[]): EventSequence {
    const events = eventIds
      .map(id => this.events.get(id))
      .filter((e): e is TemporalEvent => e !== undefined)
      .sort((a, b) => a.startTime - b.startTime);

    const relations: EventSequence["relations"] = [];
    for (let i = 0; i < events.length - 1; i++) {
      const rel = this.computeRelation(events[i]!, events[i + 1]!);
      relations.push({ eventA: events[i]!.id, relation: rel, eventB: events[i + 1]!.id });
    }

    const isConsistent = relations.every(r => r.relation !== "after");
    const sequence: EventSequence = { events, relations, isConsistent };
    this.sequences.push(sequence);
    return sequence;
  }

  getSequencerReport(): SequencerReport {
    const consistent = this.sequences.filter(s => s.isConsistent);
    return {
      totalEvents: this.events.size,
      totalRelations: this.sequences.reduce((s, seq) => s + seq.relations.length, 0),
      consistencyRate: this.sequences.length > 0 ? consistent.length / this.sequences.length : 1,
      avgSequenceLength: this.sequences.length > 0
        ? this.sequences.reduce((s, seq) => s + seq.events.length, 0) / this.sequences.length
        : 0,
    };
  }
}

export const globalEventSequencer = new EventSequencerEngine();

export function addTemporalEvent(name: string, startTime: number, endTime: number, domain: string, importance?: number): TemporalEvent {
  return globalEventSequencer.addEvent(name, startTime, endTime, domain, importance);
}
export function buildEventSequence(eventIds: string[]): EventSequence {
  return globalEventSequencer.buildSequence(eventIds);
}
export function getSequencerReport(): SequencerReport {
  return globalEventSequencer.getSequencerReport();
}
export function initEventSequencer(): void {
  console.log("[EventSequencer] Event Sequencer initialized.");
}
