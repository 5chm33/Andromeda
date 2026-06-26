/**
 * Interface Negotiator — negotiates compatible interfaces between modules.
 * Resolves type mismatches, versioning conflicts, and API incompatibilities.
 */

export interface InterfaceSpec {
  moduleId: string;
  version: string;
  methods: Array<{ name: string; inputType: string; outputType: string }>;
  events: string[];
}

export interface NegotiationResult {
  id: string;
  consumerModule: string;
  providerModule: string;
  compatible: boolean;
  adaptorsNeeded: string[];
  negotiatedVersion: string;
  confidence: number;
}

export interface NegotiatorReport {
  totalNegotiations: number;
  successRate: number;
  avgAdaptorsNeeded: number;
  mostCommonConflict: string;
}

class InterfaceNegotiatorEngine {
  private results: NegotiationResult[] = [];
  private counter = 0;

  negotiate(consumer: InterfaceSpec, provider: InterfaceSpec): NegotiationResult {
    const adaptorsNeeded: string[] = [];
    let compatible = true;

    for (const method of consumer.methods) {
      const providerMethod = provider.methods.find(m => m.name === method.name);
      if (!providerMethod) {
        adaptorsNeeded.push(`Missing method: ${method.name}`);
        compatible = false;
      } else if (providerMethod.outputType !== method.inputType) {
        adaptorsNeeded.push(`Type adaptor: ${providerMethod.outputType} → ${method.inputType}`);
      }
    }

    // Version negotiation
    const consumerMajor = parseInt(consumer.version.split(".")[0] ?? "1");
    const providerMajor = parseInt(provider.version.split(".")[0] ?? "1");
    if (consumerMajor !== providerMajor) {
      adaptorsNeeded.push(`Version bridge: v${consumerMajor} ↔ v${providerMajor}`);
    }

    const result: NegotiationResult = {
      id: `neg-${++this.counter}`,
      consumerModule: consumer.moduleId,
      providerModule: provider.moduleId,
      compatible: compatible && adaptorsNeeded.length <= 2,
      adaptorsNeeded,
      negotiatedVersion: provider.version,
      confidence: compatible ? 0.95 : 0.6,
    };
    this.results.push(result);
    return result;
  }

  getNegotiatorReport(): NegotiatorReport {
    const successful = this.results.filter(r => r.compatible);
    const allAdaptors = this.results.flatMap(r => r.adaptorsNeeded);
    const conflictCounts = allAdaptors.reduce((acc, a) => {
      const key = a.split(":")[0] ?? a;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const mostCommon = Object.entries(conflictCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
    return {
      totalNegotiations: this.results.length,
      successRate: this.results.length > 0 ? successful.length / this.results.length : 1,
      avgAdaptorsNeeded: this.results.length > 0
        ? this.results.reduce((s, r) => s + r.adaptorsNeeded.length, 0) / this.results.length
        : 0,
      mostCommonConflict: mostCommon,
    };
  }
}

export const globalInterfaceNegotiator = new InterfaceNegotiatorEngine();

export function negotiateInterfaces(consumer: InterfaceSpec, provider: InterfaceSpec): NegotiationResult {
  return globalInterfaceNegotiator.negotiate(consumer, provider);
}
export function getNegotiatorReport(): NegotiatorReport {
  return globalInterfaceNegotiator.getNegotiatorReport();
}
export function initInterfaceNegotiator(): void {
  console.log("[InterfaceNegotiator] Interface Negotiator initialized.");
}
