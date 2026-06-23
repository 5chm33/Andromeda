/**
 * biasDetector.ts — Media Bias Detection & Source Diversity Engine for Andromeda v5.0
 *
 * Implements three layers of honest information delivery:
 *   1. Source bias labeling (political slant, state affiliation, sensationalism)
 *   2. Geographic and viewpoint diversity scoring
 *   3. Censorship detection (flagging when coverage is suspiciously one-sided)
 *
 * Philosophy: The goal is not to tell users what to think, but to give them
 * full transparency about WHERE information is coming from and WHO is funding it.
 * Every person deserves to know if a source is state-controlled, billionaire-owned,
 * or systematically omitting perspectives from affected communities.
 */

import type { SearchSource } from "../drizzle/schema";

// ─── Source Bias Database ─────────────────────────────────────────────────────
// A curated, evidence-based database of known source biases.
// Sources: AllSides.com, MediaBiasFactCheck.com, academic literature.
// This is NOT an exhaustive list — the AI will also perform dynamic analysis.

export type PoliticalSlant = "far-left" | "left" | "center-left" | "center" | "center-right" | "right" | "far-right" | "unknown";
export type OwnershipType = "corporate" | "state-affiliated" | "independent" | "billionaire-owned" | "nonprofit" | "unknown";
export type SensationalismLevel = "low" | "medium" | "high" | "unknown";

export interface SourceBiasProfile {
  domain: string;
  politicalSlant: PoliticalSlant;
  ownership: OwnershipType;
  ownershipNote?: string;   // e.g., "Owned by Jeff Bezos (Amazon)"
  sensationalism: SensationalismLevel;
  stateAffiliated?: string; // e.g., "China", "Russia", "US Government"
  notes?: string;
}

// Known bias profiles for major news sources
const KNOWN_BIAS_PROFILES: SourceBiasProfile[] = [
  // US Corporate / Billionaire-Owned
  { domain: "washingtonpost.com", politicalSlant: "center-left", ownership: "billionaire-owned", ownershipNote: "Owned by Jeff Bezos (Amazon founder)", sensationalism: "low" },
  { domain: "wsj.com", politicalSlant: "center-right", ownership: "corporate", ownershipNote: "Owned by Rupert Murdoch (News Corp)", sensationalism: "low" },
  { domain: "foxnews.com", politicalSlant: "right", ownership: "corporate", ownershipNote: "Owned by Rupert Murdoch (News Corp)", sensationalism: "high" },
  { domain: "nytimes.com", politicalSlant: "center-left", ownership: "corporate", sensationalism: "low" },
  { domain: "cnn.com", politicalSlant: "center-left", ownership: "corporate", ownershipNote: "Owned by Warner Bros. Discovery", sensationalism: "medium" },
  { domain: "msnbc.com", politicalSlant: "left", ownership: "corporate", ownershipNote: "Owned by NBCUniversal (Comcast)", sensationalism: "medium" },
  { domain: "breitbart.com", politicalSlant: "far-right", ownership: "corporate", sensationalism: "high" },
  { domain: "huffpost.com", politicalSlant: "left", ownership: "corporate", ownershipNote: "Owned by BuzzFeed", sensationalism: "medium" },
  { domain: "theatlantic.com", politicalSlant: "center-left", ownership: "billionaire-owned", ownershipNote: "Owned by Laurene Powell Jobs (Apple founder's estate)", sensationalism: "low" },

  // UK
  { domain: "bbc.co.uk", politicalSlant: "center", ownership: "state-affiliated", stateAffiliated: "UK Government", ownershipNote: "Publicly funded via UK TV licence fee", sensationalism: "low" },
  { domain: "bbc.com", politicalSlant: "center", ownership: "state-affiliated", stateAffiliated: "UK Government", ownershipNote: "Publicly funded via UK TV licence fee", sensationalism: "low" },
  { domain: "theguardian.com", politicalSlant: "center-left", ownership: "nonprofit", ownershipNote: "Owned by Scott Trust (nonprofit)", sensationalism: "low" },
  { domain: "thetimes.co.uk", politicalSlant: "center-right", ownership: "corporate", ownershipNote: "Owned by Rupert Murdoch (News Corp)", sensationalism: "low" },
  { domain: "dailymail.co.uk", politicalSlant: "right", ownership: "corporate", sensationalism: "high" },

  // State-Affiliated International
  { domain: "rt.com", politicalSlant: "unknown", ownership: "state-affiliated", stateAffiliated: "Russian Government", ownershipNote: "Funded by the Russian government", sensationalism: "medium", notes: "Banned in EU/UK. Provides perspectives often absent from Western media." },
  { domain: "aljazeera.com", politicalSlant: "center", ownership: "state-affiliated", stateAffiliated: "Qatar Government", ownershipNote: "Funded by the Qatari government", sensationalism: "low", notes: "Provides strong coverage of Middle East, Africa, and Global South often absent from Western outlets." },
  { domain: "cgtn.com", politicalSlant: "unknown", ownership: "state-affiliated", stateAffiliated: "Chinese Government", ownershipNote: "Operated by China Media Group, a state entity", sensationalism: "low" },
  { domain: "presstv.ir", politicalSlant: "unknown", ownership: "state-affiliated", stateAffiliated: "Iranian Government", sensationalism: "medium" },
  { domain: "voanews.com", politicalSlant: "center", ownership: "state-affiliated", stateAffiliated: "US Government", ownershipNote: "Funded by the US Agency for Global Media", sensationalism: "low" },

  // Independent / Alternative
  { domain: "theintercept.com", politicalSlant: "left", ownership: "nonprofit", sensationalism: "low", notes: "Known for investigative journalism on government surveillance and corporate power." },
  { domain: "propublica.org", politicalSlant: "center-left", ownership: "nonprofit", sensationalism: "low", notes: "Award-winning investigative journalism nonprofit." },
  { domain: "democracynow.org", politicalSlant: "left", ownership: "nonprofit", sensationalism: "low" },
  { domain: "mintpressnews.com", politicalSlant: "left", ownership: "independent", sensationalism: "medium" },
  { domain: "consortiumnews.com", politicalSlant: "left", ownership: "independent", sensationalism: "low" },
  { domain: "mondoweiss.net", politicalSlant: "left", ownership: "nonprofit", sensationalism: "low", notes: "Focuses on Israeli-Palestinian conflict from a Palestinian rights perspective." },
  { domain: "972mag.com", politicalSlant: "left", ownership: "independent", sensationalism: "low", notes: "Independent Israeli-Palestinian publication." },
  { domain: "haaretz.com", politicalSlant: "center-left", ownership: "independent", sensationalism: "low", notes: "Israeli newspaper known for critical coverage of Israeli government." },
];

