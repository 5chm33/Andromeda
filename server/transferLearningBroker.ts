/**
 * Transfer Learning Broker — manages knowledge transfer between domains and tasks.
 * Implements fine-tuning strategies, domain adaptation, and zero-shot transfer.
 */

export type TransferStrategy = "fine_tune" | "feature_extraction" | "zero_shot" | "few_shot" | "domain_adaptation";

export interface TransferRequest {
  id: string;
  sourceDomain: string;
  targetDomain: string;
  strategy: TransferStrategy;
  sourceCapabilityLevel: number;
  targetCapabilityLevel: number;
  estimatedTransferGain: number;
  confidence: number;
}

export interface TransferResult {
  requestId: string;
  success: boolean;
  actualGain: number;
  transferEfficiency: number;  // gain / cost
  lessonsLearned: string[];
}

export interface TransferBrokerReport {
  totalTransfers: number;
  successRate: number;
  avgTransferEfficiency: number;
  bestStrategy: TransferStrategy;
  domainsCovered: string[];
}

class TransferLearningBrokerEngine {
  private requests: TransferRequest[] = [];
  private results: TransferResult[] = [];
  private counter = 0;

  requestTransfer(
    sourceDomain: string,
    targetDomain: string,
    sourceCapabilityLevel: number,
    targetCapabilityLevel: number
  ): TransferRequest {
    // Select strategy based on domain similarity and capability gap
    const domainSimilarity = sourceDomain === targetDomain ? 1.0 : 0.3;
    const capabilityGap = sourceCapabilityLevel - targetCapabilityLevel;

    let strategy: TransferStrategy;
    if (domainSimilarity > 0.8) strategy = "fine_tune";
    else if (capabilityGap > 0.3) strategy = "feature_extraction";
    else if (targetCapabilityLevel < 0.5) strategy = "few_shot";
    else strategy = "domain_adaptation";

    const estimatedGain = capabilityGap * domainSimilarity * 0.5;

    const req: TransferRequest = {
      id: `transfer-${++this.counter}`,
      sourceDomain, targetDomain, strategy,
      sourceCapabilityLevel, targetCapabilityLevel,
      estimatedTransferGain: Math.max(0, estimatedGain),
      confidence: domainSimilarity * 0.8,
    };
    this.requests.push(req);
    return req;
  }

  executeTransfer(requestId: string): TransferResult {
    const req = this.requests.find(r => r.id === requestId);
    if (!req) {
      return { requestId, success: false, actualGain: 0, transferEfficiency: 0, lessonsLearned: [] };
    }

    // Simulate transfer with some variance
    const variance = (Math.random() - 0.5) * 0.1;
    const actualGain = Math.max(0, req.estimatedTransferGain + variance);
    const cost = req.strategy === "fine_tune" ? 0.3 : req.strategy === "domain_adaptation" ? 0.5 : 0.1;
    const transferEfficiency = cost > 0 ? actualGain / cost : 0;

    const result: TransferResult = {
      requestId,
      success: actualGain > 0,
      actualGain,
      transferEfficiency,
      lessonsLearned: [
        `${req.strategy} from ${req.sourceDomain} to ${req.targetDomain}: +${actualGain.toFixed(4)}`,
      ],
    };
    this.results.push(result);
    return result;
  }

  getBestStrategy(): TransferStrategy {
    const strategyScores = new Map<TransferStrategy, number[]>();
    for (const result of this.results) {
      const req = this.requests.find(r => r.id === result.requestId);
      if (!req) continue;
      if (!strategyScores.has(req.strategy)) strategyScores.set(req.strategy, []);
      strategyScores.get(req.strategy)!.push(result.transferEfficiency);
    }
    let bestStrategy: TransferStrategy = "fine_tune";
    let bestScore = -1;
    for (const [strategy, scores] of strategyScores) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avg > bestScore) { bestScore = avg; bestStrategy = strategy; }
    }
    return bestStrategy;
  }

  getTransferBrokerReport(): TransferBrokerReport {
    const successful = this.results.filter(r => r.success);
    const domains = [...new Set(this.requests.flatMap(r => [r.sourceDomain, r.targetDomain]))];
    return {
      totalTransfers: this.results.length,
      successRate: this.results.length > 0 ? successful.length / this.results.length : 0,
      avgTransferEfficiency: this.results.length > 0
        ? this.results.reduce((s, r) => s + r.transferEfficiency, 0) / this.results.length
        : 0,
      bestStrategy: this.getBestStrategy(),
      domainsCovered: domains,
    };
  }
}

export const globalTransferBroker = new TransferLearningBrokerEngine();

export function requestTransfer(sourceDomain: string, targetDomain: string, sourceLevel: number, targetLevel: number): TransferRequest {
  return globalTransferBroker.requestTransfer(sourceDomain, targetDomain, sourceLevel, targetLevel);
}
export function executeTransfer(requestId: string): TransferResult {
  return globalTransferBroker.executeTransfer(requestId);
}
export function getTransferBrokerReport(): TransferBrokerReport {
  return globalTransferBroker.getTransferBrokerReport();
}
export function initTransferLearningBroker(): void {
  console.log("[TransferBroker] Transfer Learning Broker initialized.");
}
