/**
 * intentParser.ts — v60.0.0 "The Communication Layer"
 * Parses user utterances into structured intents with entities and confidence.
 */

export interface IntentDefinition { intentId: string; name: string; patterns: string[]; requiredEntities: string[]; }
export interface ParsedIntent { parseId: string; rawInput: string; intentName: string; confidence: number; entities: Record<string, string>; }

const intents = new Map<string, IntentDefinition>();
const parsed: ParsedIntent[] = [];
let iCounter = 0, pCounter = 0;

export function defineIntent(name: string, patterns: string[], requiredEntities: string[]): IntentDefinition {
  const intent: IntentDefinition = { intentId: `int-${++iCounter}`, name, patterns, requiredEntities };
  intents.set(intent.intentId, intent);
  return intent;
}

export function parseIntent(input: string): ParsedIntent {
  const lower = input.toLowerCase();
  let bestMatch: IntentDefinition | null = null;
  let bestScore = 0;
  for (const intent of intents.values()) {
    for (const pattern of intent.patterns) {
      const words = pattern.toLowerCase().split(/\s+/);
      const matches = words.filter(w => lower.includes(w)).length;
      const score = matches / words.length;
      if (score > bestScore) { bestScore = score; bestMatch = intent; }
    }
  }
  const result: ParsedIntent = {
    parseId: `parse-${++pCounter}`,
    rawInput: input,
    intentName: bestMatch?.name ?? "unknown",
    confidence: bestScore,
    entities: {},
  };
  parsed.push(result);
  return result;
}

export function getParsedIntents(): ParsedIntent[] { return [...parsed]; }
export function _resetIntentParserForTest(): void { intents.clear(); parsed.length = 0; iCounter = 0; pCounter = 0; }
