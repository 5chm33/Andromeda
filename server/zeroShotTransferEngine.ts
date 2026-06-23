/**
 * zeroShotTransferEngine.ts — v1.0.0
 *
 * Phase Q4 2026: Zero-Shot Transfer Learning Between Domains
 *
 * Enables Andromeda to apply patterns learned in one domain directly to another
 * without any additional training or fine-tuning.
 *
 * Examples:
 *   - Legal domain: "Always add explicit error handling for edge cases"
 *     → Code domain: "Add try/catch blocks for all async operations"
 *
 *   - Scientific domain: "Use control groups to validate hypotheses"
 *     → Code domain: "Add baseline benchmarks before measuring improvements"
 *
 *   - Logistics domain: "Batch small operations to reduce overhead"
 *     → Code domain: "Batch database queries to reduce round trips"
 *
 * How it works:
 *   1. Pattern Extraction: LongTermMemoryConsolidation extracts abstract patterns
 *   2. Abstraction: Patterns are generalized to domain-agnostic principles
 *   3. Transfer: Abstract principles are instantiated for the target domain
 *   4. Validation: Transferred patterns are tested before integration
 *
 * This is the key to making Andromeda a true general intelligence system —
 * knowledge gained in any domain enriches all other domains.
 */

import { createLogger } from "./logger.js";
import { backgroundChatCompletion } from "./llmProvider.js";

const log = createLogger("zeroShotTransfer");

// ─── Types ───────────────────────────────────────────────────────────────────

export type KnowledgeDomain =
  | "code"
  | "legal"
  | "scientific"
  | "logistics"
  | "writing"
  | "data_pipeline"
  | "robotics"
  | "energy"
  | "finance"
  | "education";

export interface AbstractPrinciple {
  id: string;
  name: string;
  description: string;           // Domain-agnostic description
  sourceDomain: KnowledgeDomain;
  sourcePattern: string;         // The original domain-specific pattern
  abstractForm: string;          // Generalized form
  applicableDomains: KnowledgeDomain[];
  confidence: number;            // 0-100: how confident we are in the abstraction
  transferCount: number;         // How many times this has been successfully transferred
  createdAt: number;
}

export interface TransferResult {
  id: string;
  principleId: string;
  sourceDomain: KnowledgeDomain;
  targetDomain: KnowledgeDomain;
  originalPattern: string;
  transferredPattern: string;
  rationale: string;
  validationScore: number;       // 0-100: how well it applies to the target domain
  accepted: boolean;
  createdAt: number;
}

export interface TransferStats {
  totalPrinciples: number;
  totalTransfers: number;
  acceptedTransfers: number;
  transfersByDomain: Record<string, number>;
  topPrinciples: Array<{ name: string; transferCount: number; confidence: number }>;
}

