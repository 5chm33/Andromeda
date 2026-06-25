/**
 * llmRouter.ts — Automatic LLM Provider Routing
 * Andromeda v5.5
 *
 * Analyzes incoming queries and automatically selects the optimal LLM provider
 * based on task complexity, type, and required capabilities. This eliminates
 * the need for users to manually switch providers.
 *
 * Routing Strategy:
 *  - Simple factual / short queries → Groq (fastest) or Ollama (local)
 *  - Code generation / debugging → DeepSeek (best code model)
 *  - Complex reasoning / math → DeepSeek Reasoner
 *  - Creative writing / long-form → Anthropic (best prose)
 *  - Vision / image analysis → OpenAI GPT-4o (vision support)
 *  - General / default → DeepSeek Chat
 */

import { getActiveProvider, setActiveProvider } from "./llmProvider";

// ─── Task Classification ────────────────────────────────────────────────────

export type TaskType =
  | "code"
  | "reasoning"
  | "creative"
  | "factual"
  | "vision"
  | "self_modification"  // v5.87: Self-modification tasks always use Claude (no truncation)
  | "general";

export interface RoutingDecision {
  taskType: TaskType;
  selectedProvider: string;
  confidence: number;       // 0-1
  reason: string;
  previousProvider: string; // so we can restore if needed
}

export interface RoutingConfig {
  enabled: boolean;
  preferLocal: boolean;       // prefer Ollama when available
  costSensitive: boolean;     // prefer cheaper models for simple tasks
  speedPriority: boolean;     // prefer fastest response time
  overrides: Partial<Record<TaskType, string>>;  // manual task→provider overrides
}

// ─── Default Routing Config ─────────────────────────────────────────────────

let routingConfig: RoutingConfig = {
  enabled: true,
  preferLocal: false,
  costSensitive: true,
  speedPriority: false,
  overrides: {},
};

export function getRoutingConfig(): RoutingConfig {
  return { ...routingConfig };
}

export function setRoutingConfig(config: Partial<RoutingConfig>): void {
  routingConfig = { ...routingConfig, ...config };
}

// ─── Pattern Matchers ───────────────────────────────────────────────────────

const CODE_PATTERNS = [
  /\b(function|class|import|export|const|let|var|def|async|await|return)\b/i,
  /\b(typescript|javascript|python|rust|java|golang|c\+\+|react|node\.?js)\b/i,
  /\b(bug|error|fix|debug|refactor|implement|compile|syntax|runtime)\b/i,
  /\b(api|endpoint|route|middleware|database|query|schema|migration)\b/i,
  /```[\s\S]*```/,                // code blocks
  /\.(ts|js|py|rs|go|java|cpp|c|rb|php)\b/,  // file extensions
  /\b(npm|pip|cargo|pnpm|yarn|docker)\b/i,
];

const REASONING_PATTERNS = [
  /\b(prove|theorem|lemma|axiom|conjecture|hypothesis)\b/i,
  /\b(calculate|compute|solve|equation|formula|integral|derivative)\b/i,
  /\b(logic|logical|deduce|infer|implication|contradiction)\b/i,
  /\b(step.by.step|chain.of.thought|reasoning|think.through)\b/i,
  /\b(algorithm|complexity|O\(n\)|dynamic.programming|recursion)\b/i,
  /\b(probability|statistics|bayesian|regression|correlation)\b/i,
  /\b(why|how does|explain the mechanism|what causes)\b/i,
  /\d+[\+\-\*\/\^]\d+/,          // math expressions
];

const CREATIVE_PATTERNS = [
  /\b(write|compose|draft|create|generate).{0,20}(story|poem|essay|article|blog|novel|script)\b/i,
  /\b(creative|imaginative|fictional|narrative|prose|poetry)\b/i,
  /\b(tone|voice|style|metaphor|analogy|imagery)\b/i,
  /\b(rewrite|rephrase|paraphrase|summarize|expand).{0,30}(text|paragraph|section)\b/i,
  /\b(marketing|copy|slogan|tagline|headline|pitch)\b/i,
  /\b(letter|email|speech|presentation|proposal)\b.*\b(write|draft|compose)\b/i,
];

const FACTUAL_PATTERNS = [
  /\b(what is|who is|when did|where is|how many|how much)\b/i,
  /\b(define|definition|meaning of)\b/i,
  /\b(list|name|enumerate)\b.{0,20}\b(types|kinds|examples|categories)\b/i,
  /\b(capital|population|founded|invented|discovered)\b/i,
  /\b(yes or no|true or false|is it)\b/i,
];

const VISION_PATTERNS = [
  /\b(image|picture|photo|screenshot|diagram|chart|graph)\b/i,
  /\b(look at|analyze|describe).{0,20}(image|picture|photo|screenshot)\b/i,
  /\b(what.?s in|what do you see|identify|recognize)\b.*\b(image|photo|picture)\b/i,
  /\b(ocr|read.?text|extract.?text)\b.*\b(image|screenshot)\b/i,
];

