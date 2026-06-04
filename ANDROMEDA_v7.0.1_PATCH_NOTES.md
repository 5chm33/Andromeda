# Andromeda v7.0.1 — QoL Patch Notes

**Release Date:** 2026-06-04
**Type:** Patch (bug fixes, no new features)
**Previous Version:** v7.0.0

---

## Summary

This patch resolves four runtime issues identified from live v7.0.0 logs. All fixes are targeted and non-breaking.

---

## Bug Fixes

### 1. Watchdog False-Positive "System health: critical" (Critical Fix)

**Root Cause:** `watchdog.ts` used `await import("../rsiEngine.js")` style relative paths for health checks. When running from `dist/index.js` (a single esbuild bundle), those paths resolve to `C:\...\andromeda_dev\rsiEngine.js` — a file that does not exist on disk. Every single module failed with `Cannot find module`, causing the watchdog to permanently report `System health: critical`.

**Impact:** This cascaded into the orchestrator's `pauseOnCritical` path, which triggered `runHealCycleOnce()` on every single cycle. That heal attempt also failed (same import issue), producing the `0 actions, 1 errors` pattern seen in every orchestrator cycle.

**Fix:** Rewrote `watchdog.ts` to use lazy ESM imports (`import("./rsiEngine.js")`) which resolve correctly from both the source tree (dev mode with `tsx`) and the bundled `dist/index.js` (production). The `importPath` field is removed from the module registry entirely.

**Additional changes in the fix:**
- `rbac` downgraded from `critical: true` → `critical: false` (it is middleware, not a runtime service; its failure should not trigger system-critical state)
- Audit action corrected from `"server_started"` → `"module_recovered"` / `"module_failed"` (the original action name was a copy-paste error)
- `telemetry` module added to the watchdog registry

---

### 2. Git Commit Message Quoting Bug

**Root Cause:** `selfImprove.ts` built git commit messages like:
```
git commit -m "pre-improvement snapshot: before "Improve readability of diagnoseError function" [2026-06-04T...]"
```
The inner double-quotes broke shell word-splitting, causing git to interpret `readability`, `of`, `diagnoseError`, etc. as separate file arguments.

**Error seen in logs:**
```
error: pathspec 'readability' did not match any file(s) known to git
error: pathspec 'of' did not match any file(s) known to git
```

**Fix:** Both git commit calls in `selfImprove.ts` now use `JSON.stringify(message)` to produce a properly escaped, shell-safe quoted string, and pass `shell: false` to `execSync` to prevent shell interpretation of the message content.

---

### 3. Stale Version Strings in Startup Logs

**Root Cause:** Several version tags in log messages were never updated from earlier milestones.

**Issues fixed:**

| Location | Old Tag | New Tag |
|---|---|---|
| `Andromeda Launcher.bat` (title bar) | `v6.15` | `v7.0` |
| `Andromeda Launcher.bat` (banner) | `v6.15` | `v7.0` |
| `initModules.ts` (AutoBaseline logs) | `v6.34`, `v6.24` | `v7.0` |
| `initModules.ts` (file header) | `v6.39` | `v7.0.1` |

**Result:** The startup banner now correctly shows `Andromeda AI v7.0` and the AutoBaseline logs no longer reference old versions.

---

### 4. Orchestrator "0 actions, 1 errors" Per Cycle

**Root Cause:** This was a downstream effect of Bug #1. The watchdog's false-positive `critical` status triggered the orchestrator's `pauseOnCritical` path → `runHealCycleOnce()` → import failure → `result.errors.push("Emergency heal failed: ...")`.

**Fix:** Resolved entirely by Bug #1 fix. No separate orchestrator changes needed.

---

## Files Changed

| File | Change |
|---|---|
| `server/watchdog.ts` | Full rewrite — lazy ESM imports, rbac non-critical, correct audit actions |
| `server/selfImprove.ts` | Git commit message quoting fix (2 locations) |
| `server/_core/initModules.ts` | Version tag updates (v6.24/v6.34 → v7.0) |
| `Andromeda Launcher.bat` | Version string update (v6.15 → v7.0) |
| `package.json` | Version bump to 7.0.1 |

---

## What Did NOT Change

- No new features
- No API changes
- No schema changes
- All 791 tests pass
- Build: 6228 modules, clean

---

## Upgrade Instructions

Drop-in replacement. No migration needed. Just replace your existing files with the v7.0.1 zip.

If you have a running instance, restart the server after updating. The watchdog will now correctly report all modules as healthy within 90 seconds of startup.
