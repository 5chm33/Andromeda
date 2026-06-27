import { createLogger } from "./logger.js";
const log = createLogger("ConsentManager");
/**
 * consentManager.ts — v74.0.0 "Privacy & Data Protection"
 * Manages user consent records for data processing purposes.
 */
export type ConsentPurpose = "analytics" | "marketing" | "personalization" | "research" | "operations";
export type ConsentStatus = "granted" | "denied" | "pending" | "withdrawn";

export interface ConsentRecord {
  consentId: string;
  userId: string;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  grantedAt: number | null;
  expiresAt: number | null;
  withdrawnAt: number | null;
}

const consentStore = new Map<string, ConsentRecord[]>();
let consentCounter = 0;

function makeKey(userId: string, purpose: ConsentPurpose): string { return `${userId}::${purpose}`; }

export function grantConsent(userId: string, purpose: ConsentPurpose, expiryDays = 365): ConsentRecord {
  const record: ConsentRecord = {
    consentId: `consent-${++consentCounter}`,
    userId, purpose, status: "granted",
    grantedAt: Date.now(),
    expiresAt: Date.now() + expiryDays * 86400000,
    withdrawnAt: null,
  };
  const existing = consentStore.get(makeKey(userId, purpose)) ?? [];
  existing.push(record);
  consentStore.set(makeKey(userId, purpose), existing);
  log.info(`[ConsentManager] Consent granted: user=${userId} purpose=${purpose}`);
  return record;
}

export function withdrawConsent(userId: string, purpose: ConsentPurpose): boolean {
  const records = consentStore.get(makeKey(userId, purpose));
  if (!records) return false;
  const active = records.filter(r => r.status === "granted");
  active.forEach(r => { r.status = "withdrawn"; r.withdrawnAt = Date.now(); });
  return active.length > 0;
}

export function hasConsent(userId: string, purpose: ConsentPurpose): boolean {
  const records = consentStore.get(makeKey(userId, purpose)) ?? [];
  const now = Date.now();
  return records.some(r => r.status === "granted" && (r.expiresAt === null || r.expiresAt > now));
}

export function getConsentHistory(userId: string): ConsentRecord[] {
  const result: ConsentRecord[] = [];
  for (const [key, records] of consentStore.entries()) {
    if (key.startsWith(`${userId}::`)) result.push(...records);
  }
  return result;
}

export function _resetConsentManagerForTest(): void { consentStore.clear(); consentCounter = 0; }
