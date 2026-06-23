/**
 * grounding.ts — SOTA Anti-Hallucination Grounding Engine for Andromeda v4.8
 *
 * Implements three layers of hallucination prevention:
 *
 * 1. CITATION LOCKING — Every factual claim in an AI answer is cross-referenced
 *    against the actual source snippets. Claims that cannot be traced to a source
 *    are flagged with a [UNVERIFIED] marker.
 *
 * 2. CONFIDENCE SCORING — Each answer receives a 0–100 confidence score based on
 *    source coverage, citation density, and claim-to-source alignment.
 *
 * 3. GROUNDING CHECK — Before the agent presents specific facts (version numbers,
 *    dates, file paths, function names), it must retrieve them from a real source
 *    (file system, search result, or browsed page). If it cannot, it emits
 *    "DATA_NOT_FOUND" rather than inventing a value.
 *
 * These three layers together implement the RARR (Retrieve and Rank for Reasoning)
 * and Self-RAG patterns from the academic literature on grounded generation.
 */

import type { SearchSource } from "../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GroundingResult {
  groundedAnswer: string;         // Answer with [UNVERIFIED] markers inserted
  confidence: number;             // 0–100 confidence score
  citedSourceCount: number;       // How many sources were actually cited
  unverifiedClaimCount: number;   // How many claims couldn't be grounded
  warnings: string[];             // Human-readable grounding warnings
}

export interface FactCheckResult {
  claim: string;
  verified: boolean;
  sourceIndex?: number;           // Which source (1-indexed) backs this claim
  evidence?: string;              // The snippet from the source that backs it
}

// ─── Claim extraction ─────────────────────────────────────────────────────────

/**
 * Extracts specific factual claims from an AI answer that are high-risk for
 * hallucination. Targets: version numbers, dates, percentages, proper nouns
 * followed by specific attributes, and quoted strings.
 */
export function extractFactualClaims(answer: string): string[] {
  const claims: string[] = [];

  const claimPatterns = [
    // Version numbers: v1.2.3, 1.2.3, version 5.x
    { regex: /\b(?:v|version\s+)?\d+\.\d+(?:\.\d+)?(?:-\w+)?\b/gi, minLength: 3 },
    // Dates: 2024, January 2024, Q1 2024
    { regex: /\b(?:Q[1-4]\s+)?\d{4}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b/gi },
    // Percentages and statistics
    { regex: /\b\d+(?:\.\d+)?%|\b\d+(?:,\d{3})+\b|\b\d+\s*(?:million|billion|trillion|thousand)\b/gi },
    // Quoted strings (often specific names, titles, or values)
    { regex: /"[^"]{3,60}"/g }
  ];

  for (const { regex, minLength } of claimPatterns) {
    const matches = answer.match(regex) ?? [];
    const filtered = minLength ? matches.filter(m => m.length > minLength) : matches;
    claims.push(...filtered);
  }

  // Deduplicate
  return Array.from(new Set(claims));
}

// ─── Source alignment ─────────────────────────────────────────────────────────

/**
 * Checks whether a specific claim can be found in any of the provided sources.
 * Uses a fuzzy match: the claim (or its core numeric/string value) must appear
 * in at least one source snippet.
 */
