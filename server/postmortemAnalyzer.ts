import { createLogger } from "./logger.js";
const log = createLogger("PostmortemAnalyzer");
/**
 * postmortemAnalyzer.ts — v75.0.0 "Incident Management & SRE"
 * Generates blameless postmortems from incident timelines and extracts action items.
 */
export interface PostmortemInput {
  incidentId: string;
  title: string;
  severity: string;
  affectedService: string;
  openedAt: number;
  resolvedAt: number | null;
  timeline: Array<{ timestamp: number; actor: string; description: string }>;
  contributingFactors: string[];
  impactDescription: string;
}

export interface ActionItem {
  actionId: string;
  description: string;
  owner: string;
  priority: "high" | "medium" | "low";
  dueInDays: number;
}

export interface Postmortem {
  postmortemId: string;
  incidentId: string;
  title: string;
  summary: string;
  timeline: string[];
  rootCauses: string[];
  contributingFactors: string[];
  actionItems: ActionItem[];
  generatedAt: number;
}

const postmortems: Postmortem[] = [];
let pmCounter = 0;
let actionCounter = 0;

export function generatePostmortem(input: PostmortemInput, actionItems: Omit<ActionItem, "actionId">[] = []): Postmortem {
  const durationMs = input.resolvedAt ? input.resolvedAt - input.openedAt : null;
  const durationStr = durationMs ? `${Math.round(durationMs / 60000)} minutes` : "unresolved";

  const summary = `Incident ${input.incidentId} (${input.severity}) affected ${input.affectedService} for ${durationStr}. ${input.impactDescription}`;

  const timelineEntries = input.timeline.map(e => {
    const d = new Date(e.timestamp);
    return `[${d.toISOString()}] ${e.actor}: ${e.description}`;
  });

  const rootCauses = input.contributingFactors.length > 0
    ? [`Primary: ${input.contributingFactors[0]}`, ...input.contributingFactors.slice(1).map(f => `Contributing: ${f}`)]
    : ["Root cause under investigation"];

  const numberedActions: ActionItem[] = actionItems.map(a => ({ ...a, actionId: `action-${++actionCounter}` }));

  const postmortem: Postmortem = {
    postmortemId: `PM-${String(++pmCounter).padStart(4, "0")}`,
    incidentId: input.incidentId,
    title: `Postmortem: ${input.title}`,
    summary,
    timeline: timelineEntries,
    rootCauses,
    contributingFactors: input.contributingFactors,
    actionItems: numberedActions,
    generatedAt: Date.now(),
  };

  postmortems.push(postmortem);
  log.info(`[PostmortemAnalyzer] Generated ${postmortem.postmortemId} for incident ${input.incidentId}`);
  return postmortem;
}

export function getPostmortems(): Postmortem[] { return [...postmortems]; }
export function _resetPostmortemAnalyzerForTest(): void { postmortems.length = 0; pmCounter = 0; actionCounter = 0; }
