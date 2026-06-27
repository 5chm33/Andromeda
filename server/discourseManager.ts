/**
 * discourseManager.ts — v94.0.0 "Emergent Communication & Language Grounding"
 * Manages discourse structure, coherence, and conversational flow across turns.
 */
export type DiscourseRelation = "elaboration" | "contrast" | "cause" | "effect" | "sequence" | "parallel" | "question_answer";

export interface DiscourseUnit {
  unitId: string;
  content: string;
  speakerId: string;
  turnNumber: number;
  relations: Array<{ targetUnitId: string; relation: DiscourseRelation; strength: number }>;
  topics: string[];
  timestamp: number;
}

export interface Discourse {
  discourseId: string;
  title: string;
  units: DiscourseUnit[];
  currentTopic: string;
  topicHistory: string[];
  coherenceScore: number;
  turnCount: number;
  participants: Set<string>;
}

const discourses = new Map<string, Discourse>();
let discourseCounter = 0;
let unitCounter = 0;

export function createDiscourse(title: string): Discourse {
  const discourse: Discourse = { discourseId: `disc-${++discourseCounter}`, title, units: [], currentTopic: "", topicHistory: [], coherenceScore: 1.0, turnCount: 0, participants: new Set() };
  discourses.set(discourse.discourseId, discourse);
  return discourse;
}

export function addTurn(discourseId: string, content: string, speakerId: string, topics: string[] = [], relations: Array<{ targetUnitId: string; relation: DiscourseRelation; strength: number }> = []): DiscourseUnit | null {
  const discourse = discourses.get(discourseId);
  if (!discourse) return null;

  const unit: DiscourseUnit = { unitId: `du-${++unitCounter}`, content, speakerId, turnNumber: ++discourse.turnCount, relations, topics, timestamp: Date.now() };
  discourse.units.push(unit);
  discourse.participants.add(speakerId);

  if (topics.length > 0) {
    if (discourse.currentTopic && !topics.includes(discourse.currentTopic)) discourse.topicHistory.push(discourse.currentTopic);
    discourse.currentTopic = topics[0];
  }

  // Update coherence based on topic continuity
  const topicContinuity = topics.some(t => t === discourse.currentTopic || discourse.topicHistory.includes(t)) ? 1 : 0.7;
  discourse.coherenceScore = 0.8 * discourse.coherenceScore + 0.2 * topicContinuity;
  return unit;
}

export function getDiscourse(discourseId: string): Discourse | undefined { return discourses.get(discourseId); }
export function getUnits(discourseId: string, speakerId?: string): DiscourseUnit[] {
  const d = discourses.get(discourseId);
  if (!d) return [];
  return speakerId ? d.units.filter(u => u.speakerId === speakerId) : [...d.units];
}
export function _resetDiscourseManagerForTest(): void { discourses.clear(); discourseCounter = 0; unitCounter = 0; }
