/**
 * Historical Pattern Miner — mines recurring patterns from historical data.
 * Implements sequential pattern mining and motif discovery.
 */

export interface HistoricalPattern {
  id: string;
  sequence: string[];
  frequency: number;
  support: number;  // fraction of sequences containing this pattern
  confidence: number;
  lastSeen: number;
}

export interface PatternMiningReport {
  totalPatterns: number;
  highFrequencyPatterns: number;
  avgSupport: number;
  topPattern: string[] | null;
}

class HistoricalPatternMinerEngine {
  private sequences: string[][] = [];
  private patterns: Map<string, HistoricalPattern> = new Map();
  private counter = 0;

  addSequence(sequence: string[]): void {
    this.sequences.push(sequence);
    this._minePatterns(sequence);
  }

  private _minePatterns(sequence: string[]): void {
    // Mine all subsequences of length 2-4
    for (let len = 2; len <= Math.min(4, sequence.length); len++) {
      for (let i = 0; i <= sequence.length - len; i++) {
        const subseq = sequence.slice(i, i + len);
        const key = subseq.join("→");
        if (!this.patterns.has(key)) {
          this.patterns.set(key, {
            id: `pattern-${++this.counter}`,
            sequence: subseq,
            frequency: 0,
            support: 0,
            confidence: 0,
            lastSeen: Date.now(),
          });
        }
        const p = this.patterns.get(key)!;
        p.frequency++;
        p.support = p.frequency / this.sequences.length;
        p.confidence = Math.min(1, p.support * 2);
        p.lastSeen = Date.now();
      }
    }
  }

  getTopPatterns(n = 5): HistoricalPattern[] {
    return Array.from(this.patterns.values())
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, n);
  }

  getPatternMiningReport(): PatternMiningReport {
    const patterns = Array.from(this.patterns.values());
    const highFreq = patterns.filter(p => p.frequency > 2);
    const top = patterns.sort((a, b) => b.frequency - a.frequency)[0];
    return {
      totalPatterns: patterns.length,
      highFrequencyPatterns: highFreq.length,
      avgSupport: patterns.length > 0 ? patterns.reduce((s, p) => s + p.support, 0) / patterns.length : 0,
      topPattern: top?.sequence ?? null,
    };
  }
}

export const globalHistoricalPatternMiner = new HistoricalPatternMinerEngine();

export function addHistoricalSequence(sequence: string[]): void {
  globalHistoricalPatternMiner.addSequence(sequence);
}
export function getTopPatterns(n?: number): HistoricalPattern[] {
  return globalHistoricalPatternMiner.getTopPatterns(n);
}
export function getPatternMiningReport(): PatternMiningReport {
  return globalHistoricalPatternMiner.getPatternMiningReport();
}
export function initHistoricalPatternMiner(): void {
  console.log("[HistoricalPatternMiner] Historical Pattern Miner initialized.");
}
