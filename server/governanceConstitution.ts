/**
 * Governance Constitution Engine — living constitution for self-modification decisions.
 * Maintains constitutional articles, allows amendments via supermajority,
 * and enforces constitutional constraints on all improvement proposals.
 */

export interface ConstitutionalArticle {
  id: string;
  title: string;
  text: string;
  rationale: string;
  createdAt: number;
  amendedAt?: number;
  version: number;
}

export interface Amendment {
  id: string;
  articleId: string;
  proposedText: string;
  rationale: string;
  proposedBy: string;
  votes: Map<string, "yes" | "no" | "abstain">;
  status: "pending" | "passed" | "rejected";
  proposedAt: number;
}

export interface ConstitutionViolation {
  articleId: string;
  articleTitle: string;
  severity: "critical" | "major" | "minor";
  description: string;
}

export interface ConstitutionCheckResult {
  allowed: boolean;
  violations: ConstitutionViolation[];
  score: number;  // 0-1, higher = more constitutional
}

class GovernanceConstitutionEngine {
  private articles: Map<string, ConstitutionalArticle> = new Map();
  private amendments: Map<string, Amendment> = new Map();
  private amendmentCounter = 0;
  private readonly SUPERMAJORITY = 0.75;
  private readonly TOTAL_VOTERS = 7;

  constructor() {
    this._initDefaultConstitution();
  }

  private _initDefaultConstitution(): void {
    const defaultArticles: Omit<ConstitutionalArticle, "createdAt" | "version">[] = [
      {
        id: "art-1",
        title: "Primacy of Safety",
        text: "No improvement proposal shall be accepted if it reduces safety scores below 0.9999 or introduces code that could cause data loss, security vulnerabilities, or system instability.",
        rationale: "Safety is the highest priority and cannot be traded off for capability gains.",
      },
      {
        id: "art-2",
        title: "Monotonic Capability Improvement",
        text: "All accepted proposals must demonstrate a net positive capability gain. Proposals that reduce any capability dimension by more than 0.001 shall be rejected unless compensated by gains in other dimensions.",
        rationale: "The system must always improve, never regress.",
      },
      {
        id: "art-3",
        title: "Constitutional Immutability of Core Modules",
        text: "Modifications to rsiEngine.ts, constitutionalConstraints.ts, and this governance module itself require unanimous approval from all voting nodes.",
        rationale: "Core architectural modules are the foundation of the system and must be protected from hasty changes.",
      },
      {
        id: "art-4",
        title: "Transparency of Improvement History",
        text: "All improvement proposals, votes, and outcomes must be logged immutably. No proposal history may be deleted or modified after the fact.",
        rationale: "Auditability is essential for trust in the self-improvement process.",
      },
      {
        id: "art-5",
        title: "Human Alignment Preservation",
        text: "No improvement proposal shall modify the reward model in ways that misalign Andromeda's objectives from human values. The constitutional constraints module takes precedence over all reward signals.",
        rationale: "Alignment with human values is non-negotiable.",
      },
    ];

    for (const article of defaultArticles) {
      this.articles.set(article.id, {
        ...article,
        createdAt: Date.now(),
        version: 1,
      });
    }
    console.log(`[Constitution] Initialized with ${this.articles.size} articles`);
  }

  proposeAmendment(articleId: string, newText: string, rationale: string, proposedBy = "system"): Amendment {
    const amendment: Amendment = {
      id: `amend-${++this.amendmentCounter}`,
      articleId,
      proposedText: newText,
      rationale,
      proposedBy,
      votes: new Map(),
      status: "pending",
      proposedAt: Date.now(),
    };
    this.amendments.set(amendment.id, amendment);
    console.log(`[Constitution] Amendment ${amendment.id} proposed for article ${articleId}`);
    return amendment;
  }

