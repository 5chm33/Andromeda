# Andromeda v7.1.8 — SOTA UI Overhaul + Kimi Temperature Fix

## Bug Fixes

### Kimi k2.6 temperature=1 error (400 Bad Request)
- **Root cause:** `kimi-k2.6` is a reasoning model that only accepts `temperature=1`. The provider config had `temperature: 0.6`, causing every Kimi call to return `400: invalid temperature: only 1 is allowed for this model`.
- **Fix:** `server/llmProvider.ts` — changed Kimi provider `temperature` from `0.6` to `1`.
- **Impact:** Eliminates the remaining ~12% of selfImprove cycle errors. Kimi is now fully operational as the Standard-tier model.

## UI Enhancements (Home.tsx)

### 1. History sidebar moved to LEFT
- Sidebar now slides in from the **left** side (Manus/Claude/Kimi pattern).
- Toggle button in the top-left nav bar with a red dot indicator when history is non-empty.
- Backdrop blur overlay when open, click-outside to close.

### 2. Typewriter hero subtitle
- The hero subtitle now cycles through 4 phrases with a typewriter animation:
  - "Intelligence without limits."
  - "Search, research, and analyze."
  - "Powered by AI. Built to improve itself."
  - "Your always-on coding agent."
- Blinking cursor indicator. Phrase cycles every ~2.2 seconds.

### 3. Reduced to 4 primary feature cards
- **Before:** 9 cards always visible (cluttered, non-SOTA).
- **After:** 4 primary cards (Web Search, Agent Mode, Deep Research, Self-Improve) always visible.
- 5 secondary cards (Team Agent, Memory, File Analysis, Bias Detector, Image Gen) hidden behind a "More capabilities" toggle — revealed with a smooth slide-up animation.

### 4. Model selector moved to settings gear dropdown
- The model toggle (Chat / Reasoner) and Deep Research toggle are now in a **settings gear** dropdown in the top-right nav.
- The search bar is now clean — no toggles cluttering the input area.
- Active mode badges (Reasoner, Deep Research) still appear in the hint bar below the search box when enabled.

### 5. ManusDialog → AndromedaDialog
- `ManusDialog.tsx` renamed to `AndromedaDialog` internally.
- "Please login with Manus to continue" → "Sign in to continue using Andromeda".
- "Login with Manus" button → "Sign in to Andromeda".
- Dialog visual theme updated from light (`#f8f8f7`) to dark (`#0f0f0f`) to match the overall dark theme.
- `ManusDialog` export kept as a backward-compat alias — no breaking changes.

### 6. Auto-clear search box after submit
- Search input is cleared immediately after submitting a query (no need to manually erase previous input).
- Textarea height resets to single-line after submit.

### 7. Chat / RSI / History nav links
- Added **Chat**, **RSI Dashboard**, and **History** links to the top nav bar for authenticated users.
- Cleaner navigation without requiring the sidebar.

## Provider Chain Update

With Kimi now working correctly, the Standard-tier fallback chain is:
1. **Kimi k2.6** (primary for complex refactoring) — `temperature: 1`
2. **DeepSeek Reasoner** (fallback if Kimi fails)
3. **DeepSeek Chat** (eco fallback)

## Expected Cycle Stats After v7.1.8

| Metric | v7.1.7 | v7.1.8 (expected) |
|--------|--------|-------------------|
| selfImprove error rate | ~12% | <2% |
| Kimi 400 errors | ~8/hour | 0 |
| ContinuousImprover | paused | active (every 30m) |
| Crash-flag false alarms | occasional | eliminated |

## Files Changed
- `server/llmProvider.ts` — Kimi temperature fix
- `client/src/pages/Home.tsx` — Full SOTA UI rewrite
- `client/src/components/ManusDialog.tsx` — Renamed + rebranded to AndromedaDialog
