/**
 * prGenerator.ts — v7.1.0
 *
 * Automated Pull Request generator.
 *
 * When Andromeda applies high-confidence self-improvement proposals on a
 * feature branch, this module automatically creates a GitHub Pull Request
 * so the human operator can review, approve, or reject the changes.
 *
 * This is the "human oversight" bridge for full autonomy:
 *   - Andromeda applies changes autonomously
 *   - PRs give the operator visibility and veto power
 *   - RLHF feedback is collected from PR review decisions
 *
 * Architecture:
 *   1. PRBatcher — groups proposals applied to the same feature branch
 *   2. PRFormatter — generates a rich PR description with diff summary, rationale, eval impact
 *   3. GitHubPRClient — calls the GitHub REST API to create the PR
 *   4. PRRegistry — tracks open/merged/closed PRs and their proposal mappings
 *
 * Requirements:
 *   - GITHUB_TOKEN env var with repo scope
 *   - GITHUB_REPO env var in "owner/repo" format (e.g. "5chm33/Andromeda")
 *   - branchStrategy must be "feature-branch" in autoApply config
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";

const log = createLogger("prGenerator");

// ─── Config ──────────────────────────────────────────────────────────────────

export interface PRGeneratorConfig {
  enabled: boolean;
  githubToken: string;
  githubRepo: string; // "owner/repo"
  baseBranch: string;
  /** Only create PRs for proposals with confidence >= this threshold */
  minConfidence: number;
  /** Add these labels to every auto-generated PR */
  labels: string[];
  /** Auto-merge PRs that pass CI (requires GitHub branch protection rules) */
  autoMerge: boolean;
}

function getConfig(): PRGeneratorConfig {
  return {
    enabled: !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO && process.env.PR_GENERATOR !== "false"),
    githubToken: process.env.GITHUB_TOKEN ?? "",
    githubRepo: process.env.GITHUB_REPO ?? "",
    baseBranch: process.env.PR_BASE_BRANCH ?? "main",
    minConfidence: parseFloat(process.env.PR_MIN_CONFIDENCE ?? "0.9"),
    labels: (process.env.PR_LABELS ?? "andromeda-rsi,automated").split(",").map(s => s.trim()),
    autoMerge: process.env.PR_AUTO_MERGE === "true",
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PRRecord {
  id: string;
  prNumber?: number;
  prUrl?: string;
  branch: string;
  title: string;
  proposalIds: string[];
  targetFiles: string[];
  status: "pending" | "open" | "merged" | "closed" | "failed";
  createdAt: string;
  updatedAt: string;
  error?: string;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

const PR_REGISTRY_FILE = path.join(process.cwd(), "data", "pr_registry.json");
const prRegistry: PRRecord[] = [];

function loadRegistry(): void {
  try {
    if (fs.existsSync(PR_REGISTRY_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PR_REGISTRY_FILE, "utf-8")) as PRRecord[];
      prRegistry.push(...raw.slice(-100));
      log.info(`Loaded ${prRegistry.length} PR records`);
    }
  } catch (err) {
    log.caught("non-fatal", err);
  }
}

function saveRegistry(): void {
  try {
    const dir = path.dirname(PR_REGISTRY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PR_REGISTRY_FILE, JSON.stringify(prRegistry.slice(-100), null, 2), "utf-8");
  } catch (err) {
    log.caught("non-fatal", err);
  }
}

// ─── GitHub API Client ───────────────────────────────────────────────────────

async function githubApiRequest(
  method: string,
  endpoint: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const config = getConfig();
  const url = `https://api.github.com${endpoint}`;

  try {
    const { default: https } = await import("https");
    const { URL } = await import("url");
    const parsed = new URL(url);

    return new Promise((resolve) => {
      const bodyStr = body ? JSON.stringify(body) : undefined;
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          "Authorization": `token ${config.githubToken}`,
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "Andromeda-AI/7.1",
          ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            resolve({ ok: (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, data: JSON.parse(data) });
          } catch {
            resolve({ ok: (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, data });
          }
        });
      });

      req.on("error", (err) => {
        resolve({ ok: false, status: 0, data: { message: err.message } });
      });

      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  } catch (err: any) {
    return { ok: false, status: 0, data: { message: err.message } };
  }
}

// ─── PR Description Formatter ────────────────────────────────────────────────

function formatPRBody(
  proposals: Array<{
    id: string;
    title: string;
    targetFile: string;
    category: string;
    rationale: string;
    confidence: number;
    impact: string;
  }>,
  evalDelta?: number
): string {
  const lines: string[] = [
    "## 🤖 Andromeda Autonomous Self-Improvement",
    "",
    "This PR was automatically generated by Andromeda's RSI engine after applying high-confidence improvement proposals.",
    "",
    "### Summary",
    "",
    `- **Proposals applied:** ${proposals.length}`,
    `- **Files modified:** ${[...new Set(proposals.map(p => p.targetFile))].join(", ")}`,
    `- **Eval impact:** ${evalDelta !== undefined ? `${evalDelta > 0 ? "+" : ""}${evalDelta.toFixed(1)}% score change` : "pending next eval run"}`,
    "",
    "### Proposals",
    "",
  ];

  for (const p of proposals) {
    lines.push(`#### ${p.title}`);
    lines.push(`- **File:** \`${p.targetFile}\``);
    lines.push(`- **Category:** ${p.category}`);
    lines.push(`- **Confidence:** ${(p.confidence * 100).toFixed(0)}%`);
    lines.push(`- **Impact:** ${p.impact}`);
    lines.push(`- **Rationale:** ${p.rationale}`);
    lines.push("");
  }

  lines.push("### Review Instructions");
  lines.push("");
  lines.push("- ✅ **Approve & merge** if the changes look correct");
  lines.push("- ❌ **Close without merging** to reject — Andromeda will record this as negative feedback");
  lines.push("- ✏️ **Request changes** to suggest edits — Andromeda will incorporate your feedback");
  lines.push("");
  lines.push("---");
  lines.push("*Generated by [Andromeda AI](https://github.com/5chm33/Andromeda) v7.1.0*");

  return lines.join("\n");
}

