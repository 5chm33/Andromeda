/**
 * crossDomainAdapter.ts — v1.0.0
 *
 * Phase 3: Cross-domain application of the RSI framework.
 *
 * Extends Andromeda's RSI engine beyond code to other domains:
 *   - Legal: analyze and improve contract templates
 *   - Scientific: optimize experimental protocols
 *   - Logistics: improve supply chain routing algorithms
 *   - Writing: refine long-form content and documentation
 *   - Data: optimize data pipeline configurations
 *
 * Architecture:
 *   - Domain adapters translate domain artifacts into a common "improvement proposal" format
 *   - The same constitutional constraints and voting system apply
 *   - Domain-specific evaluators measure improvement quality
 *   - Results feed back into the long-term memory consolidation system
 */
import { createLogger } from "./logger.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const log = createLogger("crossDomainAdapter");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Types ─────────────────────────────────────────────────────────────────────
export type DomainType =
  | "legal"
  | "scientific"
  | "logistics"
  | "writing"
  | "data_pipeline"
  | "code";  // code is the default domain

export interface DomainArtifact {
  id: string;
  domain: DomainType;
  name: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  lastModifiedAt: number;
  version: number;
}

export interface DomainProposal {
  id: string;
  artifactId: string;
  domain: DomainType;
  title: string;
  description: string;
  currentContent: string;
  proposedContent: string;
  improvementType: string;
  estimatedImpact: "low" | "medium" | "high";
  confidence: number;
  generatedAt: number;
}

export interface DomainEvaluation {
  proposalId: string;
  domain: DomainType;
  score: number;        // 0-100
  dimensions: Record<string, number>;  // domain-specific quality dimensions
  reasoning: string;
  approved: boolean;
}

export interface DomainAdapter {
  domain: DomainType;
  displayName: string;
  description: string;
  evaluationDimensions: string[];
  systemPrompt: string;
  evaluatorPrompt: string;
}