// v5.87: Self-modification patterns — these tasks MUST use Claude (not DeepSeek)
// DeepSeek chat truncates large code outputs which breaks self-modification completely.
const SELF_MODIFY_PATTERNS = [
  /\b(self.modif|self.improv|self.patch|self.write|self.read.server|self.diagnos)\b/i,
  /\b(reactEngine|llmProvider|selfModify|truncation|streaming.fix)\b/i,
  /\b(self_patch_file|self_write_file|self_read_server_file|run_type_check)\b/i,
  /\b(fix.*your.*code|patch.*your.*code|update.*your.*code|improve.*your.*code)\b/i,
  /\b(look at your code|examine your code|read your code|your source code|your codebase)\b/i,
  /\b(autonomous|self.aware|self.enhanc|fully autonomous|SOTA.*yourself)\b/i,
];

// ─── Task Classifier ────────────────────────────────────────────────────────

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

export function classifyTask(query: string, hasImages?: boolean): { type: TaskType; confidence: number } {
  // If images are attached, it's almost certainly a vision task
  if (hasImages) {
    return { type: "vision", confidence: 0.95 };
  }

  // v5.87: Check self_modification FIRST — these tasks MUST use Claude, not DeepSeek.
  // If ANY self-modification pattern matches, override all other classification.
  const selfModScore = countMatches(query, SELF_MODIFY_PATTERNS);
  if (selfModScore >= 1) {
    return { type: "self_modification", confidence: 0.90 };
  }

  const scores: Record<TaskType, number> = {
    code: countMatches(query, CODE_PATTERNS),
    reasoning: countMatches(query, REASONING_PATTERNS),
    creative: countMatches(query, CREATIVE_PATTERNS),
    factual: countMatches(query, FACTUAL_PATTERNS),
    vision: countMatches(query, VISION_PATTERNS),
    self_modification: 0, // already checked above
    general: 1, // baseline score
  };

  // Normalize: longer queries naturally match more patterns, so normalize by query length
  const wordCount = query.split(/\s+/).length;
  const lengthBonus = wordCount > 50 ? 1.2 : wordCount > 20 ? 1.0 : 0.8;

  // Find the highest scoring type
  let maxType: TaskType = "general";
  let maxScore = 0;

  for (const [type, score] of Object.entries(scores) as [TaskType, number][]) {
    const adjusted = type === "general" ? score : score * lengthBonus;
    if (adjusted > maxScore) {
      maxScore = adjusted;
      maxType = type;
    }
  }

  // Calculate confidence based on how much the winner exceeds the runner-up
  const sortedScores = Object.values(scores).sort((a, b) => b - a);
  const gap = sortedScores[0] - (sortedScores[1] ?? 0);
  const confidence = Math.min(0.95, 0.4 + gap * 0.15);

  return { type: maxType, confidence };
}

// ─── Provider Selection ─────────────────────────────────────────────────────

// v5.87: Updated routing table — Claude (via OpenRouter) for code/self-modification/general.
// KEY CHANGE: self_modification always uses openrouter (Claude Sonnet) — DeepSeek chat
// truncates large code outputs which breaks self-modification completely.
const DEFAULT_ROUTING_TABLE: Record<TaskType, string[]> = {
  code:            ["openrouter", "kimi", "deepseek"],               // Claude for code (no truncation), Kimi fallback
  reasoning:       ["deepseek-reasoner", "openrouter", "deepseek"], // R1 for math/logic, Claude as fallback
  creative:        ["openrouter", "deepseek"],                       // Claude for prose
  factual:         ["openrouter-fast", "groq", "deepseek"],          // Gemini Flash for fast factual
  vision:          ["openrouter", "deepseek"],                       // Claude vision is best
  self_modification: ["openrouter", "kimi"],                         // ALWAYS Claude — never DeepSeek for self-mod
  general:         ["openrouter", "deepseek", "kimi"],               // Claude default, DeepSeek fallback
};

function selectProvider(taskType: TaskType): string {
  // Check for manual override first
  if (routingConfig.overrides[taskType]) {
    return routingConfig.overrides[taskType]!;
  }

  // Get the candidate list
  const candidates = DEFAULT_ROUTING_TABLE[taskType] ?? DEFAULT_ROUTING_TABLE.general;

  // Apply preferences
  if (routingConfig.preferLocal && candidates.includes("ollama")) {
    return "ollama";
  }

  if (routingConfig.speedPriority) {
    // Groq is fastest, then Ollama (local), then others
    const speedOrder = ["groq", "ollama", ...candidates];
    for (const id of speedOrder) {
      if (candidates.includes(id)) return id;
    }
  }

  if (routingConfig.costSensitive) {
    // v5.93: NEVER apply cost override to self_modification or code tasks.
    // DeepSeek chat truncates large code outputs — using it for these tasks
    // breaks self-modification completely regardless of cost preference.
    if (taskType !== "self_modification" && taskType !== "code") {
      const costOrder = ["ollama", "deepseek", "groq", ...candidates];
      for (const id of costOrder) {
        if (candidates.includes(id)) return id;
      }
    }
  }

  // Default: use the first candidate (best quality for that task type)
  return candidates[0];
}

