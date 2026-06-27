/**
 * documentSummarizer.ts — v82.0.0 "Document Intelligence"
 * Generates extractive summaries of documents using sentence scoring.
 */
export type SummaryLength = "short" | "medium" | "long";

export interface SummaryResult {
  docId: string;
  originalWordCount: number;
  summaryWordCount: number;
  compressionRatio: number;
  summary: string;
  keyPhrases: string[];
  length: SummaryLength;
}

function scoreSentences(sentences: string[], wordFreq: Map<string, number>): Array<{ sentence: string; score: number }> {
  return sentences.map(sentence => {
    const words = sentence.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const score = words.reduce((sum, w) => sum + (wordFreq.get(w) ?? 0), 0) / Math.max(words.length, 1);
    return { sentence, score };
  });
}

function extractKeyPhrases(text: string, count = 5): string[] {
  const stopWords = new Set(["the", "and", "for", "that", "this", "with", "from", "are", "was", "were", "have", "has", "been", "will", "would", "could", "should", "their", "they", "which"]);
  const wordFreq = new Map<string, number>();
  text.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !stopWords.has(w)).forEach(w => wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1));
  return [...wordFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, count).map(([w]) => w);
}

export function summarize(docId: string, content: string, length: SummaryLength = "medium"): SummaryResult {
  const sentenceCount = { short: 2, medium: 4, long: 7 }[length];
  const sentences = content.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 20);

  const stopWords = new Set(["the", "and", "for", "that", "this", "with", "from", "are", "was"]);
  const wordFreq = new Map<string, number>();
  content.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !stopWords.has(w)).forEach(w => wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1));

  const scored = scoreSentences(sentences, wordFreq);
  scored.sort((a, b) => b.score - a.score);
  const topSentences = scored.slice(0, sentenceCount).map(s => s.sentence);

  // Restore original order
  const orderedSummary = sentences.filter(s => topSentences.includes(s)).join(" ");
  const summaryWords = orderedSummary.split(/\s+/).filter(Boolean).length;
  const originalWords = content.split(/\s+/).filter(Boolean).length;

  return {
    docId,
    originalWordCount: originalWords,
    summaryWordCount: summaryWords,
    compressionRatio: originalWords > 0 ? summaryWords / originalWords : 0,
    summary: orderedSummary || content.slice(0, 200),
    keyPhrases: extractKeyPhrases(content),
    length,
  };
}