// ─── Domain Adapter Definitions ────────────────────────────────────────────────
const DOMAIN_ADAPTERS: DomainAdapter[] = [
  {
    domain: "legal",
    displayName: "Legal Document Optimizer",
    description: "Improves contract templates, terms of service, and legal agreements for clarity, completeness, and risk mitigation.",
    evaluationDimensions: ["clarity", "completeness", "risk_coverage", "enforceability", "readability"],
    systemPrompt: `You are a legal document improvement specialist. Analyze the provided legal document and propose specific improvements that:
- Increase clarity and reduce ambiguity
- Fill gaps in coverage that could create legal risk
- Improve enforceability of key clauses
- Modernize outdated language
- Add missing standard protections
Respond with JSON: { "title": "...", "description": "...", "proposedContent": "...", "improvementType": "...", "estimatedImpact": "low|medium|high", "confidence": 0.0-1.0 }`,
    evaluatorPrompt: `Evaluate this legal document improvement on a scale of 0-100 for each dimension:
- clarity (0-100): How much clearer is the proposed version?
- completeness (0-100): How much more complete is the coverage?
- risk_coverage (0-100): How much better are risks mitigated?
- enforceability (0-100): How much more enforceable are the clauses?
- readability (0-100): How much more readable is the document?
Respond with JSON: { "score": 0-100, "dimensions": {...}, "reasoning": "...", "approved": boolean }`,
  },
  {
    domain: "scientific",
    displayName: "Scientific Protocol Optimizer",
    description: "Improves experimental protocols for reproducibility, statistical power, and methodological rigor.",
    evaluationDimensions: ["reproducibility", "statistical_power", "controls", "methodology", "clarity"],
    systemPrompt: `You are a scientific methodology expert. Analyze the provided experimental protocol and propose improvements that:
- Increase reproducibility (clearer procedures, better controls)
- Improve statistical power (sample sizes, randomization)
- Strengthen methodology (blinding, controls, confound mitigation)
- Enhance clarity for other researchers to follow
Respond with JSON: { "title": "...", "description": "...", "proposedContent": "...", "improvementType": "...", "estimatedImpact": "low|medium|high", "confidence": 0.0-1.0 }`,
    evaluatorPrompt: `Evaluate this scientific protocol improvement on a scale of 0-100 for each dimension:
- reproducibility (0-100): How much more reproducible is the protocol?
- statistical_power (0-100): How much is statistical power improved?
- controls (0-100): How much better are the controls?
- methodology (0-100): How much more rigorous is the methodology?
- clarity (0-100): How much clearer are the instructions?
Respond with JSON: { "score": 0-100, "dimensions": {...}, "reasoning": "...", "approved": boolean }`,
  },
  {
    domain: "logistics",
    displayName: "Logistics Algorithm Optimizer",
    description: "Improves supply chain routing, scheduling, and resource allocation configurations.",
    evaluationDimensions: ["efficiency", "cost_reduction", "reliability", "scalability", "flexibility"],
    systemPrompt: `You are a logistics optimization expert. Analyze the provided routing or scheduling configuration and propose improvements that:
- Reduce total cost (fuel, time, resources)
- Improve delivery reliability and on-time rates
- Increase throughput and efficiency
- Handle edge cases and disruptions better
Respond with JSON: { "title": "...", "description": "...", "proposedContent": "...", "improvementType": "...", "estimatedImpact": "low|medium|high", "confidence": 0.0-1.0 }`,
    evaluatorPrompt: `Evaluate this logistics optimization on a scale of 0-100 for each dimension:
- efficiency (0-100): How much more efficient is the proposed configuration?
- cost_reduction (0-100): How much cost is saved?
- reliability (0-100): How much more reliable is the system?
- scalability (0-100): How much better does it scale?
- flexibility (0-100): How much better does it handle disruptions?
Respond with JSON: { "score": 0-100, "dimensions": {...}, "reasoning": "...", "approved": boolean }`,
  },
  {
    domain: "writing",
    displayName: "Long-Form Content Optimizer",
    description: "Improves documentation, reports, and long-form content for clarity, structure, and impact.",
    evaluationDimensions: ["clarity", "structure", "completeness", "engagement", "accuracy"],
    systemPrompt: `You are a technical writing expert. Analyze the provided document and propose improvements that:
- Improve clarity and eliminate ambiguity
- Strengthen the logical structure and flow
- Fill gaps in coverage
- Increase reader engagement
- Ensure factual accuracy
Respond with JSON: { "title": "...", "description": "...", "proposedContent": "...", "improvementType": "...", "estimatedImpact": "low|medium|high", "confidence": 0.0-1.0 }`,
    evaluatorPrompt: `Evaluate this writing improvement on a scale of 0-100 for each dimension:
- clarity (0-100): How much clearer is the writing?
- structure (0-100): How much better is the structure?
- completeness (0-100): How much more complete is the coverage?
- engagement (0-100): How much more engaging is the content?
- accuracy (0-100): How much more accurate is the information?
Respond with JSON: { "score": 0-100, "dimensions": {...}, "reasoning": "...", "approved": boolean }`,
  },
  {
    domain: "data_pipeline",
    displayName: "Data Pipeline Optimizer",
    description: "Improves ETL pipelines, data transformation configs, and analytics queries for performance and reliability.",
    evaluationDimensions: ["performance", "reliability", "data_quality", "maintainability", "cost"],
    systemPrompt: `You are a data engineering expert. Analyze the provided data pipeline configuration and propose improvements that:
- Improve query/pipeline performance
- Increase data quality and validation
- Reduce operational costs
- Improve maintainability and observability
Respond with JSON: { "title": "...", "description": "...", "proposedContent": "...", "improvementType": "...", "estimatedImpact": "low|medium|high", "confidence": 0.0-1.0 }`,
    evaluatorPrompt: `Evaluate this data pipeline improvement on a scale of 0-100 for each dimension:
- performance (0-100): How much faster/more efficient is the pipeline?
- reliability (0-100): How much more reliable is it?
- data_quality (0-100): How much better is data quality?
- maintainability (0-100): How much easier to maintain?
- cost (0-100): How much cheaper to operate?
Respond with JSON: { "score": 0-100, "dimensions": {...}, "reasoning": "...", "approved": boolean }`,
  },
];

// ─── State ─────────────────────────────────────────────────────────────────────
const artifacts: Map<string, DomainArtifact> = new Map();
const proposals: Map<string, DomainProposal> = new Map();
const evaluations: Map<string, DomainEvaluation> = new Map();
let totalProposals = 0;
let approvedProposals = 0;

// ─── Core Functions ────────────────────────────────────────────────────────────

/**
 * Register a domain artifact for improvement analysis.
 */