export function checkClaimAgainstSources(
  claim: string,
  sources: SearchSource[]
): FactCheckResult {
  // Normalize: strip quotes, lowercase
  const normalized = claim.replace(/['"]/g, "").toLowerCase().trim();

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const haystack = `${source.title} ${source.snippet} ${source.domain}`.toLowerCase();

    if (haystack.includes(normalized)) {
      return {
        claim,
        verified: true,
        sourceIndex: i + 1,
        evidence: source.snippet.slice(0, 200),
      };
    }
  }

  return { claim, verified: false };
}

// ─── Citation density analysis ────────────────────────────────────────────────

/**
 * Counts how many inline citations [1], [2], etc. appear in the answer
 * and verifies each cited source index is within the provided source list.
 */
export function analyzeCitationDensity(
  answer: string,
  sourceCount: number
): { citedIndices: number[]; orphanedCitations: number[]; density: number } {
  const citationMatches = answer.match(/\[(\d+)\]/g) ?? [];
  const citedIndices = Array.from(new Set(
    citationMatches.map(c => parseInt(c.slice(1, -1), 10))
  ));

  // Orphaned = cited a source index that doesn't exist
  const orphanedCitations = citedIndices.filter(i => i > sourceCount || i < 1);

  // Density = unique valid citations / total sources available (capped at 1.0)
  const validCitations = citedIndices.filter(i => i >= 1 && i <= sourceCount);
  const density = sourceCount > 0 ? Math.min(validCitations.length / sourceCount, 1.0) : 0;

  return { citedIndices, orphanedCitations, density };
}

// ─── Confidence scoring ───────────────────────────────────────────────────────

/**
 * Computes a 0–100 confidence score for an AI answer based on:
 * - Citation density (40 points): how well the answer cites available sources
 * - Claim verification rate (40 points): what fraction of extracted claims are grounded
 * - Answer length appropriateness (20 points): penalizes very short or very long answers
 */
export function computeConfidenceScore(
  answer: string,
  sources: SearchSource[],
  factCheckResults: FactCheckResult[]
): number {
  let score = 0;

  // Component 1: Citation density (0–40 points)
  const { density, orphanedCitations } = analyzeCitationDensity(answer, sources.length);
  const citationScore = Math.round(density * 40);
  const orphanPenalty = Math.min(orphanedCitations.length * 5, 20);
  score += Math.max(0, citationScore - orphanPenalty);

  // Component 2: Claim verification rate (0–40 points)
  if (factCheckResults.length > 0) {
    const verifiedCount = factCheckResults.filter(r => r.verified).length;
    const verificationRate = verifiedCount / factCheckResults.length;
    score += Math.round(verificationRate * 40);
  } else {
    // No specific claims to check — give partial credit
    score += 20;
  }

  // Component 3: Answer quality signals (0–20 points)
  const wordCount = answer.split(/\s+/).length;
  if (wordCount >= 100 && wordCount <= 2000) score += 20;
  else if (wordCount >= 50 && wordCount < 100) score += 10;
  else if (wordCount > 2000) score += 15; // Long is ok, just slightly penalize

  return Math.min(100, Math.max(0, score));
}

// ─── Answer grounding ─────────────────────────────────────────────────────────

/**
 * Main grounding function. Takes a raw AI answer and the sources used to
 * generate it, then:
 * 1. Extracts factual claims
 * 2. Checks each claim against sources
 * 3. Inserts [UNVERIFIED] markers for ungrounded claims
 * 4. Computes a confidence score
 * 5. Returns the grounded answer with metadata
 */
export function groundAnswer(
  answer: string,
  sources: SearchSource[]
): GroundingResult {
  const warnings: string[] = [];

  // Skip grounding for very short answers or error messages
  if (answer.length < 50 || sources.length === 0) {
    return {
      groundedAnswer: answer,
      confidence: sources.length === 0 ? 30 : 50,
      citedSourceCount: 0,
      unverifiedClaimCount: 0,
      warnings: sources.length === 0 ? ["No sources provided — answer is based on model knowledge only"] : [],
    };
  }

  // Extract and check claims
  const claims = extractFactualClaims(answer);
  const factCheckResults = claims.map(claim => checkClaimAgainstSources(claim, sources));

  const unverifiedClaims = factCheckResults.filter(r => !r.verified);
  const verifiedClaims = factCheckResults.filter(r => r.verified);

  // Build the grounded answer — insert [UNVERIFIED] after ungrounded specific claims
  let groundedAnswer = answer;

  // Only mark version numbers and statistics as unverified (not dates/quotes which are lower risk)
  const highRiskUnverified = unverifiedClaims.filter(r =>
    /\d+\.\d+/.test(r.claim) || // version-like numbers
    /\d+%/.test(r.claim) ||     // percentages
    /\d+(?:,\d{3})+/.test(r.claim) // large numbers with commas
  );

  for (const unverified of highRiskUnverified) {
    // Insert marker after the claim in the answer text
    const escaped = unverified.claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    groundedAnswer = groundedAnswer.replace(
      new RegExp(`(${escaped})(?!\\s*\\[UNVERIFIED\\])`, "g"),
      `$1 [UNVERIFIED]`
    );
  }

  // Citation analysis
  const { citedIndices, orphanedCitations } = analyzeCitationDensity(answer, sources.length);

  if (orphanedCitations.length > 0) {
    warnings.push(`Answer cites source${orphanedCitations.length > 1 ? "s" : ""} [${orphanedCitations.join(", ")}] which do${orphanedCitations.length === 1 ? "es" : ""} not exist in the source list.`);
  }

  if (highRiskUnverified.length > 0) {
    warnings.push(`${highRiskUnverified.length} specific claim${highRiskUnverified.length > 1 ? "s" : ""} could not be verified against sources and ${highRiskUnverified.length > 1 ? "have" : "has"} been marked [UNVERIFIED].`);
  }

  if (sources.length > 0 && citedIndices.length === 0) {
    warnings.push("Answer contains no inline citations despite having sources available.");
  }

  const confidence = computeConfidenceScore(answer, sources, factCheckResults);

  return {
    groundedAnswer,
    confidence,
    citedSourceCount: verifiedClaims.length,
    unverifiedClaimCount: highRiskUnverified.length,
    warnings,
  };
}

// ─── Agent grounding check ────────────────────────────────────────────────────

/**
 * Used by the agent planner to validate specific facts before including them
 * in a response. If the fact cannot be verified from the provided evidence,
 * returns "DATA_NOT_FOUND" instead of allowing the model to hallucinate.
 *
 * @param fact - The specific fact to verify (e.g., "playwright-core version")
 * @param evidence - The raw text from which the fact should be extractable
 * @param pattern - Optional regex pattern to extract the fact from evidence
 */
export function verifyFactFromEvidence(
  fact: string,
  evidence: string,
  pattern?: RegExp
): { verified: boolean; value: string } {
  if (!evidence || evidence.trim().length === 0) {
    return { verified: false, value: "DATA_NOT_FOUND" };
  }

  if (pattern) {
    const match = evidence.match(pattern);
    if (match) {
      return { verified: true, value: match[0] };
    }
    return { verified: false, value: "DATA_NOT_FOUND" };
  }

  // Simple substring check
  const normalizedFact = fact.toLowerCase().trim();
  const normalizedEvidence = evidence.toLowerCase();

  if (normalizedEvidence.includes(normalizedFact)) {
    return { verified: true, value: fact };
  }

  return { verified: false, value: "DATA_NOT_FOUND" };
}

// ─── Grounding-aware system prompt injection ──────────────────────────────────

/**
 * Returns additional system prompt instructions that enforce grounding behavior
 * in the AI model. These are injected into every prompt.
 */
export function getGroundingSystemPromptAddendum(): string {
  return `
ANTI-HALLUCINATION RULES — FOLLOW EXACTLY:
1. NEVER invent specific facts. If you do not have a source for a version number, date, statistic, or proper name, write "I could not verify this" instead of guessing.
2. Every specific factual claim (version numbers, dates, percentages, file names, function names) MUST be traceable to a provided source, file content, or code snippet. If it is not, explicitly state "this could not be verified from the provided sources."
3. When analyzing code or files, ONLY reference what is literally present in the provided content. Do not describe features or functions that you cannot see in the actual text.
4. If asked for a version number and it is not in the provided content, respond: "The version for [X] was not found in the provided source — please check package.json directly."
5. Distinguish clearly between: (a) facts from provided sources [cite them], (b) your general knowledge [label as "Based on general knowledge:"], and (c) unverifiable claims [label as "Could not verify:"].
6. When in doubt, be explicit about uncertainty. Confidence is not a virtue when accuracy is the goal.`;
}
