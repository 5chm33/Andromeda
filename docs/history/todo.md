# Andromeda AI — Project TODO

## Core Infrastructure
- [x] Global dark theme with CSS variables (OKLCH palette)
- [x] Database schema: search_history, suggestions tables
- [x] DeepSeek AI integration helper (server-side)
- [x] DuckDuckGo search aggregation (free, no key)
- [x] SearXNG public instance aggregation
- [x] tRPC routers: search, history, suggestions, export

## Landing Page
- [x] Hero section with animated Andromeda branding
- [x] Central search bar with autocomplete/suggestions
- [x] Animated background (stars/nebula aesthetic)
- [x] Feature highlights section
- [x] Recent searches display for authenticated users

## Search Results Page
- [x] Streaming AI answer panel with markdown rendering
- [x] Source cards grid with credibility indicators
- [x] Citation inline references in AI answer
- [x] Search filter tabs (All, Web, News, Academic)
- [x] Follow-up question suggestions
- [x] Related searches panel

## Search Features
- [x] Real-time autocomplete suggestions
- [x] Search history tracking (DB + user auth)
- [x] Multi-source result aggregation
- [x] Source credibility scoring
- [x] Result deduplication

## Export & Share
- [x] Copy answer to clipboard
- [x] Share search result via URL
- [x] Export as Markdown

## Auth & User
- [x] Login/logout via Manus OAuth
- [x] User search history page
- [x] Clear history functionality

## Polish & QA
- [x] Responsive mobile layout
- [x] Loading skeletons and streaming states
- [x] Error states and fallback UI
- [x] Keyboard navigation (/ to focus search)
- [x] Vitest coverage for routers

## Upgrade Round 2
- [x] Integrate Brave Search API (real Google-quality results, $5/1000 free tier)
- [x] Optimize DeepSeek streaming speed (higher temp, stream_options, flush tuning)
- [x] Deep Research mode — parallel multi-query search + long-form synthesis
- [x] Deep Research progress UI — live step tracker with sources accumulating
- [x] File upload support — drag-and-drop, XML/JSON/code/text editing
- [x] Image upload support — image file attachment and AI analysis
- [x] File/image context injected into search queries and AI answers
- [x] Vitest tests for new features (30 tests total, all passing)

## Branding Upgrade
- [x] Engineer single-line art bust as central home page logo
- [x] Line-art divider accents woven into home page layout
- [x] Dark theme preserved with inverted line-art rendering (white on dark)
- [x] Engineer icon in nav bar (small, inverted)
- [x] CDN-hosted logo and divider assets

## Local Run Fixes
- [x] Create .env.local with all required env var stubs for local use
- [x] Fix auth to be optional locally (no OAUTH_SERVER_URL crash) — getLoginUrl() returns '#' safely when undefined
- [x] Fix CSS @import ordering issue — moved Google Fonts to index.html <link> tags
- [x] Fix getLoginUrl() crash when VITE_OAUTH_PORTAL_URL is undefined — handled gracefully
- [x] Fix analytics env var placeholders in index.html (no crash, just disabled locally)

## Production Final
- [x] Remove all file upload size limits (server body parser, frontend validation) — no caps for self-hosted use
- [x] Final production-ready Windows launcher ZIP (v3.2)

## ZIP & Folder Upload Fix
- [x] Fix file input accept attribute to include .zip and all file types (accept="*")
- [x] Add ZIP file reading/extraction on the frontend (JSZip) so contents are sent to AI
- [x] Fix drag-and-drop to accept ZIP files and folders
- [x] Update server to handle ZIP content analysis
- [x] Rebuild final Windows launcher ZIP (v3.3)

## v3.6 — Agentic Code Execution & Depth
- [x] Add server-side code execution sandbox (Node.js + Python via child_process, isolated, timeout-protected)
- [x] Add Code Execution tab/panel in Search UI — write code, run it, see output inline
- [x] Deepen AI system prompt — require thorough multi-section responses, not short summaries
- [x] Increase max_tokens and response depth for all AI calls
- [x] Remove News filter tab from Search UI (not needed)
- [x] Add spellCheck={true} to search input fields
- [x] Rebuild final Windows launcher ZIP (v3.6)

## v3.7 — Launcher Fix
- [x] Fix missing patches/wouter@3.7.1.patch error — patches/ folder now included in ZIP
- [x] Rebuild final Windows launcher ZIP (v3.7)

## v3.8 — Critical Fixes
- [x] Fix .env not loading on Windows — dotenv now uses absolute path via fileURLToPath + import.meta.url
- [x] Fix launch.ps1 — .env.local is copied to .env before server starts
- [x] Fix single-line search bar — replaced input with auto-expanding textarea in Search header
- [x] Rebuild final Windows launcher ZIP (v3.8)

## v3.9 — Full Testing & Production ZIP
- [x] Live test: verify textarea is full-size and auto-expanding (Home + Search pages fixed)
- [x] Live test: code execution sandbox runs Python and JavaScript correctly
- [x] Live test: ZIP file analysis — fed Andromeda source code to AI, evaluated response quality (8/10)
- [x] Fix file analysis routing bug — was routing to /api/search/stream instead of /api/analyze/stream
- [x] Fix token limit overflow — added smart priority-based truncation (280K char budget)
- [x] Fix Map.tsx race condition — don’t remove script immediately, add 100ms settle delay + singleton promise
- [x] Fix code execution sandbox — added bash -r restricted mode, code size limit, HOME/TMPDIR isolation
- [x] Fix file analysis history — file analysis results now saved to search history
- [x] Build full production ZIP with node_modules included (~3.6 MB)

