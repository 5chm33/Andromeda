/**
 * piiRedactor.ts — v74.0.0 "Privacy & Data Protection"
 * Detects and redacts PII (emails, phone numbers, SSNs, credit cards, names) from text.
 */
export type PiiType = "email" | "phone" | "ssn" | "credit_card" | "ip_address" | "custom";

export interface PiiMatch {
  piiType: PiiType;
  original: string;
  startIndex: number;
  endIndex: number;
}

export interface RedactionResult {
  redactionId: string;
  originalText: string;
  redactedText: string;
  matches: PiiMatch[];
  redactionCount: number;
}

const redactionHistory: RedactionResult[] = [];
let redactionCounter = 0;

const PII_PATTERNS: Array<{ type: PiiType; pattern: RegExp; replacement: string }> = [
  { type: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL]" },
  { type: "phone", pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, replacement: "[PHONE]" },
  { type: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN]" },
  { type: "credit_card", pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replacement: "[CREDIT_CARD]" },
  { type: "ip_address", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: "[IP_ADDRESS]" },
];

export function redactPii(text: string, customPatterns: Array<{ type: string; pattern: RegExp; replacement: string }> = []): RedactionResult {
  let redactedText = text;
  const matches: PiiMatch[] = [];

  for (const { type, pattern, replacement } of PII_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push({ piiType: type, original: match[0], startIndex: match.index, endIndex: match.index + match[0].length });
    }
    redactedText = redactedText.replace(new RegExp(pattern.source, pattern.flags), replacement);
  }

  for (const { pattern, replacement } of customPatterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push({ piiType: "custom", original: match[0], startIndex: match.index, endIndex: match.index + match[0].length });
    }
    redactedText = redactedText.replace(new RegExp(pattern.source, pattern.flags), replacement);
  }

  const result: RedactionResult = {
    redactionId: `redaction-${++redactionCounter}`,
    originalText: text,
    redactedText,
    matches,
    redactionCount: matches.length,
  };
  redactionHistory.push(result);
  return result;
}

export function getRedactionHistory(): RedactionResult[] { return [...redactionHistory]; }
export function _resetPiiRedactorForTest(): void { redactionHistory.length = 0; redactionCounter = 0; }
