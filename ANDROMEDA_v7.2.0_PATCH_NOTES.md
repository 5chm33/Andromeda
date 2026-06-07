# Andromeda v7.2.0 — SOTA UI Overhaul

**Release date:** 2026-06-07
**Build:** clean · 791/791 tests passing
**Scope:** Full 6-phase UI upgrade to match and exceed SOTA agents (Manus, Claude, Kimi, Perplexity)

---

## Phase 2 — Search Results: Perplexity-Style Source Cards

**File:** `client/src/components/search/SourceCard.tsx`

- Redesigned from vertical card to horizontal pill layout (Perplexity pattern)
- Larger favicon (16px) with letter-avatar fallback when favicon fails to load
- Citation number badge (monospace, rounded square)
- Domain pill with credibility color-coded dot (emerald = high, amber = low)
- Hover: violet border glow + box shadow — no layout shift
- Snippet now shown below domain row for context without cluttering the title

---

## Phase 3 — Ambient Intelligence Status Bar

**File:** `client/src/components/AmbientStatusBar.tsx` (new)

A compact pill fixed to the bottom of the Home page showing live Andromeda activity:

- **RSI cycle indicator** — animated violet pulse when running, idle state when not
- **Pending proposals count** — amber highlight when proposals await review
- **Last improvement** — relative time + filename of the most recent auto-applied change
- **Active goals count** — shown when goals are queued
- **Expandable detail panel** — click the pill to expand a floating card with full status breakdown and recent file changes
- Polls `/api/rsi/status` and `/api/self/introspect` every 15 seconds
- Uses `env(safe-area-inset-bottom)` for iPhone notch compatibility

---

## Phase 4 — Animated Aurora Background

**File:** `client/src/index.css` + `client/src/pages/Home.tsx`

Replaced the static radial glow with a 3-layer animated aurora:

- **Primary violet blob** — 18s cycle, `oklch(0.62 0.22 265)`, 48px blur
- **Secondary indigo blob** — 24s cycle, `oklch(0.55 0.20 285)`, 56px blur
- **Tertiary cyan accent** — 30s cycle, `oklch(0.68 0.18 220)`, 64px blur
- All blobs use organic `border-radius` morphing (CSS `border-radius` with `/` syntax)
- Pure CSS — zero JavaScript, zero canvas overhead
- Opacity kept intentionally subtle (6–12%) to avoid distraction

---

## Phase 5 — Mobile-First Responsive Layout

**File:** `client/src/pages/Home.tsx`

- **Sidebar → bottom sheet on mobile** (`max-sm:` breakpoint): slides up from the bottom on screens < 640px, full left-side panel on desktop
- **Mobile drag handle** — pill indicator at the top of the bottom sheet (iOS pattern)
- **Nav bar** — text labels hidden on mobile (`hidden sm:inline`), icon-only buttons on small screens
- **History link** — hidden on mobile (accessible via sidebar)
- Nav padding reduced on mobile (`px-4 sm:px-6`, `py-3 sm:py-4`)

---

## Phase 6 — Proposal Review UI: Side-by-Side Diff + Confidence Meter

**File:** `client/src/components/rsi/ProposalReviewPanel.tsx`

Complete rewrite of the proposal review experience:

- **ConfidenceMeter** — animated progress bar (emerald ≥90%, amber ≥70%, orange ≥50%, red <50%) with percentage label
- **SideBySideDiff** — before/after column layout with color-coded lines (red = removed, green = added)
- **UnifiedDiff** — traditional unified diff with syntax highlighting
- **Diff mode toggle** — switch between side-by-side and unified per proposal
- **FaviconAvatar** — letter avatar fallback for source cards
- **SchedulerBar** — compact scheduler status with Run Now / Pause / Resume controls
- **ProposalCard** — expand/collapse per card, status dot with pulse animation for pending
- Polls every 30 seconds, filter between pending-only and all proposals

---

## Bug Fix — Kimi k2.6 Temperature

**File:** `server/llmProvider.ts`

`kimi-k2.6` is a reasoning model that only accepts `temperature=1`. The config had `0.6`, causing every Kimi call to return `400: invalid temperature`. Fixed by adding a `requiresTemperatureOne: true` flag to the Kimi provider config and clamping temperature to 1 when this flag is set.

---

## Upgrade Path

Replace your existing installation with the contents of this zip. Your `.env.local` is unchanged — no new environment variables are required for any of these features.

The AmbientStatusBar will show "no improvements yet" until Andromeda successfully applies its first proposal. The aurora background and mobile layout are purely visual and require no configuration.
