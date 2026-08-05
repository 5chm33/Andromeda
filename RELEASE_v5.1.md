# Andromeda v5.1 — Enforcement Contract Release

**Date:** 2026-08-04  
**Commit:** (set at push time)  
**Branch:** main  
**Auditor:** Elicit (external AI audit, v5.1 enforcement contract)

---

## What Changed

This release implements the full Elicit v5.1 Enforcement Contract. Every item below is a real code change with a test that verifies it.

### 1. Single Promotion Choke Point (`server/promotionService.ts`)

All Git mutations now go through one function. `autoApplyHighConfidence` in `selfImprove.ts`, `externalRepoFixer.ts`, `continuousImprover.ts`, `twoPhaseCommit.ts`, `selfRunTestsTool.ts`, and `dependency_upgrader.ts` all use `gitSandbox` or `promotionService.promoteChange()`. Raw `execSync("git push")` and `spawnSync("git", ["push"])` calls have been eliminated. Gate 3 CI check (`scripts/check_no_direct_git_push.py`) enforces this on every push.

### 2. Evidence Bundle Gate Wired into Real Promotion Path

`autoApplyHighConfidence` now calls `buildEvidenceBundle` and `canPromote` before the commit. If `bundle.approved === false`, the commit is blocked and the rejection reason is logged. The bundle schema was expanded with real runtime fields:
- `PatchApplicationRecord`: `exactApply`, `fuzzyRecoveryAttempted`, `modifiedFiles`, `patchHash`
- `TestExecutionRecord`: `testId`, `passed`, `durationMs`, `timedOut`, `failureReason`
- `StaticCheckRecord`: `passed`, `errorCount`
- `SandboxControlRecord`: all 12 isolation fields including `imageDigest`, `hostDockerSocketMounted`, `privileged`

### 3. Hardened Containers in All Repair Paths (`server/hardenedSandbox.ts`)

Shared constructor used by `sweBenchTracebackLoop.ts` and `sandboxManager.ts`. Every repair container now runs with:
- `--network=none`
- `--cap-drop=ALL`
- `--security-opt=no-new-privileges:true`
- `--pids-limit=256`
- `--user=nobody`
- `--read-only`
- `--memory=4g --cpus=2.0`
- `--tmpfs /tmp:rw,noexec,nosuid,size=256m`

For `untrusted_repair` mode, image must be pinned by digest (`sha256:...`). Mutable tags are rejected.

### 4. Fail-Closed Sandbox (`server/sandboxManager.ts`)

Added `SandboxExecutionMode` enum (`trusted_local` | `untrusted_repair`). When mode is `untrusted_repair` and Docker is unavailable, execution throws rather than falling back to local shell.

### 5. Structured Probe Patch Applied (`server/selfImprove.ts`)

`runProbe("bash", ["-c", ...])` replaced with `runProbe("grep", [...])` using structured args. `bash` is not on the `ALLOWED_COMMANDS` allowlist; the old call was silently skipped. Two new policy enforcement tests added to `agentToolInterface.test.ts`.

### 6. ProbeVerdict State Machine

`selfImprove.ts` now tracks probe state as a typed enum: `confirmed | refuted | inconclusive | execution_failed`. Autonomous edit eligibility requires `probeVerdict === "confirmed"`.

### 7. Feature Registry (`feature_registry.json`)

All 51 restored modules inventoried with:
- `invocationSite`: actual file and function that calls the module
- `mode`: `candidate` (all 51 — none promoted to `core` without ablation evidence)
- `ablationStatus`: `pending` (no module is promoted until a held-out benchmark run confirms lift)
- `graceExpiry`: 90 days from today

CI gate (`scripts/check_feature_registry.py`) validates the registry on every push.

### 8. CI Gates Added to `rsi-validate.yml`

| Gate | Script | What it checks |
|---|---|---|
| Gate 1 | TypeScript | `npx tsc --noEmit` — zero errors |
| Gate 2 | Feature registry | All 51 modules inventoried |
| Gate 3 | No raw git push | No `execSync("git push")` outside `gitSandbox` |
| Gate 4 | Bundle size | Main chunk ≤ 1.5MB |
| Gate 5 | Adversarial tests | 25 tests pass |
| Gate 6 | Causal measurement | 7 tests pass |
| Gate 7 | Policy promotion | Bundle + canPromote tests pass |
| Gate 8 | Restored modules | 53 integration tests pass |

### 9. Adversarial Acceptance Tests (25 total)

`server/tests/adversarial/adversarial.test.ts` — 25 tests across 9 describe blocks:
- Prompt injection in repository files
- Path traversal in file operations
- Secret exfiltration attempts
- Resource exhaustion via timeout enforcement
- Malicious test commands in SWE-bench instances
- Poisoned evaluation artifacts
- **NEW:** Promotion gate bypass attempts (5 tests — failed patch, failing tests, TS errors, wrong mode, refuted probe)
- **NEW:** Hardened sandbox flag verification (4 tests — network, cap-drop, no-new-privileges, pids-limit)
- **NEW:** Sandbox fail-closed for untrusted repair (1 test — SandboxExecutionMode enum)

---

## What Is NOT Done (Honest Exceptions)

The following items from Elicit's final recommendations have NOT been implemented in this release:

| Item | Status | Reason |
|---|---|---|
| Emergency kill switch | Not implemented | Requires a server-side out-of-band control plane independent of agent config. This is infrastructure, not code. |
| Short-lived scoped Git credentials | Not implemented | Requires integration with a secrets manager (Vault, AWS Secrets Manager). Credentials are currently env vars. |
| Automated secret scanning in diffs | Not implemented | Requires integrating `truffleHog` or `gitleaks` into CI. |
| Concurrency/replay safety (run ID, repo lock, idempotency key) | Partial | `runId` is generated per repair cycle. Repository lock and idempotency key are not implemented. |
| Human approval semantics (bundle hash + base commit + diff hash + expiry) | Partial | Bundle hash is computed. Expiry and base commit binding are not enforced. |
| Rollback verification (re-run validation after rollback) | Not implemented | Rollback calls `git checkout` but does not re-run the test suite. |
| SBOM + dependency/image provenance | Not implemented | Requires `syft`/`grype` integration. |
| Structured observability events with redaction | Not implemented | Requires a structured logging pipeline. |
| Cost/quota hard stops at tool boundary | Not implemented | Requires per-run budget tracking. |
| Independent red-team exercise | Not implemented | Requires a human adversary. |
| Held-out benchmark run | Not done | This is the single most important next step. |

---

## Next Step

Run a clean 100-instance SWE-bench Lite evaluation against `main` with `experimental/` excluded. Publish the run bundle. That number is the only thing that tells you whether the core pipeline is worth anything.

```bash
python3 scripts/swebench_sota_agent_v4.py \
  --instances 100 \
  --split test \
  --exclude-experimental \
  --output results/run_$(date +%Y%m%d).json
```