// ─── Bias Analysis Functions ──────────────────────────────────────────────────

/**
 * Looks up a known bias profile for a given domain.
 */
export function getKnownBiasProfile(domain: string): SourceBiasProfile | null {
  if (!domain) return null;
  const cleanDomain = domain.replace(/^www\./, "").toLowerCase();
  return KNOWN_BIAS_PROFILES.find(p => p.domain === cleanDomain) ?? null;
}

/**
 * Analyzes the text of a snippet for sensationalism signals.
 * Returns a score from 0 (calm) to 1 (highly sensational).
 */
function analyzeSensationalism(text: string): number {
  const sensationalPhrases = [
    "BREAKING", "SHOCKING", "BOMBSHELL", "EXPLOSIVE", "OUTRAGE",
    "SLAMS", "DESTROYS", "OBLITERATES", "STUNNING", "CHAOS",
    "MELTDOWN", "PANIC", "CRISIS", "CATASTROPHE", "DISASTER",
    "EXPOSED", "CAUGHT", "SECRET", "HIDDEN", "COVER-UP",
  ];
  const upperText = text.toUpperCase();
  const matches = sensationalPhrases.filter(p => upperText.includes(p)).length;
  return Math.min(1, matches / 3);
}

/**
 * Detects if a snippet uses dehumanizing language about any group.
 * Returns a warning string if detected, or null.
 */
function detectDehumanizingLanguage(text: string): string | null {
  const dehumanizingPatterns = [
    { pattern: /\b(swarm|invasion|flood|infestation)\b.*\b(migrant|refugee|immigrant)\b/i, warning: "Dehumanizing language detected: migrants/refugees described using animal/disaster metaphors." },
    { pattern: /\b(vermin|cockroach|parasite|pest)\b/i, warning: "Potentially dehumanizing language detected." },
  ];
  for (const { pattern, warning } of dehumanizingPatterns) {
    if (pattern.test(text)) return warning;
  }
  return null;
}

export interface AnnotatedSource extends SearchSource {
  biasProfile?: SourceBiasProfile | null;
  sensationalismScore?: number;
  dehumanizingWarning?: string | null;
}