// ─── PR Creation ─────────────────────────────────────────────────────────────

export async function createPRForBranch(
  branch: string,
  proposals: Array<{
    id: string;
    title: string;
    targetFile: string;
    category: string;
    rationale: string;
    confidence: number;
    impact: string;
  }>,
  evalDelta?: number
): Promise<PRRecord> {
  const config = getConfig();

  const record: PRRecord = {
    id: `pr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    branch,
    title: proposals.length === 1
      ? `[Andromeda RSI] ${proposals[0].title}`
      : `[Andromeda RSI] ${proposals.length} self-improvement proposals`,
    proposalIds: proposals.map(p => p.id),
    targetFiles: [...new Set(proposals.map(p => p.targetFile))],
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!config.enabled) {
    log.info(`PR generation disabled — skipping PR for branch ${branch}`);
    record.status = "failed";
    record.error = "PR generation disabled (GITHUB_TOKEN or GITHUB_REPO not set)";
    prRegistry.push(record);
    saveRegistry();
    return record;
  }

  log.info(`Creating PR for branch ${branch} with ${proposals.length} proposals`);

  const body = formatPRBody(proposals, evalDelta);

  const result = await githubApiRequest("POST", `/repos/${config.githubRepo}/pulls`, {
    title: record.title,
    body,
    head: branch,
    base: config.baseBranch,
    draft: false,
  });

  if (result.ok && typeof result.data === "object" && result.data !== null) {
    const pr = result.data as { number: number; html_url: string };
    record.prNumber = pr.number;
    record.prUrl = pr.html_url;
    record.status = "open";
    log.info(`PR #${pr.number} created: ${pr.html_url}`);

    // Add labels
    if (config.labels.length > 0) {
      await githubApiRequest("POST", `/repos/${config.githubRepo}/issues/${pr.number}/labels`, {
        labels: config.labels,
      });
    }

    // Auto-merge if enabled
    if (config.autoMerge) {
      await githubApiRequest("PUT", `/repos/${config.githubRepo}/pulls/${pr.number}/merge`, {
        merge_method: "squash",
        commit_title: record.title,
      });
      record.status = "merged";
      log.info(`PR #${pr.number} auto-merged`);
    }
  } else {
    const errData = result.data as { message?: string };
    record.status = "failed";
    record.error = errData?.message ?? `HTTP ${result.status}`;
    log.warn(`PR creation failed: ${record.error}`);
  }

  record.updatedAt = new Date().toISOString();
  prRegistry.push(record);
  saveRegistry();

  return record;
}

// ─── Sync PR Status ──────────────────────────────────────────────────────────

export async function syncOpenPRStatus(): Promise<void> {
  const config = getConfig();
  if (!config.enabled) return;

  const openPRs = prRegistry.filter(r => r.status === "open" && r.prNumber);
  for (const record of openPRs) {
    const result = await githubApiRequest("GET", `/repos/${config.githubRepo}/pulls/${record.prNumber}`);
    if (result.ok && typeof result.data === "object" && result.data !== null) {
      const pr = result.data as { state: string; merged: boolean };
      if (pr.merged) {
        record.status = "merged";
      } else if (pr.state === "closed") {
        record.status = "closed";
        // Record negative RLHF feedback for closed (rejected) PRs
        try {
          const { recordFeedback } = await import("./rlhfCollector.js");
          for (const proposalId of record.proposalIds) {
            recordFeedback(proposalId, record.targetFiles[0] ?? "", "unknown", record.title, "reject", {
              comment: "PR closed without merging",
              actorId: "prGenerator",
            });
          }
        } catch { /* non-fatal */ }
      }
      record.updatedAt = new Date().toISOString();
    }
  }
  saveRegistry();
}

// ─── Status ──────────────────────────────────────────────────────────────────

export function getPRGeneratorStatus(): {
  config: Omit<PRGeneratorConfig, "githubToken">;
  openPRs: number;
  mergedPRs: number;
  closedPRs: number;
  failedPRs: number;
  recentPRs: PRRecord[];
} {
  const { githubToken: _t, ...safeConfig } = getConfig();
  return {
    config: safeConfig,
    openPRs:   prRegistry.filter(r => r.status === "open").length,
    mergedPRs: prRegistry.filter(r => r.status === "merged").length,
    closedPRs: prRegistry.filter(r => r.status === "closed").length,
    failedPRs: prRegistry.filter(r => r.status === "failed").length,
    recentPRs: prRegistry.slice(-10),
  };
}

// ─── Init ────────────────────────────────────────────────────────────────────

export function initPRGenerator(): void {
  loadRegistry();
  const config = getConfig();
  log.info(`PR generator initialized — enabled: ${config.enabled}, repo: ${config.githubRepo || "(not set)"}`);

  // Sync open PR status every 15 minutes
  if (config.enabled) {
    setInterval(() => {
      syncOpenPRStatus().catch(err => log.caught("non-fatal", err));
    }, 15 * 60 * 1000);
  }
}