## v3.10 — Bug Fixes
- [ ] Fix art click-open-close bug on home page (opens modal then immediately closes)
- [ ] Investigate ZIP size — ensure all source files are included, nothing missing
- [ ] Rebuild final Windows launcher ZIP (v3.10)

## v3.10 — Launcher Fix
- [x] Fix START HERE.bat silently failing and closing — was calling PowerShell with wrong -File argument (launch.vbs not a .ps1)
- [x] Rewrite setup.ps1 — removed ErrorActionPreference=Stop, added Get-Command checks, clear error messages, pause on failure
- [x] Rewrite launch.vbs — fixed quoting and window mode
- [x] Rewrite START HERE.bat — direct PowerShell call, no VBS indirection
- [x] Add .env.local.example to both root and app/ folder
- [x] Update README.txt with clearer setup steps and troubleshooting
- [x] Rebuild final Windows launcher ZIP (v3.10)

## v3.11 — Andromeda-Recommended Improvements
- [x] Fix sessionStorage silent failure — wrap setItem in try/catch with toast error in Home.tsx
- [x] Add file size toast feedback — 100 MB limit check with clear error message before processing
- [x] Fix prompt string concatenation — replaced += loop with parts array + join() in ai.ts
- [x] Add DB connection pool health check — periodic SELECT 1 every 30s in db.ts
- [x] Rebuild final Windows launcher ZIP (v3.11)

## v3.12 — Header Fix & Stream Cancellation
- [x] Fix header search bar overflow — removed max-w-2xl cap, changed to flex-1 min-w-0, overflow-y-auto with 120px max height
- [x] Stream cancellation on navigation — already fully implemented with AbortController (Andromeda incorrectly flagged this as missing)
- [x] Rebuild final Windows launcher ZIP (v3.12)

## v3.13 — Self-Awareness Fix, Model Selector, Code Shortcut, File Editing
- [x] Fix self-awareness hallucination — added real architecture facts to standard system prompt (DeepSeek, Brave Search, 131K context, no memory)
- [x] Add model selector — Zap button in header, toggles deepseek-chat/deepseek-reasoner, persists in localStorage, amber highlight when Reasoner active
- [x] Add Code Executor keyboard shortcut — Ctrl+E or backtick toggles panel, wrench button in header with active state
- [x] Build file editing capability — EditFilePanel component, /api/edit/zip endpoint, JSZip server-side parse+rebuild, real ZIP binary download
- [x] Fix ZIP editing pipeline — rawBase64 stored in AttachedFile, sent to server, JSZip parses real ZIP, AI edits applied, new ZIP rebuilt and downloaded
- [x] Rebuild final Windows launcher ZIP (v3.13)

## v3.14 — Critical Fixes & Andromeda-Recommended Improvements
- [x] Fix ZIP editing — JSZip "Can't find end of central directory": server receives base64 string but JSZip needs raw Uint8Array
- [x] Fix Python on Windows — code executor uses `python3` which doesn't exist on Windows; need `py` launcher fallback in launch.ps1
- [x] Fix streamToResponse — add 90s timeout via AbortController, check res.writableEnded before writes, write queue backpressure
- [x] Rebuild final Windows launcher ZIP (v3.14)

## v3.15 — JSDoc Documentation
- [x] Add JSDoc comments to buildSystemPrompt (mode param, return value, 3 examples)
- [x] Add JSDoc comments to buildDeepResearchPrompt (query/searchResults params, return value, example)
- [x] Rebuild final Windows launcher ZIP (v3.15)

## v4.0 — Major Feature Sprint
- [x] UI Polish: refined typography (Space Grotesk headings), improved source cards, animated answer panel, better spacing
- [x] UI Polish: Chat button on home page navigates to /chat route
- [x] Wire Chat mode: /chat page with full conversation history, /api/chat/stream SSE endpoint
- [x] Image generation: /api/image/generate endpoint using built-in Forge ImageService, ImageGenPanel in Search UI (Ctrl+I)
- [x] Multi-file attachment: support multiple files at once (file input multiple, combined context in analysis)
- [x] Persistent code editor: save snippet + language to localStorage, restore on mount
- [ ] Code editor: syntax highlighting via CodeMirror or similar
- [ ] Search: show token/word count estimate for large file uploads
- [ ] Search: "Stop" button cancels in-flight stream (already works but make it more visible)
- [x] Home: Chat button wired to /chat route
- [x] Rebuild final Windows launcher ZIP (v4.0)

## v4.1 — Console Log Cleanup
- [x] Suppress [Auth] Missing session cookie spam — removed log entirely (normal for unauthenticated users)
- [x] Suppress [OAuth] ERROR: OAUTH_SERVER_URL not configured — replaced with friendly local mode message
- [x] Rebuild final Windows launcher ZIP (v4.1)