/**
 * Annotates a list of search sources with bias profiles and analysis.
 */
export function annotateSources(sources: SearchSource[]): AnnotatedSource[] {
  if (!sources) return [];
  return sources.map(source => {
    const profile = getKnownBiasProfile(source.domain ?? "");
    const sensationalismScore = analyzeSensationalism(source.snippet ?? "");
    const dehumanizingWarning = detectDehumanizingLanguage(source.snippet ?? "");
    return {
      ...source,
      biasProfile: profile,
      sensationalismScore,
      dehumanizingWarning,
    };
  });
}

// ─── Diversity Scoring ────────────────────────────────────────────────────────

export interface DiversityReport {
  score: number;          // 0-100
  geographicDiversity: string[];
  slantDistribution: Partial<Record<PoliticalSlant, number>>;
  stateAffiliatedCount: number;
  billionaireOwnedCount: number;
  independentCount: number;
  warnings: string[];
}

/**
 * Analyzes a set of sources for diversity and returns a report.
 * A low score indicates the sources are homogeneous and potentially biased.
 */
export function analyzeDiversity(annotatedSources: AnnotatedSource[]): DiversityReport {
  if (!annotatedSources) return { score: 0, geographicDiversity: [], slantDistribution: {}, stateAffiliatedCount: 0, billionaireOwnedCount: 0, independentCount: 0, warnings: [] };
  const warnings: string[] = [];
  const slantDistribution: Partial<Record<PoliticalSlant, number>> = {};
  let stateAffiliatedCount = 0;
  let billionaireOwnedCount = 0;
  let independentCount = 0;

  for (const source of annotatedSources) {
    if (!source.biasProfile) continue;
    const slant = source.biasProfile.politicalSlant;
    slantDistribution[slant] = (slantDistribution[slant] ?? 0) + 1;
    if (source.biasProfile.ownership === "state-affiliated") stateAffiliatedCount++;
    if (source.biasProfile.ownership === "billionaire-owned") billionaireOwnedCount++;
    if (source.biasProfile.ownership === "independent" || source.biasProfile.ownership === "nonprofit") independentCount++;
  }

  // Calculate diversity score using helper
  const score = calculateDiversityScore(slantDistribution, independentCount);

  // Generate warnings
  const maxSlantCount = Math.max(...Object.values(slantDistribution).map(v => v ?? 0), 0);
  const totalKnown = Object.values(slantDistribution).reduce((a, b) => a + b, 0);
  if (totalKnown > 0 && maxSlantCount / totalKnown > 0.7) {
    warnings.push(`Coverage is heavily skewed: ${Math.round((maxSlantCount / totalKnown) * 100)}% of sources share the same political slant.`);
  }
  if (stateAffiliatedCount > 2) {
    warnings.push(`${stateAffiliatedCount} sources are state-affiliated. Cross-reference with independent sources.`);
  }
  if (billionaireOwnedCount >= 3) {
    warnings.push(`${billionaireOwnedCount} sources are owned by billionaires or large corporations. Consider seeking independent perspectives.`);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    geographicDiversity: [], // Populated by domain TLD analysis in a future version
    slantDistribution,
    stateAffiliatedCount,
    billionaireOwnedCount,
    independentCount,
    warnings,
  };
}

/**
 * Calculates a diversity score based on slant distribution and independent source count.
 */
function calculateDiversityScore(
  slantDistribution: Partial<Record<PoliticalSlant, number>>,
  independentCount: number
): number {
  const BASE_SCORE = 50;
  const MAX_SLANT_BONUS = 30;
  const SLANT_BONUS_PER_UNIQUE = 10;
  const HOMOGENEITY_PENALTY = 20;
  const HOMOGENEITY_THRESHOLD = 0.7;
  const MAX_INDEPENDENT_BONUS = 20;
  const INDEPENDENT_BONUS_PER_SOURCE = 5;

  const uniqueSlants = Object.keys(slantDistribution).length;
  const totalKnown = Object.values(slantDistribution).reduce((a, b) => a + b, 0);
  let score = BASE_SCORE;

  score += Math.min(MAX_SLANT_BONUS, uniqueSlants * SLANT_BONUS_PER_UNIQUE);

  const maxSlantCount = Math.max(...Object.values(slantDistribution).map(v => v ?? 0), 0);
  if (totalKnown > 0 && maxSlantCount / totalKnown > HOMOGENEITY_THRESHOLD) {
    score -= HOMOGENEITY_PENALTY;
  }

  score += Math.min(MAX_INDEPENDENT_BONUS, independentCount * INDEPENDENT_BONUS_PER_SOURCE);

  return Math.max(0, Math.min(100, score));
}

