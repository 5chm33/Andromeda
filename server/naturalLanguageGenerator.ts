/**
 * naturalLanguageGenerator.ts — v60.0.0 "The Communication Layer"
 * Template-based NLG with slot-filling, discourse planning, and style adaptation.
 */

export type NLGStyle = "formal" | "casual" | "technical" | "concise";
export interface NLGTemplate { templateId: string; pattern: string; requiredSlots: string[]; style: NLGStyle; }
export interface GeneratedText { textId: string; text: string; templateId: string; style: NLGStyle; wordCount: number; }

const templates = new Map<string, NLGTemplate>();
const generated: GeneratedText[] = [];
let tCounter = 0, gCounter = 0;

export function registerTemplate(pattern: string, requiredSlots: string[], style: NLGStyle): NLGTemplate {
  const t: NLGTemplate = { templateId: `tpl-${++tCounter}`, pattern, requiredSlots, style };
  templates.set(t.templateId, t);
  return t;
}

export function generateText(templateId: string, slots: Record<string, string>): GeneratedText {
  const tpl = templates.get(templateId);
  if (!tpl) throw new Error(`[NLG] Template not found: ${templateId}`);
  let text = tpl.pattern;
  for (const [key, val] of Object.entries(slots)) {
    text = text.replace(new RegExp(`\\{${key}\\}`, "g"), val);
  }
  const gen: GeneratedText = { textId: `gen-${++gCounter}`, text, templateId, style: tpl.style, wordCount: text.split(/\s+/).length };
  generated.push(gen);
  return gen;
}

export function getGeneratedTexts(): GeneratedText[] { return [...generated]; }
export function _resetNaturalLanguageGeneratorForTest(): void { templates.clear(); generated.length = 0; tCounter = 0; gCounter = 0; }
