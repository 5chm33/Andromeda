/**
 * transferLearner.ts — v90.0.0 "Adaptive Learning & Meta-Learning"
 * Transfer learning system that reuses knowledge from source domains in target domains.
 */
export type TransferStrategy = "feature_extraction" | "fine_tuning" | "domain_adaptation" | "knowledge_distillation";

export interface DomainKnowledge {
  domainId: string;
  name: string;
  features: string[];
  representations: Record<string, number[]>;
  taskType: string;
  performanceScore: number;
}

export interface TransferJob {
  jobId: string;
  sourceDomainId: string;
  targetDomainId: string;
  strategy: TransferStrategy;
  sharedFeatures: string[];
  transferredKnowledge: Record<string, number[]>;
  baselineAccuracy: number;
  transferAccuracy: number;
  improvement: number;
  status: "pending" | "running" | "completed" | "failed";
  completedAt: number | null;
}

const domains = new Map<string, DomainKnowledge>();
const jobs: TransferJob[] = [];
let domainCounter = 0;
let jobCounter = 0;

export function registerDomain(name: string, features: string[], taskType: string, performanceScore = 0.8): DomainKnowledge {
  const domain: DomainKnowledge = {
    domainId: `dom-${++domainCounter}`,
    name, features, representations: {}, taskType, performanceScore,
  };
  // Initialize random representations for features
  for (const f of features) domain.representations[f] = Array.from({ length: 8 }, () => Math.random() * 2 - 1);
  domains.set(domain.domainId, domain);
  return domain;
}

export function findSharedFeatures(sourceDomainId: string, targetDomainId: string): string[] {
  const source = domains.get(sourceDomainId);
  const target = domains.get(targetDomainId);
  if (!source || !target) return [];
  return source.features.filter(f => target.features.includes(f));
}

export function transferKnowledge(sourceDomainId: string, targetDomainId: string, strategy: TransferStrategy, baselineAccuracy: number): TransferJob | null {
  const source = domains.get(sourceDomainId);
  const target = domains.get(targetDomainId);
  if (!source || !target) return null;

  const sharedFeatures = findSharedFeatures(sourceDomainId, targetDomainId);
  const transferredKnowledge: Record<string, number[]> = {};
  for (const f of sharedFeatures) {
    if (source.representations[f]) transferredKnowledge[f] = [...source.representations[f]];
  }

  // Simulate accuracy improvement based on strategy and shared features
  const shareRatio = target.features.length > 0 ? sharedFeatures.length / target.features.length : 0;
  const strategyBonus = { feature_extraction: 0.05, fine_tuning: 0.1, domain_adaptation: 0.08, knowledge_distillation: 0.12 }[strategy];
  const transferAccuracy = Math.min(1, baselineAccuracy + strategyBonus * shareRatio * source.performanceScore);

  const job: TransferJob = {
    jobId: `tj-${++jobCounter}`,
    sourceDomainId, targetDomainId, strategy,
    sharedFeatures, transferredKnowledge,
    baselineAccuracy, transferAccuracy,
    improvement: transferAccuracy - baselineAccuracy,
    status: "completed",
    completedAt: Date.now(),
  };
  jobs.push(job);
  return job;
}

export function getDomain(domainId: string): DomainKnowledge | undefined { return domains.get(domainId); }
export function getTransferJobs(targetDomainId?: string): TransferJob[] { return targetDomainId ? jobs.filter(j => j.targetDomainId === targetDomainId) : [...jobs]; }
export function _resetTransferLearnerForTest(): void { domains.clear(); jobs.length = 0; domainCounter = 0; jobCounter = 0; }
