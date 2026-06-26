/**
 * Semantic Compressor — compresses knowledge representations while preserving semantics.
 * Implements concept clustering, redundancy elimination, and semantic hashing.
 */

export interface SemanticChunk {
  id: string;
  content: string;
  tokens: number;
  semanticHash: number;
  cluster: string;
  importance: number;  // 0-1
}

export interface CompressionResult {
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  semanticPreservation: number;  // 0-1
  chunks: SemanticChunk[];
  deduplicatedCount: number;
}

export interface CompressorReport {
  totalCompressions: number;
  avgCompressionRatio: number;
  avgSemanticPreservation: number;
  totalTokensSaved: number;
}

class SemanticCompressorEngine {
  private compressions: CompressionResult[] = [];
  private counter = 0;

  private _semanticHash(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  private _clusterContent(text: string): string {
    const keywords = ["optimization", "learning", "safety", "capability", "reward", "policy"];
    for (const kw of keywords) {
      if (text.toLowerCase().includes(kw)) return kw;
    }
    return "general";
  }

  compress(content: string, targetRatio = 0.5): CompressionResult {
    const words = content.split(/\s+/);
    const originalTokens = words.length;

    // Split into semantic chunks (sentences)
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const chunks: SemanticChunk[] = sentences.map((s, i) => ({
      id: `chunk-${++this.counter}`,
      content: s.trim(),
      tokens: s.split(/\s+/).length,
      semanticHash: this._semanticHash(s),
      cluster: this._clusterContent(s),
      importance: 1 / (1 + i * 0.1), // Earlier sentences more important
    }));

    // Deduplicate by semantic hash
    const seenHashes = new Set<number>();
    const deduped: SemanticChunk[] = [];
    let deduplicatedCount = 0;
    for (const chunk of chunks) {
      if (!seenHashes.has(chunk.semanticHash)) {
        seenHashes.add(chunk.semanticHash);
        deduped.push(chunk);
      } else {
        deduplicatedCount++;
      }
    }

    // Keep top chunks by importance to hit target ratio
    const sorted = deduped.sort((a, b) => b.importance - a.importance);
    const targetTokens = Math.ceil(originalTokens * targetRatio);
    let accumulated = 0;
    const selected: SemanticChunk[] = [];
    for (const chunk of sorted) {
      if (accumulated + chunk.tokens <= targetTokens) {
        selected.push(chunk);
        accumulated += chunk.tokens;
      }
    }

    const compressionRatio = originalTokens > 0 ? accumulated / originalTokens : 1;
    const semanticPreservation = deduped.length > 0 ? selected.length / deduped.length : 1;

    const result: CompressionResult = {
      originalTokens,
      compressedTokens: accumulated,
      compressionRatio,
      semanticPreservation,
      chunks: selected,
      deduplicatedCount,
    };
    this.compressions.push(result);
    return result;
  }

  getCompressorReport(): CompressorReport {
    return {
      totalCompressions: this.compressions.length,
      avgCompressionRatio: this.compressions.length > 0
        ? this.compressions.reduce((s, c) => s + c.compressionRatio, 0) / this.compressions.length
        : 0,
      avgSemanticPreservation: this.compressions.length > 0
        ? this.compressions.reduce((s, c) => s + c.semanticPreservation, 0) / this.compressions.length
        : 0,
      totalTokensSaved: this.compressions.reduce((s, c) => s + (c.originalTokens - c.compressedTokens), 0),
    };
  }
}

export const globalSemanticCompressor = new SemanticCompressorEngine();

export function compressSemantically(content: string, targetRatio?: number): CompressionResult {
  return globalSemanticCompressor.compress(content, targetRatio);
}
export function getCompressorReport(): CompressorReport {
  return globalSemanticCompressor.getCompressorReport();
}
export function initSemanticCompressor(): void {
  console.log("[SemanticCompressor] Semantic Compressor initialized.");
}