// ─── Main Routing Function ──────────────────────────────────────────────────

/**
 * Analyzes a query and automatically routes to the optimal LLM provider.
 * Returns the routing decision without actually switching the provider
 * (call applyRouting() to switch).
 */
export function routeQuery(query: string, hasImages?: boolean): RoutingDecision {
  const { type, confidence } = classifyTask(query, hasImages);
  const selectedProvider = selectProvider(type);
  const previousProvider = getActiveProvider().id;

  return {
    taskType: type,
    selectedProvider,
    confidence,
    reason: `Classified as "${type}" (confidence: ${(confidence * 100).toFixed(0)}%) → routing to ${selectedProvider}`,
    previousProvider,
  };
}

/**
 * Applies a routing decision by switching the active provider.
 * Returns true if the provider was actually changed.
 */
export function applyRouting(decision: RoutingDecision): boolean {
  if (!routingConfig.enabled) return false;

  const current = getActiveProvider().id;
  if (current === decision.selectedProvider) return false;

  // Only switch if confidence is high enough
  if (decision.confidence < 0.5) return false;

  setActiveProvider({ id: decision.selectedProvider });
  return true;
}

/**
 * Convenience function: classify + select + apply in one call.
 * Returns the routing decision.
 */
export function autoRoute(query: string, hasImages?: boolean): RoutingDecision {
  const decision = routeQuery(query, hasImages);
  applyRouting(decision);
  return decision;
}

/**
 * Restore the provider to what it was before routing.
 * Useful for one-shot routing where you want to revert after the call.
 */
export function restoreProvider(decision: RoutingDecision): void {
  setActiveProvider({ id: decision.previousProvider });
}

// ─── v5.49: Tier-Based Routing ──────────────────────────────────────────────
// Maps UI tier names to provider IDs (Manus-style: Auto / Fast / Coding / Max)

export type ModelTier = "auto" | "fast" | "coding" | "max";

// v6.18: Smart tier provider selection — uses cheapest/best available provider per tier
function getAutoProvider(): string {
  const envModel = process.env.LLM_MODEL ?? "";
  if (envModel && !['deepseek','deepseek-chat','deepseek-v3',''].includes(envModel)) return envModel;
  // v12.3.2: Kimi first for easy/auto tasks (free, fast, good quality)
  // DeepSeek V4 Pro for harder tasks (standard tier), Claude for hardest (max tier)
  if (process.env.KIMI_API_KEY) return "kimi";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  return "openrouter-fast"; // fallback to Gemini Flash if no other key
}
function getCodingProvider(): string {
  // v12.3.2: DeepSeek V4 Pro for hard coding tasks (standard tier)
  // Kimi as fallback (free, excellent code quality)
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.KIMI_API_KEY) return "kimi";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  return "deepseek";
}
function getMaxProvider(): string {
  // Max tier: highest quality — Claude Opus if available, else DeepSeek
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  return "deepseek";
}
function getFastProvider(): string {
  // Fast tier: Gemini Flash via OpenRouter, or DeepSeek
  if (process.env.OPENROUTER_API_KEY) return "openrouter-fast";
  return "deepseek";
}

export const TIER_PROVIDERS: Record<ModelTier, string> = {
  get auto()   { return getAutoProvider(); },   // v6.18: DeepSeek-first
  get fast()   { return getFastProvider(); },   // v6.18: Gemini Flash → DeepSeek
  get coding() { return getCodingProvider(); }, // v6.18: Kimi → Claude → DeepSeek
  get max()    { return getMaxProvider(); },    // v6.18: Claude → DeepSeek
};

export const TIER_LABELS: Record<ModelTier, { label: string; model: string; description: string }> = {
  auto:   { label: "Auto",   model: "Kimi k2.6",           description: "Smart default — Kimi for easy tasks, fast & free (~$0.00)" },
  fast:   { label: "Fast",   model: "Gemini 2.5 Flash",    description: "Fastest responses, lowest cost (~$0.10/M)" },
  coding: { label: "Code",   model: "DeepSeek V4 Pro",     description: "Hard tasks — DeepSeek V4 Pro for deep reasoning (~$0.28/M)" },
  max:    { label: "Max",    model: "Claude Opus 4",        description: "Hardest tasks — Claude Opus 4 via OpenRouter (~$15/M)" },
};

/**
 * Switch the active provider to the given tier.
 * Returns the provider id that was selected.
 */
export function applyTier(tier: ModelTier): string {
  const providerId = TIER_PROVIDERS[tier];
  setActiveProvider({ id: providerId });
  return providerId;
}

