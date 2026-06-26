/**
 * Emergent Language Protocol — compressed domain-specific language for inter-module communication.
 * Modules that frequently communicate develop shared shorthand representations,
 * reducing token overhead and enabling faster coordination.
 */

export interface MessagePattern {
  pattern: string;
  frequency: number;
  symbol: string;
  meaning: string;
  compressionRatio: number;
}

export interface EmergentSymbol {
  symbol: string;
  fullMeaning: string;
  usageCount: number;
  createdAt: number;
  modules: string[];  // which modules use this symbol
}

export interface CommunicationLog {
  fromModule: string;
  toModule: string;
  message: string;
  timestamp: number;
  compressed: boolean;
}

class EmergentLanguageProtocolEngine {
  private vocabulary: Map<string, EmergentSymbol> = new Map();
  private patternFrequency: Map<string, number> = new Map();
  private messageLog: CommunicationLog[] = [];
  private symbolCounter = 0;

  // Minimum frequency before a pattern gets a symbol
  private readonly SYMBOL_THRESHOLD = 3;

  observeCommunicationPatterns(messageLog: CommunicationLog[]): MessagePattern[] {
    // Count pattern frequencies
    for (const msg of messageLog) {
      // Extract n-grams (3-5 word phrases)
      const words = msg.message.split(/\s+/);
      for (let n = 3; n <= Math.min(5, words.length); n++) {
        for (let i = 0; i <= words.length - n; i++) {
          const phrase = words.slice(i, i + n).join(" ");
          this.patternFrequency.set(phrase, (this.patternFrequency.get(phrase) ?? 0) + 1);
        }
      }
    }

    // Return patterns that exceed threshold
    const patterns: MessagePattern[] = [];
    for (const [pattern, freq] of this.patternFrequency) {
      if (freq >= this.SYMBOL_THRESHOLD) {
        const existing = this._findSymbolForPattern(pattern);
        patterns.push({
          pattern,
          frequency: freq,
          symbol: existing ?? `Σ${this.symbolCounter + 1}`,
          meaning: pattern,
          compressionRatio: pattern.length / (existing ?? `Σ${this.symbolCounter + 1}`).length,
        });
      }
    }

    patterns.sort((a, b) => b.frequency - a.frequency);
    return patterns;
  }

  private _findSymbolForPattern(pattern: string): string | null {
    for (const [sym, entry] of this.vocabulary) {
      if (entry.fullMeaning === pattern) return sym;
    }
    return null;
  }

  compressToEmergentSymbol(pattern: string): string {
    // Check if already in vocabulary
    const existing = this._findSymbolForPattern(pattern);
    if (existing) {
      const entry = this.vocabulary.get(existing)!;
      entry.usageCount++;
      return existing;
    }

    // Create new symbol
    const freq = this.patternFrequency.get(pattern) ?? 0;
    if (freq < this.SYMBOL_THRESHOLD) {
      // Not frequent enough yet — increment counter and return original
      this.patternFrequency.set(pattern, freq + 1);
      return pattern;
    }

    const symbol = `Σ${++this.symbolCounter}`;
    this.vocabulary.set(symbol, {
      symbol,
      fullMeaning: pattern,
      usageCount: 1,
      createdAt: Date.now(),
      modules: [],
    });

    console.log(`[ELP] New symbol: ${symbol} = "${pattern}" (compression: ${(pattern.length / symbol.length).toFixed(1)}x)`);
    return symbol;
  }

  decompressSymbol(symbol: string): string {
    if (!symbol.startsWith("Σ")) return symbol;
    const entry = this.vocabulary.get(symbol);
    return entry ? entry.fullMeaning : symbol;
  }

  /**
   * Compress a full message by replacing known patterns with symbols.
   */
  compressMessage(message: string): string {
    let compressed = message;
    // Sort by length descending to replace longest patterns first
    const sortedVocab = Array.from(this.vocabulary.entries())
      .sort((a, b) => b[1].fullMeaning.length - a[1].fullMeaning.length);

    for (const [symbol, entry] of sortedVocab) {
      compressed = compressed.replaceAll(entry.fullMeaning, symbol);
    }
    return compressed;
  }

  /**
   * Decompress a message by expanding all symbols.
   */
  decompressMessage(message: string): string {
    let decompressed = message;
    for (const [symbol, entry] of this.vocabulary) {
      decompressed = decompressed.replaceAll(symbol, entry.fullMeaning);
    }
    return decompressed;
  }

  logCommunication(fromModule: string, toModule: string, message: string): void {
    const compressed = this.compressMessage(message);
    this.messageLog.push({
      fromModule,
      toModule,
      message: compressed,
      timestamp: Date.now(),
      compressed: compressed !== message,
    });
    if (this.messageLog.length > 1000) this.messageLog.shift();

    // Auto-observe patterns
    this.observeCommunicationPatterns(this.messageLog.slice(-50));
  }

  getEmergentVocabulary(): EmergentSymbol[] {
    return Array.from(this.vocabulary.values())
      .sort((a, b) => b.usageCount - a.usageCount);
  }

  getCompressionStats(): { totalSymbols: number; avgCompressionRatio: number; totalMessagesSaved: number } {
    const vocab = Array.from(this.vocabulary.values());
    const avgRatio = vocab.length > 0
      ? vocab.reduce((sum, e) => sum + e.fullMeaning.length / e.symbol.length, 0) / vocab.length
      : 1;
    const saved = this.messageLog.filter(m => m.compressed).length;

    return {
      totalSymbols: vocab.length,
      avgCompressionRatio: avgRatio,
      totalMessagesSaved: saved,
    };
  }
}

export const globalELP = new EmergentLanguageProtocolEngine();

export function observeCommunicationPatterns(messageLog: CommunicationLog[]): MessagePattern[] {
  return globalELP.observeCommunicationPatterns(messageLog);
}

export function compressToEmergentSymbol(pattern: string): string {
  return globalELP.compressToEmergentSymbol(pattern);
}

export function decompressSymbol(symbol: string): string {
  return globalELP.decompressSymbol(symbol);
}

export function compressMessage(message: string): string {
  return globalELP.compressMessage(message);
}

export function decompressMessage(message: string): string {
  return globalELP.decompressMessage(message);
}

export function getEmergentVocabulary(): EmergentSymbol[] {
  return globalELP.getEmergentVocabulary();
}

export function initEmergentLanguageProtocol(): void {
  console.log("[ELP] Emergent Language Protocol initialized.");
  // Seed with common Andromeda communication patterns
  const seedPatterns = [
    "proposal accepted with reward",
    "running RSI improvement cycle",
    "capability score updated",
    "LLM call completed successfully",
    "test suite passed with",
  ];
  for (const pattern of seedPatterns) {
    // Observe 3 times to hit threshold
    for (let i = 0; i < 3; i++) {
      globalELP.compressToEmergentSymbol(pattern);
    }
  }
  console.log(`[ELP] Vocabulary seeded with ${globalELP.getEmergentVocabulary().length} symbols.`);
}