// ─── Censorship Detection ─────────────────────────────────────────────────────

export interface CensorshipSignal {
  detected: boolean;
  confidence: "low" | "medium" | "high";
  message: string;
}

/**
 * Detects potential censorship or systematic omission of perspectives.
 * Looks for topics where coverage is suspiciously one-sided.
 */
export function detectCensorshipSignals(
  query: string,
  annotatedSources: AnnotatedSource[]
): CensorshipSignal {
  const queryLower = query.toLowerCase();

  // Topics known to have significant coverage gaps in Western mainstream media
  const sensitivePoliticalTopics = [
    { keywords: ["gaza", "palestine", "west bank", "idf", "hamas"], note: "Israeli-Palestinian conflict" },
    { keywords: ["ukraine", "nato", "zelensky", "donbas"], note: "Ukraine-Russia conflict" },
    { keywords: ["taiwan", "xinjiang", "uyghur", "tibet"], note: "China-related geopolitics" },
    { keywords: ["yemen", "saudi arabia", "houthi"], note: "Yemen conflict" },
    { keywords: ["iran", "sanctions", "nuclear"], note: "Iran geopolitics" },
    { keywords: ["julian assange", "wikileaks", "edward snowden"], note: "Press freedom / surveillance" },
  ];

  const matchedTopic = sensitivePoliticalTopics.find(topic =>
    topic.keywords.some(kw => queryLower.includes(kw))
  );

  if (!matchedTopic) {
    return { detected: false, confidence: "low", message: "" };
  }

  // Check if sources are predominantly from one political/geographic region
  const knownProfiles = annotatedSources.filter(s => s.biasProfile);
  const westernMainstreamCount = knownProfiles.filter(s =>
    ["center-left", "center", "center-right", "left", "right"].includes(s.biasProfile!.politicalSlant) &&
    s.biasProfile!.ownership !== "state-affiliated"
  ).length;

  const totalKnown = knownProfiles.length;
  const westernDominance = totalKnown > 0 ? westernMainstreamCount / totalKnown : 0;

  if (westernDominance > 0.8 && totalKnown >= 3) {
    return {
      detected: true,
      confidence: "medium",
      message: `This query relates to "${matchedTopic.note}", a topic with known coverage gaps in Western media. ${Math.round(westernDominance * 100)}% of sources are from Western mainstream outlets. Consider also consulting Al Jazeera, independent journalists, and primary source documents for a more complete picture.`,
    };
  }

  return { detected: false, confidence: "low", message: "" };
}

// ─── System Prompt Addendum ───────────────────────────────────────────────────

/**
 * Generates a system prompt addendum for news/current events queries.
 * This is injected into the AI's prompt to enforce honest, diverse reporting.
 */
export function buildHonestyPromptAddendum(
  diversityReport: DiversityReport,
  censorshipSignal: CensorshipSignal
): string {
  const parts: string[] = [];

  parts.push(`
HONESTY AND DIVERSITY MANDATE — FOLLOW EXACTLY:

You are required to provide honest, balanced, and complete information. You must NOT:
- Omit perspectives from affected communities, even if they contradict Western government narratives.
- Use dehumanizing language about any ethnic, religious, or national group.
- Present one government's framing of events as objective fact without acknowledging it is a framing.
- Downplay documented atrocities, war crimes, or human rights violations because of the nationality of the perpetrator.
- Treat the deaths or suffering of people from some countries as more newsworthy than others.

You MUST:
- Clearly distinguish between verified facts, official claims, and contested allegations.
- When covering conflicts, present the perspectives of ALL parties, especially civilians and affected communities.
- Acknowledge when evidence is disputed, incomplete, or when independent verification is impossible.
- Use precise, human language. People who are killed are killed. Civilian casualties are civilians, not "collateral damage."
`);

  if (diversityReport.warnings.length > 0) {
    parts.push(`\nSOURCE DIVERSITY WARNING: ${diversityReport.warnings.join(" ")} Compensate by explicitly noting what perspectives may be missing from the provided sources.`);
  }

  if (censorshipSignal.detected) {
    parts.push(`\nCENSORSHIP ALERT: ${censorshipSignal.message} Explicitly acknowledge this limitation in your answer and direct the user to seek additional sources.`);
  }

  return parts.join("\n");
}
