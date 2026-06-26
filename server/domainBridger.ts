/**
 * Domain Bridger — builds bridges between disparate knowledge domains.
 * Identifies cross-domain patterns and enables insight transfer.
 */

export interface DomainBridge {
  id: string;
  domainA: string;
  domainB: string;
  sharedPatterns: string[];
  bridgeStrength: number;  // 0-1
  transferableInsights: string[];
  discoveredAt: number;
}

export interface BridgeReport {
  totalBridges: number;
  avgBridgeStrength: number;
  strongBridges: number;
  topDomainPair: [string, string] | null;
}

class DomainBridgerEngine {
  private bridges: DomainBridge[] = [];
  private counter = 0;

  private readonly DOMAIN_PATTERNS: Record<string, string[]> = {
    "AI": ["optimization", "learning", "prediction", "representation"],
    "Biology": ["evolution", "adaptation", "homeostasis", "emergence"],
    "Physics": ["equilibrium", "entropy", "conservation", "symmetry"],
    "Economics": ["incentives", "equilibrium", "scarcity", "allocation"],
    "Mathematics": ["proof", "abstraction", "structure", "invariance"],
    "Engineering": ["design", "constraints", "tradeoffs", "robustness"],
  };

  buildBridge(domainA: string, domainB: string): DomainBridge {
    const patternsA = this.DOMAIN_PATTERNS[domainA] ?? ["pattern"];
    const patternsB = this.DOMAIN_PATTERNS[domainB] ?? ["pattern"];
    const sharedPatterns = patternsA.filter(p => patternsB.includes(p));
    const bridgeStrength = sharedPatterns.length / Math.max(patternsA.length, patternsB.length);

    const transferableInsights = sharedPatterns.map(p =>
      `${domainA}::${p} ↔ ${domainB}::${p}`
    );

    const bridge: DomainBridge = {
      id: `bridge-${++this.counter}`,
      domainA, domainB, sharedPatterns, bridgeStrength, transferableInsights,
      discoveredAt: Date.now(),
    };
    this.bridges.push(bridge);
    return bridge;
  }

  findStrongestBridge(): DomainBridge | null {
    if (this.bridges.length === 0) return null;
    return this.bridges.reduce((best, b) => b.bridgeStrength > best.bridgeStrength ? b : best);
  }

  getBridgeReport(): BridgeReport {
    const strong = this.bridges.filter(b => b.bridgeStrength > 0.5);
    const strongest = this.findStrongestBridge();
    return {
      totalBridges: this.bridges.length,
      avgBridgeStrength: this.bridges.length > 0
        ? this.bridges.reduce((s, b) => s + b.bridgeStrength, 0) / this.bridges.length
        : 0,
      strongBridges: strong.length,
      topDomainPair: strongest ? [strongest.domainA, strongest.domainB] : null,
    };
  }

  getBridges(): DomainBridge[] { return [...this.bridges]; }
}

export const globalDomainBridger = new DomainBridgerEngine();

export function buildDomainBridge(domainA: string, domainB: string): DomainBridge {
  return globalDomainBridger.buildBridge(domainA, domainB);
}
export function findStrongestBridge(): DomainBridge | null {
  return globalDomainBridger.findStrongestBridge();
}
export function getBridgeReport(): BridgeReport {
  return globalDomainBridger.getBridgeReport();
}
export function initDomainBridger(): void {
  console.log("[DomainBridger] Domain Bridger initialized.");
  globalDomainBridger.buildBridge("AI", "Biology");
  globalDomainBridger.buildBridge("AI", "Mathematics");
  globalDomainBridger.buildBridge("Physics", "Economics");
}
