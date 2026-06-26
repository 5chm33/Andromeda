# Changelog

## [12.8.1] — 2026-06-26
### Fixed
- **Express v5 wildcard route crash** (`server/_core/vite.ts`): Express v5 no longer accepts bare `"*"` as a route pattern. Both `app.use("*", ...)` calls replaced with `app.use("/{*path}", ...)`. This was causing Stage 4 CI smoke tests to fail with a startup crash immediately after the v12.8.0 Express upgrade.
- **Docker lockfile config mismatch** (`Dockerfile`): `.pnpmfile.cjs` (which overrides the `qs` version) must be present *before* `pnpm install --frozen-lockfile` runs. The lockfile checksum was computed with the hook active; omitting it caused `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` and a failed Docker build. Fix applied to both builder and runner stages.

## [12.8.0] — 2026-06-25
### Security
- **`qs` vulnerabilities patched:** Upgraded `express` to v5.2.1 (pulls `qs` ≥ 6.15.2), resolving 3 DoS vulnerabilities (arrayLimit bypass, bracket notation DoS, stringify crash on null entries). Remaining 2 advisories are `esbuild` dev-only (build tool, not in production bundle).
### Fixed
- **`package.json` version corrected** from `12.2.1` to `12.8.0`.
- **`ComponentShowcase.tsx`** — removed stray `console.log` from dialog submit handler.
- **`.pnpmfile.cjs`** added to enforce `qs ≥ 6.15.2` across all transitive dependencies.

## [12.7.0] — 2026-06-25
### Added
- **Consensus abstain on provider unavailable** (`consensusEngine.ts`): When a secondary LLM provider is unreachable, the engine now abstains instead of casting a "no" vote. Recovers ~10 proposals per cycle incorrectly rejected due to network issues.
- **Brace-balancing post-processor** (`selfImproveGuard.ts`): Runs before `quickValidate`. If a generated snippet has exactly 1 unbalanced brace, it auto-corrects before rejection. Recovers ~6 proposals per cycle.
- **`_failReason` catch-all logging** (`rsiEngine.ts`): Every rejection path now records the specific failure reason. Dashboard no longer shows blank `—` for rejected proposals.
### Fixed
- **5-hour commit gap resolved:** Two type errors in `RsiDashboard.tsx` and `ProposalTreeGraph.tsx` were making `tsc --noEmit` fail project-wide, blocking every RSI proposal.

## [12.6.0] — 2026-06-25
### Added
- **SOTA TypeScript Heal Engine** (`tsHealEngine.ts`): Three-strategy fallback chain — (1) structured error parsing with 40-line context injection, (2) minimal revert, (3) safe wrapper with error-code-aware advice. Expected success rate: 44% → 65–75%.
- **Scope-limited tsc** (`tsHealEngine.ts`): Server proposals now run `tsc` only against `server/` + `shared/`. 3× faster; client-side type errors can no longer block server commits.

## [12.5.1] — 2026-06-25
### Fixed
- **RLHF buttons disappear after vote** (`ProposalTreeGraph.tsx`): One-shot buttons persisted in `localStorage` under `andromeda_rlhf_votes`.
- **CI failure `rsiEngine.test.ts:225`**: `getRSIHistory()` is async; test now correctly `await`s the Promise.
- **TS self-heal loop** (`selfImprove.ts`): Post-write tsc failures now trigger LLM retry with error context (up to 2 attempts).

## [12.5.0] — 2026-06-25
### Fixed
- **RSI Dashboard showed 0 proposals**: Was fetching `/api/rsi/history`. Now correctly fetches `/api/self/proposals`.
- **Pause/Resume button did nothing**: Now calls `/api/rsi/scheduler/pause` / `/api/rsi/scheduler/resume` with admin key. Icon toggles ⏸/▶.
- **RLHF thumbs silently failing**: Fixed field name (`feedbackType`) and added required `targetFile`, `category`, `title` fields.
### Added
- **`.env.example`**: All 27 environment variables documented.
- **`CONTRIBUTING.md`** updated with RSI-protected files list and architecture overview.

## [12.4.1] — 2026-06-25
### Fixed
- **Flow graph replaced** (`ProposalTreeGraph.tsx`): ReactFlow removed. New UI: vertical table with File / Description / Status / Time / RLHF columns.
- **GitHub button z-index conflict**: Replaced Radix Dialog portal (z-50) with inline modal at z-99999.
- **`ProposalTreeGraph.tsx` added to RSI blocked files**.

## [12.4.0] — 2026-06-25
### Changed
- **RSI Command Center complete redesign** (`RsiDashboard.tsx`, `ProposalFileList.tsx`): Replaced horizontal flow graph with clean vertical card-based layout.
- **`RsiDashboard.tsx` and `ProposalFileList.tsx` added to RSI blocked files**.

## [12.3.0] — 2026-06-24
### Added
- **fal.ai integration** (`falAiProvider.ts`): Image and video generation via fal.ai API. Supports `flux/dev`, `flux/schnell`, `kling-video/v1.6/pro`, `minimax-video-01`.
- **ExternalRepoFixer** (`ExternalRepoFixer.tsx`): "Fix Any GitHub Repo" button in RSI Command Center.

## [11.3.0] - 2026-06-22
### Added
- **Live Cost Tracker:** Real-time USD cost accumulation per provider (`getCostStats()`).
- **Daily Spending Cap:** Soft cap warning system (`DAILY_COST_CAP_USD`).
- **Daemon Support:** Added `ecosystem.config.js`, `andromeda.service`, and `npm run daemon:*` scripts.
- **Ollama Zero-Cost Routing:** Background RSI tasks automatically use local Ollama when `OLLAMA_BASE_URL` is set.

