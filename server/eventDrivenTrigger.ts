/**
 * eventDrivenTrigger.ts — v84.0.0 "Workflow & Task Automation"
 * Registers event-driven triggers that fire workflows or jobs when conditions are met.
 */
export type TriggerType = "event" | "schedule" | "webhook" | "threshold";

export interface TriggerCondition {
  field: string;
  operator: "eq" | "gt" | "lt" | "gte" | "lte" | "contains" | "exists";
  value: unknown;
}

export interface Trigger {
  triggerId: string;
  name: string;
  type: TriggerType;
  eventPattern: string;
  conditions: TriggerCondition[];
  workflowId: string;
  enabled: boolean;
  firedCount: number;
  lastFiredAt: number | null;
}

export interface TriggerFiring {
  firingId: string;
  triggerId: string;
  eventData: Record<string, unknown>;
  firedAt: number;
  workflowExecutionId: string | null;
}

const triggers = new Map<string, Trigger>();
const firings: TriggerFiring[] = [];
let triggerCounter = 0;
let firingCounter = 0;

export function registerTrigger(name: string, type: TriggerType, eventPattern: string, conditions: TriggerCondition[], workflowId: string): Trigger {
  const trigger: Trigger = {
    triggerId: `trig-${++triggerCounter}`,
    name, type, eventPattern, conditions, workflowId,
    enabled: true,
    firedCount: 0,
    lastFiredAt: null,
  };
  triggers.set(trigger.triggerId, trigger);
  return trigger;
}

function evaluateCondition(condition: TriggerCondition, data: Record<string, unknown>): boolean {
  const val = data[condition.field];
  switch (condition.operator) {
    case "eq": return val === condition.value;
    case "gt": return Number(val) > Number(condition.value);
    case "lt": return Number(val) < Number(condition.value);
    case "gte": return Number(val) >= Number(condition.value);
    case "lte": return Number(val) <= Number(condition.value);
    case "contains": return String(val).includes(String(condition.value));
    case "exists": return val !== undefined && val !== null;
    default: return false;
  }
}

export function processEvent(eventType: string, eventData: Record<string, unknown>): TriggerFiring[] {
  const fired: TriggerFiring[] = [];
  for (const trigger of triggers.values()) {
    if (!trigger.enabled) continue;
    if (!eventType.match(new RegExp(trigger.eventPattern.replace("*", ".*")))) continue;
    if (!trigger.conditions.every(c => evaluateCondition(c, eventData))) continue;

    trigger.firedCount++;
    trigger.lastFiredAt = Date.now();
    const firing: TriggerFiring = {
      firingId: `firing-${++firingCounter}`,
      triggerId: trigger.triggerId,
      eventData,
      firedAt: Date.now(),
      workflowExecutionId: null,
    };
    firings.push(firing);
    fired.push(firing);
  }
  return fired;
}

export function enableTrigger(triggerId: string): boolean {
  const t = triggers.get(triggerId);
  if (!t) return false;
  t.enabled = true;
  return true;
}

export function disableTrigger(triggerId: string): boolean {
  const t = triggers.get(triggerId);
  if (!t) return false;
  t.enabled = false;
  return true;
}

export function getTrigger(triggerId: string): Trigger | undefined { return triggers.get(triggerId); }
export function getAllTriggers(): Trigger[] { return [...triggers.values()]; }
export function getFirings(): TriggerFiring[] { return [...firings]; }
export function _resetEventDrivenTriggerForTest(): void { triggers.clear(); firings.length = 0; triggerCounter = 0; firingCounter = 0; }