export function registerArtifact(
  domain: DomainType,
  name: string,
  content: string,
  metadata: Record<string, unknown> = {},
): DomainArtifact {
  const id = `artifact-${domain}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const artifact: DomainArtifact = {
    id,
    domain,
    name,
    content,
    metadata,
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
    version: 1,
  };
  artifacts.set(id, artifact);
  log.info(`[CrossDomain] Registered artifact ${id} (${domain}: ${name})`);
  return artifact;
}

/**
 * Generate an improvement proposal for a domain artifact using LLM.
 */
export async function generateDomainProposal(artifactId: string): Promise<DomainProposal | null> {
  const artifact = artifacts.get(artifactId);
  if (!artifact) {
    log.warn(`[CrossDomain] Artifact ${artifactId} not found`);
    return null;
  }

  const adapter = DOMAIN_ADAPTERS.find(a => a.domain === artifact.domain);
  if (!adapter) {
    log.warn(`[CrossDomain] No adapter for domain ${artifact.domain}`);
    return null;
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI();

    const response = await client.chat.completions.create({
      model: process.env.CROSS_DOMAIN_MODEL || "gpt-4.1-mini",
      messages: [
        { role: "system", content: adapter.systemPrompt },
        {
          role: "user",
          content: `Analyze this ${adapter.displayName} artifact and propose an improvement:\n\nName: ${artifact.name}\n\nContent:\n${artifact.content.slice(0, 4000)}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);

    const proposal: DomainProposal = {
      id: `proposal-${artifact.domain}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      artifactId,
      domain: artifact.domain,
      title: typeof parsed.title === "string" ? parsed.title : "Untitled Improvement",
      description: typeof parsed.description === "string" ? parsed.description : "",
      currentContent: artifact.content,
      proposedContent: typeof parsed.proposedContent === "string" ? parsed.proposedContent : artifact.content,
      improvementType: typeof parsed.improvementType === "string" ? parsed.improvementType : "general",
      estimatedImpact: (["low", "medium", "high"].includes(parsed.estimatedImpact)) ? parsed.estimatedImpact : "medium",
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      generatedAt: Date.now(),
    };

    proposals.set(proposal.id, proposal);
    totalProposals++;
    log.info(`[CrossDomain] Generated proposal ${proposal.id} for ${artifact.domain}:${artifact.name}`);
    return proposal;
  } catch (err) {
    log.warn(`[CrossDomain] Failed to generate proposal for ${artifactId}:`, err);
    return null;
  }
}

/**
 * Evaluate a domain proposal using the domain-specific evaluator.
 */
export async function evaluateDomainProposal(proposalId: string): Promise<DomainEvaluation | null> {
  const proposal = proposals.get(proposalId);
  if (!proposal) return null;

  const adapter = DOMAIN_ADAPTERS.find(a => a.domain === proposal.domain);
  if (!adapter) return null;

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI();

    const response = await client.chat.completions.create({
      model: process.env.CROSS_DOMAIN_MODEL || "gpt-4.1-mini",
      messages: [
        { role: "system", content: adapter.evaluatorPrompt },
        {
          role: "user",
          content: `Evaluate this improvement:\n\nTitle: ${proposal.title}\nDescription: ${proposal.description}\n\nCURRENT:\n${proposal.currentContent.slice(0, 2000)}\n\nPROPOSED:\n${proposal.proposedContent.slice(0, 2000)}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);

    const evaluation: DomainEvaluation = {
      proposalId,
      domain: proposal.domain,
      score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, parsed.score)) : 50,
      dimensions: typeof parsed.dimensions === "object" ? parsed.dimensions : {},
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      approved: typeof parsed.approved === "boolean" ? parsed.approved : parsed.score >= 60,
    };

    evaluations.set(proposalId, evaluation);
    if (evaluation.approved) approvedProposals++;
    return evaluation;
  } catch (err) {
    log.warn(`[CrossDomain] Failed to evaluate proposal ${proposalId}:`, err);
    return null;
  }
}

// ─── Stats & Queries ───────────────────────────────────────────────────────────
export function getCrossDomainStats() {
  const byDomain: Record<string, number> = {};
  for (const [, p] of proposals) {
    byDomain[p.domain] = (byDomain[p.domain] || 0) + 1;
  }
  return {
    totalArtifacts: artifacts.size,
    totalProposals,
    approvedProposals,
    approvalRate: totalProposals > 0 ? approvedProposals / totalProposals : 0,
    byDomain,
    supportedDomains: DOMAIN_ADAPTERS.map(a => ({ domain: a.domain, displayName: a.displayName })),
  };
}

export function getArtifact(id: string): DomainArtifact | undefined { return artifacts.get(id); }
export function getProposal(id: string): DomainProposal | undefined { return proposals.get(id); }
export function getEvaluation(id: string): DomainEvaluation | undefined { return evaluations.get(id); }
export function getDomainAdapters(): DomainAdapter[] { return [...DOMAIN_ADAPTERS]; }
export function listArtifacts(domain?: DomainType): DomainArtifact[] {
  return [...artifacts.values()].filter(a => !domain || a.domain === domain);
}

export function initCrossDomainAdapter(): void {
  log.info(`[CrossDomain] Initialized — ${DOMAIN_ADAPTERS.length} domain adapters ready`);
}
