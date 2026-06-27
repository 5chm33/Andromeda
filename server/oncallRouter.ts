import { createLogger } from "./logger.js";
const log = createLogger("OncallRouter");
/**
 * oncallRouter.ts — v75.0.0 "Incident Management & SRE"
 * Routes incidents to the appropriate on-call engineer based on service ownership and escalation policies.
 */
export interface OncallSchedule {
  scheduleId: string;
  service: string;
  primaryEngineer: string;
  secondaryEngineer: string;
  escalationAfterMinutes: number;
}

export interface RoutingDecision {
  routingId: string;
  incidentId: string;
  service: string;
  assignedTo: string;
  escalationLevel: number;
  reason: string;
  routedAt: number;
}

const schedules: OncallSchedule[] = [];
const routingHistory: RoutingDecision[] = [];
let routingCounter = 0;

export function registerOncallSchedule(schedule: OncallSchedule): void {
  const existing = schedules.findIndex(s => s.scheduleId === schedule.scheduleId);
  if (existing >= 0) schedules[existing] = schedule;
  else schedules.push(schedule);
  log.info(`[OncallRouter] Registered schedule for service: ${schedule.service}`);
}

export function routeIncident(incidentId: string, service: string, ageMinutes = 0): RoutingDecision {
  const schedule = schedules.find(s => s.service === service);

  let assignedTo: string;
  let escalationLevel: number;
  let reason: string;

  if (!schedule) {
    assignedTo = "default-oncall";
    escalationLevel = 0;
    reason = `No schedule found for service "${service}" — routed to default on-call`;
  } else if (ageMinutes >= schedule.escalationAfterMinutes) {
    assignedTo = schedule.secondaryEngineer;
    escalationLevel = 1;
    reason = `Escalated after ${ageMinutes} minutes (threshold: ${schedule.escalationAfterMinutes}m)`;
  } else {
    assignedTo = schedule.primaryEngineer;
    escalationLevel = 0;
    reason = `Routed to primary on-call for service "${service}"`;
  }

  const decision: RoutingDecision = {
    routingId: `routing-${++routingCounter}`,
    incidentId, service, assignedTo, escalationLevel, reason,
    routedAt: Date.now(),
  };

  routingHistory.push(decision);
  log.info(`[OncallRouter] Incident ${incidentId} → ${assignedTo} (level ${escalationLevel})`);
  return decision;
}

export function getRoutingHistory(): RoutingDecision[] { return [...routingHistory]; }
export function getSchedules(): OncallSchedule[] { return [...schedules]; }
export function _resetOncallRouterForTest(): void { schedules.length = 0; routingHistory.length = 0; routingCounter = 0; }