// ─── Seed Principles ─────────────────────────────────────────────────────────
// These are well-known cross-domain principles that bootstrap the transfer engine.
// Over time, LongTermMemoryConsolidation adds more from actual RSI cycles.
const SEED_PRINCIPLES: Omit<AbstractPrinciple, "id" | "createdAt">[] = [
  {
    name: "explicit_error_handling",
    description: "Always handle failure cases explicitly rather than assuming success",
    sourceDomain: "legal",
    sourcePattern: "Contracts must specify remedies for breach, not just success conditions",
    abstractForm: "For every operation that can fail, define explicit handling for the failure case",
    applicableDomains: ["code", "scientific", "logistics", "data_pipeline", "robotics"],
    confidence: 95,
    transferCount: 0,
  },
  {
    name: "batch_small_operations",
    description: "Group small repeated operations to reduce overhead",
    sourceDomain: "logistics",
    sourcePattern: "Consolidate shipments to reduce per-unit transportation cost",
    abstractForm: "When performing many small operations of the same type, batch them together",
    applicableDomains: ["code", "data_pipeline", "energy", "finance"],
    confidence: 88,
    transferCount: 0,
  },
  {
    name: "control_group_validation",
    description: "Always compare against a baseline before claiming improvement",
    sourceDomain: "scientific",
    sourcePattern: "Use control groups to isolate the effect of a single variable",
    abstractForm: "Establish a baseline measurement before making changes, then compare",
    applicableDomains: ["code", "logistics", "finance", "education"],
    confidence: 92,
    transferCount: 0,
  },
  {
    name: "separation_of_concerns",
    description: "Keep different types of logic in separate, independent units",
    sourceDomain: "legal",
    sourcePattern: "Separate liability clauses from performance obligations in contracts",
    abstractForm: "Divide complex systems into independent parts, each responsible for one thing",
    applicableDomains: ["code", "writing", "data_pipeline", "education"],
    confidence: 90,
    transferCount: 0,
  },
  {
    name: "progressive_disclosure",
    description: "Reveal complexity gradually, starting with the simplest case",
    sourceDomain: "education",
    sourcePattern: "Teach simple examples before complex ones to build understanding",
    abstractForm: "Structure information so that simple cases are encountered before complex ones",
    applicableDomains: ["code", "writing", "legal", "scientific"],
    confidence: 85,
    transferCount: 0,
  },
  {
    name: "idempotency",
    description: "Operations should produce the same result regardless of how many times they run",
    sourceDomain: "finance",
    sourcePattern: "Payment processing must be idempotent to prevent double-charges",
    abstractForm: "Design operations so that repeating them has no additional effect",
    applicableDomains: ["code", "data_pipeline", "logistics", "robotics"],
    confidence: 93,
    transferCount: 0,
  },
];

// ─── State ───────────────────────────────────────────────────────────────────
const principles: Map<string, AbstractPrinciple> = new Map();
const transfers: Map<string, TransferResult> = new Map();

// ─── Initialization ───────────────────────────────────────────────────────────

function seedPrinciples(): void {
  for (const seed of SEED_PRINCIPLES) {
    const id = `principle-${seed.name}`;
    principles.set(id, { ...seed, id, createdAt: Date.now() });
  }
}

// ─── Core Transfer Logic ──────────────────────────────────────────────────────

/**
 * Register a new abstract principle from a domain-specific pattern.
 * Called by LongTermMemoryConsolidation when it extracts a new pattern.
 */
export function registerPrinciple(
  name: string,
  description: string,
  sourceDomain: KnowledgeDomain,
  sourcePattern: string,
  abstractForm: string,
  applicableDomains: KnowledgeDomain[],
  confidence: number,
): AbstractPrinciple {
  const id = `principle-${name}-${Date.now()}`;
  const principle: AbstractPrinciple = {
    id, name, description, sourceDomain, sourcePattern,
    abstractForm, applicableDomains, confidence,
    transferCount: 0, createdAt: Date.now(),
  };
  principles.set(id, principle);
  log.info(`[ZeroShotTransfer] Registered principle: ${name} (from ${sourceDomain}, applicable to ${applicableDomains.join(", ")})`);
  return principle;
}

/**
 * Transfer a principle from its source domain to a target domain.
 * Uses LLM to instantiate the abstract principle for the target domain.
 */
