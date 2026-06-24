# andromeda-rsi

> The RSI (Recursive Self-Improvement) engine extracted from [Andromeda](https://github.com/5chm33/Andromeda) — a fully autonomous AI agent that commits and pushes its own code improvements to GitHub every 5 minutes.

---

## What Is RSI?

RSI (Recursive Self-Improvement) is the core capability that makes Andromeda genuinely autonomous. The agent:

1. **Analyzes** its own source code across 207 modules
2. **Proposes** improvements using DeepSeek v4-flash or v4-pro
3. **Validates** proposals through a multi-stage guard pipeline
4. **Commits** passing changes to its own codebase
5. **Pushes** to GitHub automatically — no human required

This repository documents the RSI architecture, tracks autonomous commits, and serves as a reference for the self-improvement pipeline design.

---

## Autonomous Commit History

Every commit in [5chm33/Andromeda](https://github.com/5chm33/Andromeda) tagged `Andromeda self-improvement:` was made by the agent itself. Examples from the first live session:

| Commit | File | Improvement | Grade |
|---|---|---|---|
| Real security fix | `security.ts` | `crypto.timingSafeEqual()` for API key comparison | 10/10 |
| Performance | `costOptimizer.ts` | O(n) `.find()` → O(1) `Map.get()` in hot path | 9/10 |
| DRY refactor | `crossDomainAdapter.ts` | Duplicate JSON schema strings → module constants | 8/10 |
| Error handling | `autoGoalSuggester.ts` | Consistent error handler extraction | 7/10 |
| Early return | `behavioralRegressionEngine.ts` | Guard clause when `contracts.length === 0` | 7/10 |

---

## RSI Pipeline Architecture

```
RSI Cycle (every 5 minutes)
│
├── 1. ANALYZE
│   └── Select file from ANALYZABLE_FILES (207 modules)
│   └── Read source + test file
│
├── 2. PROPOSE
│   └── LLM generates improvement (flash for 178 files, pro for 12 core files)
│   └── Proposal includes: rationale, confidence score, risk level
│
├── 3. SHADOW TEST (in-place)
│   └── Write proposed content to disk
│   └── Run vitest on target test file (~440ms)
│   └── Restore original if tests fail
│
├── 4. GUARD
│   ├── TypeScript syntax check (tsc --noEmit on single file)
│   ├── Self-consistency check (skipped for low-risk proposals)
│   └── Sandbox verifier (structural validation)
│
├── 5. APPLY
│   └── Write new content to live source file
│
├── 6. COMMIT + PUSH
│   └── git commit "Andromeda self-improvement: <file> — <summary>"
│   └── git push origin main (auto, no human required)
│
└── 7. RLHF
    └── Record result in data/rlhf_feedback.jsonl
    └── Reward signal steers future proposals
```

---

## Guard Pipeline

The guard is the safety layer that prevents bad changes from reaching the codebase:

| Stage | What It Checks | Blocks On |
|---|---|---|
| Shadow test | Proposed code passes all tests for that file | Any test failure |
| TypeScript check | No type errors in the changed file | Any TS error |
| Self-consistency | 2/3 LLM validators agree the change is safe | Disagreement on high-risk proposals |
| Sandbox verifier | No structural issues (balanced braces, valid exports) | Structural corruption |

Low-risk proposals (refactoring, JSDoc, constant extraction) skip self-consistency to save tokens.

---

## RLHF Feedback Loop

After each cycle, the agent records:
- The proposal that was applied
- The before/after eval scores
- The test results
- A human-assigned grade (when available)

This data is stored in `data/rlhf_feedback.jsonl` and used to steer future proposals toward higher-value improvements.

Current reward signal priorities (from human grading session):
- **Security fixes** → reward 1.0 (highest)
- **Performance improvements** → reward 0.9
- **Structural refactoring** → reward 0.8
- **Guard-clause readability** → reward 0.65
- **Removing documentation** → reward 0.5 (penalized)

---

## Cost Profile

At 5-minute cycles with 207 analyzable files:

| Model | Calls/Hour | Use Case |
|---|---|---|
| deepseek-v4-flash | ~10–14 | 178 standard modules |
| deepseek-v4-pro | ~2–4 | 12 core RSI engine files |

Monthly estimate at continuous operation: ~$15–25 USD depending on proposal complexity.

---

## Key RSI Files

| File | Purpose |
|---|---|
| `server/rsiEngine.ts` | Main RSI cycle orchestrator |
| `server/selfImprove.ts` | Proposal generation + git commit + auto-push |
| `server/selfImproveGuard.ts` | Guard pipeline |
| `server/shadowInstance.ts` | In-place shadow test runner |
| `server/rsiScheduler.ts` | Autonomous 5-minute cycle scheduler |
| `server/selfConsistency.ts` | Multi-provider consensus validation |
| `server/ciPipeline.ts` | Post-apply CI (skipTests/skipTypecheck/skipReload) |
| `data/rlhf_feedback.jsonl` | RLHF reward signal history |

---

## Version History

| Version | Key Changes |
|---|---|
| v11.292.0 | RSI pause/resume toggle wired to real API; vitest worker timeout fixed; structured logging in guard |
| v11.291.1 | 5 setInterval `.unref()` fixes; dead code removal; CI error eliminated |
| v11.291.0 | Auto-push to GitHub on every apply; commit feed upgraded with sync status |
| v11.290.0 | Targeted test runner (440ms vs 15min); 5-minute cycles; skipBuild/skipTypecheck/skipReload |

---

## Parent Repository

[5chm33/Andromeda](https://github.com/5chm33/Andromeda) — Full agent server with RSI, memory, planning, tools, and dashboard.
