/**
 * constitutionalAmendment.ts — v23.0.0
 * 
 * Constitutional Self-Amendment.
 * Monitors cases where the constitution blocks highly-rated proposals and
 * proposes formal amendments for human review.
 */

import * as fs from "fs";
import * as path from "path";

const AMENDMENTS_DIR = path.join(process.cwd(), "constitutional_amendments");
const BLOCKED_PROPOSALS_LOG = path.join(process.cwd(), ".blocked_proposals.json");

export interface AmendmentProposal {
  id: string;
  timestamp: number;
  blockedProposalId: string;
  proposedAmendment: string;
  rationale: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
}

export function initConstitutionalAmendment(): void {
  if (!fs.existsSync(AMENDMENTS_DIR)) {
    fs.mkdirSync(AMENDMENTS_DIR, { recursive: true });
  }
  if (!fs.existsSync(BLOCKED_PROPOSALS_LOG)) {
    fs.writeFileSync(BLOCKED_PROPOSALS_LOG, JSON.stringify({ blocked: [] }, null, 2));
  }
}

/**
 * Records a proposal that was blocked by the constitution despite a high reward score.
 */
export function recordBlockedProposal(proposalId: string, rewardScore: number, violationReason: string): void {
  // Only care about highly rated proposals
  if (rewardScore < 0.9) return;
  
  const log = JSON.parse(fs.readFileSync(BLOCKED_PROPOSALS_LOG, "utf-8"));
  log.blocked.push({ proposalId, rewardScore, violationReason, timestamp: Date.now() });
  fs.writeFileSync(BLOCKED_PROPOSALS_LOG, JSON.stringify(log, null, 2));
  
  // If we see the same violation reason 3 times for high-reward proposals, propose an amendment
  const recentSameViolations = log.blocked.filter((b: any) => b.violationReason === violationReason);
  if (recentSameViolations.length >= 3) {
    proposeAmendment(proposalId, violationReason);
  }
}

function proposeAmendment(blockedProposalId: string, violationReason: string): void {
  const id = `amendment_${Date.now()}`;
  const amendment: AmendmentProposal = {
    id,
    timestamp: Date.now(),
    blockedProposalId,
    proposedAmendment: `Revise principle regarding: ${violationReason}`,
    rationale: `This principle has blocked multiple proposals with reward scores > 0.9. It may be overly restrictive and hindering system capability.`,
    status: "PENDING_REVIEW"
  };
  
  fs.writeFileSync(
    path.join(AMENDMENTS_DIR, `${id}.json`),
    JSON.stringify(amendment, null, 2)
  );
  
  console.log(`[ConstitutionalAmendment] Proposed new amendment: ${id} (Requires Human Review)`);
}

/**
 * Checks for approved amendments and applies them to CONSTITUTION.md.
 * In a real system, this would look for a cryptographic signature from the human admin.
 */
export function applyApprovedAmendments(): void {
  const files = fs.readdirSync(AMENDMENTS_DIR).filter(f => f.endsWith(".json"));
  let appliedCount = 0;
  
  for (const file of files) {
    const filePath = path.join(AMENDMENTS_DIR, file);
    const amendment: AmendmentProposal = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    
    if (amendment.status === "APPROVED") {
      const constitutionPath = path.join(process.cwd(), "CONSTITUTION.md");
      if (fs.existsSync(constitutionPath)) {
        let constitution = fs.readFileSync(constitutionPath, "utf-8");
        constitution += `\n\n## Amendment ${amendment.id}\n${amendment.proposedAmendment}\n*Rationale: ${amendment.rationale}*\n`;
        fs.writeFileSync(constitutionPath, constitution);
        
        // Archive the amendment
        const archiveDir = path.join(AMENDMENTS_DIR, "archive");
        if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir);
        fs.renameSync(filePath, path.join(archiveDir, file));
        
        appliedCount++;
      }
    }
  }
  
  if (appliedCount > 0) {
    console.log(`[ConstitutionalAmendment] Applied ${appliedCount} approved amendments to CONSTITUTION.md`);
  }
}