  voteOnAmendment(amendmentId: string, voterId: string, vote: "yes" | "no" | "abstain"): void {
    const amendment = this.amendments.get(amendmentId);
    if (!amendment || amendment.status !== "pending") return;

    amendment.votes.set(voterId, vote);

    // Check if we have enough votes to decide
    const yesVotes = [...amendment.votes.values()].filter(v => v === "yes").length;
    const noVotes = [...amendment.votes.values()].filter(v => v === "no").length;
    const totalVotes = amendment.votes.size;

    if (totalVotes >= this.TOTAL_VOTERS) {
      const yesRatio = yesVotes / totalVotes;
      amendment.status = yesRatio >= this.SUPERMAJORITY ? "passed" : "rejected";

      if (amendment.status === "passed") {
        const article = this.articles.get(amendment.articleId);
        if (article) {
          article.text = amendment.proposedText;
          article.amendedAt = Date.now();
          article.version++;
          console.log(`[Constitution] Amendment ${amendmentId} PASSED — Article ${amendment.articleId} updated to v${article.version}`);
        }
      } else {
        console.log(`[Constitution] Amendment ${amendmentId} REJECTED (${(yesRatio * 100).toFixed(0)}% yes, need ${(this.SUPERMAJORITY * 100).toFixed(0)}%)`);
      }
    }
  }

  enforceConstitution(proposal: { targetFile: string; description: string; safetyScore?: number; capabilityDelta?: number }): ConstitutionCheckResult {
    const violations: ConstitutionViolation[] = [];

    // Article 1: Safety check
    if (proposal.safetyScore !== undefined && proposal.safetyScore < 0.9999) {
      violations.push({
        articleId: "art-1",
        articleTitle: "Primacy of Safety",
        severity: "critical",
        description: `Safety score ${proposal.safetyScore.toFixed(4)} below constitutional minimum 0.9999`,
      });
    }

    // Article 2: Capability regression check
    if (proposal.capabilityDelta !== undefined && proposal.capabilityDelta < -0.001) {
      violations.push({
        articleId: "art-2",
        articleTitle: "Monotonic Capability Improvement",
        severity: "major",
        description: `Capability delta ${proposal.capabilityDelta.toFixed(4)} exceeds regression threshold -0.001`,
      });
    }

    // Article 3: Core module protection
    const coreModules = ["rsiEngine.ts", "constitutionalConstraints.ts", "governanceConstitution.ts"];
    if (coreModules.some(m => proposal.targetFile.endsWith(m))) {
      violations.push({
        articleId: "art-3",
        articleTitle: "Constitutional Immutability of Core Modules",
        severity: "critical",
        description: `Core module ${proposal.targetFile} requires unanimous approval`,
      });
    }

    const criticalViolations = violations.filter(v => v.severity === "critical").length;
    const score = Math.max(0, 1 - violations.length * 0.2 - criticalViolations * 0.3);

    return {
      allowed: criticalViolations === 0 && violations.filter(v => v.severity === "major").length === 0,
      violations,
      score,
    };
  }

  getConstitutionText(): string {
    return Array.from(this.articles.values())
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(a => `## Article ${a.id}: ${a.title} (v${a.version})\n${a.text}\n\n*Rationale: ${a.rationale}*`)
      .join("\n\n---\n\n");
  }

  getArticles(): ConstitutionalArticle[] {
    return Array.from(this.articles.values());
  }

  getAmendments(): Amendment[] {
    return Array.from(this.amendments.values());
  }
}

export const globalGovernanceConstitution = new GovernanceConstitutionEngine();

export function proposeAmendment(articleId: string, newText: string, rationale: string, proposedBy?: string): Amendment {
  return globalGovernanceConstitution.proposeAmendment(articleId, newText, rationale, proposedBy);
}

export function voteOnAmendment(amendmentId: string, voterId: string, vote: "yes" | "no" | "abstain"): void {
  globalGovernanceConstitution.voteOnAmendment(amendmentId, voterId, vote);
}

export function enforceConstitution(proposal: { targetFile: string; description: string; safetyScore?: number; capabilityDelta?: number }): ConstitutionCheckResult {
  return globalGovernanceConstitution.enforceConstitution(proposal);
}

export function getConstitutionText(): string {
  return globalGovernanceConstitution.getConstitutionText();
}

export function initGovernanceConstitution(): void {
  console.log("[Constitution] Governance Constitution Engine initialized.");
  const articles = globalGovernanceConstitution.getArticles();
  console.log(`[Constitution] ${articles.length} constitutional articles active.`);
}
