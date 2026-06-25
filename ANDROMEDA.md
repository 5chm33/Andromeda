# Andromeda Project Memory — v11.292.0

This file is read by the RSI engine at the start of every cycle to guide proposal priorities.
Last updated: 2026-06-24

---

## Current RSI Goals (Priority Order)

### Priority 1 — Security & Correctness (reward: 1.0)
- Replace any remaining string comparison of secrets with `crypto.timingSafeEqual()`
- Replace any `Math.random()` used for security tokens with `crypto.randomBytes()`
- Add input validation to any API route that accepts user-controlled data without validation

### Priority 2 — Performance (reward: 0.9)
- Replace `.find()` in hot paths (called >100x/sec) with `Map.get()` lookups
- Replace repeated `JSON.parse(JSON.stringify(x))` deep-clone patterns with `structuredClone(x)`
- Add `.unref()` to any new `setInterval` or `setTimeout` calls to prevent vitest worker hangs

### Priority 3 — Error Handling (reward: 0.8)
- Replace silent `} catch { }` blocks with `log.warn(...)` using the file's existing logger
- Replace `} catch (e) { console.error(e) }` with structured `log.error(...)` calls

### Priority 4 — Code Quality (reward: 0.7)
- Extract magic numbers (timeouts, limits, thresholds) into named constants at the top of the file
- Replace `any` types with proper interfaces where the shape is known
- Add JSDoc to exported functions that have none

### Do NOT Do (penalized)
- Do NOT remove existing JSDoc comments (reward: 0.3 — penalized)
- Do NOT add duplicate JSDoc blocks (reward: 0.3 — penalized)
- Do NOT make changes that require a full rebuild to validate (reward: 0.4)
- Do NOT propose changes to test files unless the test itself has a bug

---

## Cost Guidance

- Use `eco` tier (flash) for all standard module proposals
- Only use `pro` tier for changes to: rsiEngine.ts, selfImprove.ts, selfImproveGuard.ts, shadowInstance.ts, rsiScheduler.ts, ciPipeline.ts, selfConsistency.ts, selfRollback.ts, initModules.ts, initRoutes.ts, llmProvider.ts, adminAuth.ts
- Self-consistency check is expensive — skip it for low-risk proposals (refactoring, constants, JSDoc)

---

## Architecture Notes

- The guard runs tests BEFORE applying to the live file (shadow test = in-place write, test, restore)
- The CI pipeline runs AFTER apply but with skipTests=true, skipTypecheck=true, skipBuild=true, skipReload=true
- Auto-push fires after every successful commit — no manual push needed
- RLHF feedback is in data/rlhf_feedback.jsonl — read it to understand what improvements scored well

## Recent Changes

- **[vv11.17.0]** Jun 25, 2026, 05:23 AM — Self-improvement applied: C improvement (`c.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 05:23 AM — Self-improvement applied: B (`b.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 05:23 AM — Self-improvement applied: A (`a.ts`) [auto]

- **[vTest update]** Jun 25, 2026, 05:23 AM — server/selfDocumentation.ts [auto]

- **[vA test system event occurred]** Jun 25, 2026, 05:23 AM — test_event [auto]

- **[vv11.17.0]** Jun 25, 2026, 05:23 AM — Self-improvement applied: Test improvement (`server/selfDocumentation.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 04:47 AM — Self-improvement applied: C improvement (`c.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 04:47 AM — Self-improvement applied: B (`b.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 04:47 AM — Self-improvement applied: A (`a.ts`) [auto]

- **[vTest update]** Jun 25, 2026, 04:47 AM — server/selfDocumentation.ts [auto]

- **[vA test system event occurred]** Jun 25, 2026, 04:47 AM — test_event [auto]

- **[vv11.17.0]** Jun 25, 2026, 04:47 AM — Self-improvement applied: Test improvement (`server/selfDocumentation.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 04:15 AM — Self-improvement applied: C improvement (`c.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 04:15 AM — Self-improvement applied: B (`b.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 04:15 AM — Self-improvement applied: A (`a.ts`) [auto]

- **[vTest update]** Jun 25, 2026, 04:15 AM — server/selfDocumentation.ts [auto]

- **[vA test system event occurred]** Jun 25, 2026, 04:15 AM — test_event [auto]

- **[vv11.17.0]** Jun 25, 2026, 04:15 AM — Self-improvement applied: Test improvement (`server/selfDocumentation.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 03:22 AM — Self-improvement applied: C improvement (`c.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 03:22 AM — Self-improvement applied: B (`b.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 03:22 AM — Self-improvement applied: A (`a.ts`) [auto]

- **[vTest update]** Jun 25, 2026, 03:22 AM — server/selfDocumentation.ts [auto]

- **[vA test system event occurred]** Jun 25, 2026, 03:22 AM — test_event [auto]

- **[vv11.17.0]** Jun 25, 2026, 03:22 AM — Self-improvement applied: Test improvement (`server/selfDocumentation.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 02:58 AM — Self-improvement applied: C improvement (`c.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 02:58 AM — Self-improvement applied: B (`b.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 02:58 AM — Self-improvement applied: A (`a.ts`) [auto]

- **[vTest update]** Jun 25, 2026, 02:58 AM — server/selfDocumentation.ts [auto]

- **[vA test system event occurred]** Jun 25, 2026, 02:58 AM — test_event [auto]

- **[vv11.17.0]** Jun 25, 2026, 02:58 AM — Self-improvement applied: Test improvement (`server/selfDocumentation.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 02:32 AM — Self-improvement applied: C improvement (`c.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 02:32 AM — Self-improvement applied: B (`b.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 02:32 AM — Self-improvement applied: A (`a.ts`) [auto]

- **[vTest update]** Jun 25, 2026, 02:32 AM — server/selfDocumentation.ts [auto]

- **[vA test system event occurred]** Jun 25, 2026, 02:32 AM — test_event [auto]

- **[vv11.17.0]** Jun 25, 2026, 02:32 AM — Self-improvement applied: Test improvement (`server/selfDocumentation.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 01:56 AM — Self-improvement applied: C improvement (`c.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 01:56 AM — Self-improvement applied: B (`b.ts`) [auto]

- **[vv11.17.0]** Jun 25, 2026, 01:56 AM — Self-improvement applied: A (`a.ts`) [auto]

- **[vTest update]** Jun 25, 2026, 01:56 AM — server/selfDocumentation.ts [auto]

- **[vA test system event occurred]** Jun 25, 2026, 01:56 AM — test_event [auto]

- **[vv11.17.0]** Jun 25, 2026, 01:56 AM — Self-improvement applied: Test improvement (`server/selfDocumentation.ts`) [auto]
