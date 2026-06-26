# Contributing to Andromeda AI

First off, thank you for considering contributing to Andromeda!

Andromeda is unique because it is a **self-modifying codebase**. The AI itself writes, patches, and refactors its own source code via the RSI (Recursive Self-Improvement) engine. This means contributing requires a slightly different approach than a traditional project.

---

## The Golden Rule: Don't Break the Safety Net

The core safety modules are what prevent Andromeda from corrupting itself or executing malicious code. **Never submit PRs that disable or weaken these modules:**

| Module | Purpose |
|---|---|
| `server/selfImproveGuard.ts` | Blocks RSI from modifying protected files |
| `server/recursionGuard.ts` | Prevents infinite self-modification loops |
| `server/twoPhaseCommit.ts` | Ensures atomic apply/rollback of proposals |
| `server/tools/selfModifyTools.ts` | Sandboxed file write tools for RSI |
| `andromeda-constitution.json` | Ethical constraints and capability limits |

### RSI-Protected UI Files

The following UI files are on the RSI blocked list and cannot be modified by the AI engine. Only human contributors should modify them:

- `client/src/pages/RsiDashboard.tsx`
- `client/src/components/rsi/ProposalFileList.tsx`
- `client/src/components/rsi/ProposalTreeGraph.tsx`

---

## Development Workflow

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- A `.env.local` file (copy from `.env.example` and fill in your keys)

### Setup

```bash
git clone https://github.com/5chm33/Andromeda.git
cd Andromeda
pnpm install
cp .env.example .env.local
# Edit .env.local with your API keys
pnpm run dev
```

### Making Changes

You can make changes manually, **or you can ask Andromeda to make the changes for you** via the chat interface — that's the whole point!

If you make changes manually:

1. Ensure TypeScript compiles cleanly: `pnpm run build`
2. Run the full test suite: `pnpm test`
3. If you add new capabilities, update `server/manifest.ts` so Andromeda is aware of its new skills.
4. If you add new environment variables, add them to `.env.example` with documentation.

### Submitting a Pull Request

1. Create a feature branch: `git checkout -b feature/my-new-feature`
2. Commit your changes with a clear message
3. Push to the branch: `git push origin feature/my-new-feature`
4. Open a Pull Request with a clear description of what changed and why

---

## Code Style

- Use TypeScript. Avoid `any` types wherever possible.
- Use `log.info()`, `log.warn()`, and `log.caught()` from the internal logger — never `console.log`.
- Document complex logic with JSDoc comments. Andromeda reads its own code to understand how it works; good comments help the AI as much as they help humans.
- Keep React components under 400 lines. Split into sub-components if they grow larger.
- All new API routes must include input validation via `validateBody()` and appropriate auth middleware.

---

## Testing

```bash
pnpm test                        # Run all 302 test files
pnpm test --reporter=verbose     # Verbose output
```

The CI pipeline runs on every push and PR. All tests must pass before merging. The test suite covers:

- RSI engine (proposal generation, apply, rollback)
- Two-phase commit safety
- LLM provider routing
- RLHF feedback collection
- Memory and vector search
- API routes

---

## Architecture Overview

See [`docs/rsi-architecture.md`](docs/rsi-architecture.md) for a full system diagram.

The key data flow is:

```
Scheduler → rsiEngine → selfImproveGuard → twoPhaseCommit → git commit
                ↓
         rlhfCollector ← User feedback (thumbs up/down in RSI Command Center)
                ↓
         continuousImprover (uses RLHF signals to improve future proposals)
```

---

## Questions?

Open an issue or start a discussion on GitHub. The community is friendly and the AI is watching. 🤖
