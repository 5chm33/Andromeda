import { createLogger } from "./logger.js";
const log = createLogger("IncidentManager");
/**
 * incidentManager.ts — v75.0.0 "Incident Management & SRE"
 * Tracks incidents from detection through resolution with severity, timeline, and status management.
 */
export type IncidentSeverity = "sev1" | "sev2" | "sev3" | "sev4";
export type IncidentStatus = "open" | "investigating" | "mitigated" | "resolved" | "closed";

export interface IncidentEvent {
  eventId: string;
  timestamp: number;
  actor: string;
  description: string;
}

export interface Incident {
  incidentId: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  affectedService: string;
  openedAt: number;
  resolvedAt: number | null;
  closedAt: number | null;
  timeline: IncidentEvent[];
  assignee: string | null;
  tags: string[];
}

const incidents = new Map<string, Incident>();
let incidentCounter = 0;
let eventCounter = 0;

export function openIncident(title: string, severity: IncidentSeverity, affectedService: string, tags: string[] = []): Incident {
  const incident: Incident = {
    incidentId: `INC-${String(++incidentCounter).padStart(4, "0")}`,
    title, severity, status: "open", affectedService,
    openedAt: Date.now(), resolvedAt: null, closedAt: null,
    timeline: [{ eventId: `evt-${++eventCounter}`, timestamp: Date.now(), actor: "system", description: `Incident opened: ${title}` }],
    assignee: null, tags,
  };
  incidents.set(incident.incidentId, incident);
  log.info(`[IncidentManager] Opened ${incident.incidentId} (${severity}): ${title}`);
  return incident;
}

export function updateIncidentStatus(incidentId: string, status: IncidentStatus, actor: string, note: string): boolean {
  const incident = incidents.get(incidentId);
  if (!incident) return false;
  incident.status = status;
  if (status === "resolved") incident.resolvedAt = Date.now();
  if (status === "closed") incident.closedAt = Date.now();
  incident.timeline.push({ eventId: `evt-${++eventCounter}`, timestamp: Date.now(), actor, description: `Status changed to ${status}: ${note}` });
  return true;
}

export function assignIncident(incidentId: string, assignee: string): boolean {
  const incident = incidents.get(incidentId);
  if (!incident) return false;
  incident.assignee = assignee;
  incident.timeline.push({ eventId: `evt-${++eventCounter}`, timestamp: Date.now(), actor: "system", description: `Assigned to ${assignee}` });
  return true;
}

export function getIncident(incidentId: string): Incident | undefined { return incidents.get(incidentId); }
export function getAllIncidents(): Incident[] { return [...incidents.values()]; }
export function getOpenIncidents(): Incident[] { return [...incidents.values()].filter(i => i.status !== "closed" && i.status !== "resolved"); }

export function _resetIncidentManagerForTest(): void { incidents.clear(); incidentCounter = 0; eventCounter = 0; }
