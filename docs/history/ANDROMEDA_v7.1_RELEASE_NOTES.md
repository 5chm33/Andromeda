# Andromeda v7.1.0 — Full Autonomy Release

**Released:** June 2026  
**Theme:** Zero-Touch Operation — Andromeda now improves, rebuilds, and deploys itself without human intervention.

---

## The Autonomy Gap — Closed

In v7.0, Andromeda could apply improvements to its own TypeScript source files, but those changes only took effect after a **manual rebuild**. This was the last remaining human-in-the-loop step. v7.1 closes that gap entirely.

---

## What Was Built

### 1. Auto-Rebuild (`server/autoRebuild.ts`)

The core of full autonomy. After every successfully applied proposal, Andromeda automatically:
1. Waits for a configurable debounce window (default: 2 minutes) to batch multiple proposals
2. Runs `pnpm run build` in a child process
3. If the build succeeds, signals the process to hot-reload the new bundle
4. If the build fails, rolls back the proposal and records the failure as negative RLHF signal

**Configuration via env vars:**
```
AUTO_REBUILD=true              # Enable (default: true if GITHUB_TOKEN is set)
AUTO_REBUILD_DEBOUNCE_MS=120000  # Batch window (default: 2 min)
AUTO_REBUILD_HOT_RELOAD=true   # Hot-reload after successful build
```

### 2. RLHF Feedback Collector (`server/rlhfCollector.ts`)

Reinforcement Learning from Human Feedback — Andromeda now learns from human approval/rejection signals:
- Collects explicit feedback via `POST /api/v71/rlhf/feedback`
- Collects implicit feedback from PR merges/closes (via prGenerator)
- Collects implicit feedback from auto-rebuild success/failure
- Aggregates reward signals by category and file pattern
- Replays aggregates into meta-learning context so future proposals are biased toward what humans approve

### 3. Automated PR Generator (`server/prGenerator.ts`)

Human oversight bridge for full autonomy:
- When Andromeda applies high-confidence proposals on a feature branch, it automatically creates a GitHub Pull Request
- PR descriptions include: diff summary, rationale, confidence score, eval impact
- PR review decisions (merge = positive RLHF, close = negative RLHF) feed back into the learning loop
- Auto-merge support for proposals that pass CI (requires GitHub branch protection rules)

**Configuration:**
```
GITHUB_TOKEN=ghp_...           # Token with repo scope
GITHUB_REPO=5chm33/Andromeda   # Target repo
PR_MIN_CONFIDENCE=0.9          # Only create PRs for high-confidence proposals
PR_AUTO_MERGE=false            # Set true to enable auto-merge
```

### 4. Knowledge Transfer (`server/knowledgeTransfer.ts`)

Cross-agent learning protocol — multiple Andromeda instances can share what they've learned:
- **Export:** packages improvement patterns, RLHF aggregates, learned constraints, and adaptive benchmarks into a signed JSON package
- **Import:** merges incoming patterns using weighted averaging (more samples = more weight)
- **Sync:** periodic pull from configured peer instances

**Configuration:**
```
KNOWLEDGE_TRANSFER_PEERS=https://peer1.example.com,https://peer2.example.com
KNOWLEDGE_TRANSFER_TOKEN=<shared-secret>
KNOWLEDGE_TRANSFER_INTERVAL_MS=3600000  # Sync every hour
```

---

## New API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v71/status` | Full v7.1 system status |
| `GET` | `/api/v71/rebuild/status` | Auto-rebuild queue and history |
| `POST` | `/api/v71/rebuild/trigger` | Manually trigger a rebuild |
| `POST` | `/api/v71/rebuild/config` | Update auto-rebuild config |
| `GET` | `/api/v71/rlhf/stats` | RLHF feedback stats and aggregates |
| `POST` | `/api/v71/rlhf/feedback` | Submit explicit feedback for a proposal |
| `GET` | `/api/v71/prs/status` | PR generator status and recent PRs |
| `POST` | `/api/v71/prs/sync` | Sync open PR statuses from GitHub |
| `GET` | `/api/v71/knowledge/status` | Knowledge transfer status |
| `GET` | `/api/v71/knowledge/export` | Export current knowledge package |
| `POST` | `/api/v71/knowledge/import` | Import a knowledge package |

---

## The Full Autonomy Loop

```
RSI Engine (6h cycle)
  └── analyzeAndPropose()
        └── autoApplyHighConfidence()
              └── applyProposal()  ← applies TypeScript changes
                    └── scheduleRebuild()  ← NEW in v7.1
                          └── pnpm run build
                                ├── SUCCESS → hot-reload → new code is live
                                │     └── createPRForBranch() → GitHub PR for review
                                │           └── PR merged → positive RLHF signal
                                │           └── PR closed → negative RLHF signal → rollback
                                └── FAILURE → rollback proposal → negative RLHF signal
```

---

## Metrics

| Metric | Value |
|--------|-------|
| Test files | 152 passed |
| Tests | **791 passed (0 failed)** |
| Build modules | 6228 |
| New source files | 5 (`autoRebuild.ts`, `rlhfCollector.ts`, `prGenerator.ts`, `knowledgeTransfer.ts`, `routes/v71Routes.ts`) |
| New API endpoints | 11 |
| TypeScript errors in new files | **0** |

---

## Roadmap Status

| Version | Theme | Status |
|---------|-------|--------|
| v6.36 | Goal discovery, meta-learning, constitutional AI | ✅ Done |
| v6.37 | Postgres, streaming eval, goal decomposition, k8s | ✅ Done |
| v6.38 | RBAC, multi-tenant, audit log | ✅ Done |
| v6.39 | Federated learning (multi-node RSI) | ✅ Done |
| v6.40 | Adaptive eval (LLM-generated benchmarks) | ✅ Done |
| v7.0 | Production-hardened integration + SOTA assessment | ✅ Done |
| v7.0.1 | QoL fixes: watchdog, git quoting, stale versions | ✅ Done |
| **v7.1** | **Full autonomy: auto-rebuild, RLHF, PR gen, knowledge transfer** | ✅ **Done** |
| v7.2+ | Andromeda writes its own v7.2 | 🤖 Autonomous |