export async function transferPrinciple(
  principleId: string,
  targetDomain: KnowledgeDomain,
): Promise<TransferResult | null> {
  const principle = principles.get(principleId);
  if (!principle) {
    log.warn(`[ZeroShotTransfer] Principle ${principleId} not found`);
    return null;
  }

  if (!principle.applicableDomains.includes(targetDomain)) {
    log.info(`[ZeroShotTransfer] Principle ${principle.name} not applicable to ${targetDomain}`);
    return null;
  }

  if (principle.sourceDomain === targetDomain) {
    log.info(`[ZeroShotTransfer] Principle ${principle.name} already in ${targetDomain}`);
    return null;
  }

  const messages = [
    {
      role: "system" as const,
      content: `You are an expert in cross-domain knowledge transfer. You take abstract principles and instantiate them for specific domains.`,
    },
    {
      role: "user" as const,
      content: `Transfer this abstract principle to the ${targetDomain} domain:

Abstract Principle: "${principle.name}"
Description: ${principle.description}
Abstract Form: ${principle.abstractForm}
Original Source (${principle.sourceDomain}): ${principle.sourcePattern}

Provide a concrete instantiation of this principle for the ${targetDomain} domain.
Return JSON: {
  "transferredPattern": "the principle as it applies to ${targetDomain}",
  "rationale": "why this principle applies here",
  "validationScore": 0-100,
  "example": "a concrete example in ${targetDomain}"
}`,
    },
  ];

  try {
    const result = await backgroundChatCompletion(messages, { temperature: 0.4, maxTokens: 600 });
    if (!result.content) return null;
    const text = result.content.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      transferredPattern?: string;
      rationale?: string;
      validationScore?: number;
    };

    const validationScore = typeof parsed.validationScore === "number" ? parsed.validationScore : 50;
    const accepted = validationScore >= 60;

    const transfer: TransferResult = {
      id: `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      principleId,
      sourceDomain: principle.sourceDomain,
      targetDomain,
      originalPattern: principle.sourcePattern,
      transferredPattern: parsed.transferredPattern ?? "",
      rationale: parsed.rationale ?? "",
      validationScore,
      accepted,
      createdAt: Date.now(),
    };

    transfers.set(transfer.id, transfer);

    if (accepted) {
      principle.transferCount++;
      log.info(`[ZeroShotTransfer] Transferred "${principle.name}" to ${targetDomain} (score: ${validationScore})`);
    }

    return transfer;
  } catch (err) {
    log.warn(`[ZeroShotTransfer] Transfer failed for ${principleId} → ${targetDomain}:`, err);
    return null;
  }
}

/**
 * Run a full transfer sweep: transfer all applicable principles to a target domain.
 */
export async function transferAllToDomain(targetDomain: KnowledgeDomain): Promise<TransferResult[]> {
  const applicable = Array.from(principles.values())
    .filter(p => p.applicableDomains.includes(targetDomain) && p.sourceDomain !== targetDomain);

  log.info(`[ZeroShotTransfer] Transferring ${applicable.length} principles to ${targetDomain}`);

  const results: TransferResult[] = [];
  for (const principle of applicable) {
    const result = await transferPrinciple(principle.id, targetDomain);
    if (result) results.push(result);
  }

  return results;
}

/**
 * Get all principles applicable to a domain.
 */
export function getPrinciplesForDomain(domain: KnowledgeDomain): AbstractPrinciple[] {
  return Array.from(principles.values())
    .filter(p => p.applicableDomains.includes(domain))
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get all transfer results for a domain.
 */
export function getTransfersForDomain(domain: KnowledgeDomain): TransferResult[] {
  return Array.from(transfers.values())
    .filter(t => t.targetDomain === domain)
    .sort((a, b) => b.validationScore - a.validationScore);
}

/**
 * Get transfer statistics.
 */
export function getTransferStats(): TransferStats {
  const allTransfers = Array.from(transfers.values());
  const accepted = allTransfers.filter(t => t.accepted);

  const byDomain: Record<string, number> = {};
  for (const t of accepted) {
    byDomain[t.targetDomain] = (byDomain[t.targetDomain] ?? 0) + 1;
  }

  return {
    totalPrinciples: principles.size,
    totalTransfers: allTransfers.length,
    acceptedTransfers: accepted.length,
    transfersByDomain: byDomain,
    topPrinciples: Array.from(principles.values())
      .sort((a, b) => b.transferCount - a.transferCount)
      .slice(0, 5)
      .map(p => ({ name: p.name, transferCount: p.transferCount, confidence: p.confidence })),
  };
}

/**
 * Initialize the zero-shot transfer engine.
 */
export function initZeroShotTransferEngine(): void {
  seedPrinciples();
  log.info(`[ZeroShotTransfer] Initialized with ${principles.size} seed principles`);
  log.info("[ZeroShotTransfer] Cross-domain knowledge transfer ready");
}