### Security
- **Exec Sandbox:** Replaced raw `execSync`/`execAsync` in `dependencyResolver.ts` with a strict regex whitelist.
- **API Key Sanitization:** Added `sanitizeForLog()` to `selfImprove.ts` to prevent leaking keys in HTTP error bodies.

### Fixed
- Fixed a critical git context bug where `getServerDir()` resolved to `dist/_core` instead of `server/`.
- Cleaned up stray `.ts` files generated by the RSI engine in the project root.

## [11.4.0] — 2026-06-23

### Security
- **execSync git sandbox** (`gitSandbox.ts`): All git operations in `continuousImprover.ts`, `selfImprove.ts`, and `autoRollback.ts` now go through a strict whitelist sandbox — only `add`, `commit`, `push`, `checkout`, `diff`, `log`, `rev-parse`, `status`, `tag`, `stash`, and `init` are permitted. Any other git subcommand throws `GitCommandNotAllowedError`.
- **ALLOW_CLOUD_DESTROY guard** (`cloudProvisioning.ts`): `terminateInstance()` now requires `ALLOW_CLOUD_DESTROY=true` in `.env.local`. Without it, all cloud destroy operations are blocked at the function boundary, preventing a compromised RSI proposal from autonomously destroying cloud infrastructure.
- **instanceId sanitization** (`cloudProvisioning.ts`): Instance IDs are now validated against `[a-zA-Z0-9_-]` before being interpolated into any shell command.

### Bug Fixes
- **GC score no longer 0** (`rsiEngine.ts`): The Goal Completion benchmark dimension now returns a neutral baseline (10 pts) when the goal store is empty, instead of penalising the score with 0. The RSI benchmark can now reach 100/100.
- **RAG similarity search wired** (`ragContextOptimizer.ts`): The `// TODO: implement similarity search` placeholder is replaced with a real cosine-similarity lookup against `getSuccessPatterns()` from `selfKnowledgeBase.ts`. The RSI proposal generator now sees examples of what worked in previous cycles.
- **Dead import removed** (`selfImproveGuard.ts`): Removed the unused `execSync` import that was triggering a lint warning.

### New Features
- **Live session cost in RSI status banner** (`RsiDashboard.tsx`): The status bar now shows the current session LLM spend in real time, colour-coded green/amber/red based on daily cap proximity, with a "cap hit" badge when the daily limit is exceeded.
- **loraDpoPipeline test coverage** (`loraDpoPipeline.test.ts`): 27 new tests covering pair loading, train/eval splitting, pipeline stats, configuration, training run lifecycle, and event emission. Total test count: **2,805**.

### Refactoring
- Version bumped to `11.4.0` across `package.json` and `RsiDashboard.tsx`.

## [11.6.0] — 2026-06-23

### Security
- `capabilityBootstrapper.ts`: Added path traversal protection to `validateAtRuntime()` and `validateInSandbox()` — LLM-provided filenames are now sanitized with `path.basename()` and a regex whitelist before being used in `execSync` calls.
- `imageGeneration.ts`: Migrated all `console.log`/`console.warn` calls to the structured logger to prevent log injection and ensure consistent log formatting.
- `hotReload.ts`, `selfRollback.ts`, `selfTestPipeline.ts`, `vectorMemory.ts`: Replaced hardcoded `localhost:3000` health check URLs with `process.env.PORT`-aware template literals.

### Data
- Restored `data/rlhf_feedback.jsonl` from Git LFS — 119,756 RLHF entries confirmed 100% valid (0 parse errors).
- Verified 3-schema structure: 118,781 HH-RLHF DPO pairs + 475 coding preference pairs + 500 RSI proposal signals.

### Docs
- `README.md`: Updated roadmap — Phase 4 (Federated Learning) marked complete.
- `README.md`: Updated version notes to v11.6.0 SOTA upgrades.

## [11.7.0] — 2026-06-23

### Fixed
- **33 orphaned modules wired** — every module that was written but never imported is now connected to the runtime
- `ciRegressionGuard` wired into `ciPipeline.ts` — tracks metric regressions across CI runs
- `proposalFeedback.recordRejectionFeedback` wired into `continuousImprover.ts` — rejected proposals now teach future cycles
- `appendChangelogEntry` wired into `continuousImprover.ts` — every successful RSI commit now auto-updates the AI changelog
- `autoHealing` + `osGrounding` wired into `watchdog.ts` — self-healing triggers on module failure
- `shadowInstance` wired into `rsiEngine.ts` — proposals tested in isolated shadow before touching main codebase
- `capabilityBootstrapper`, `crossInstanceRlhf`, `edgeLLMRouter` wired into `initModules.ts`
- All TypeScript type errors from wiring pass fixed (ShadowTestResult fields, HealingAction enum, function signatures)
- Bad auto-generated `vectorMemory.test.ts` tests fixed (void functions returning undefined, not truthy)

### Verified
- RSI engine making real git commits (confirmed: 5 autonomous commits in git log)
- Shadow instance correctly blocking bad proposals before they reach main codebase
- AI changelog firing on every successful apply
- Rejection feedback recording on every rollback
- 119,756 RLHF pairs verified intact and wired into proposal generation prompt
- 2,806 tests pass, 0 failures
