# Contributing to Andromeda AI

First off, thank you for considering contributing to Andromeda! 

Andromeda is unique because it is a **self-modifying codebase**. The AI itself writes, patches, and refactors its own source code. This means contributing requires a slightly different approach than a traditional project.

## The Golden Rule: Don't Break the Safety Net

The core safety modules are what prevent Andromeda from corrupting itself or executing malicious code. **Never submit PRs that disable or weaken these modules:**
- `server/selfImproveGuard.ts`
- `server/recursionGuard.ts`
- `server/twoPhaseCommit.ts`
- `server/tools/selfModifyTools.ts`
- `andromeda-constitution.json`

## Development Workflow

1. **Fork & Clone**
2. **Setup `.env.local`** (never commit this file)
3. **Run `pnpm install`**
4. **Run `pnpm run dev`** to start the development server.

### Making Changes

You can make changes manually, OR you can ask Andromeda to make the changes for you via the chat interface!

If you make changes manually:
1. Ensure your code passes TypeScript checks: `pnpm run build`
2. Run the test suite: `pnpm test` (if applicable)
3. **Important:** If you add new capabilities, consider updating `server/manifest.ts` so Andromeda is aware of its new skills.

### Submitting a Pull Request

1. Create a feature branch: `git checkout -b feature/my-new-feature`
2. Commit your changes: `git commit -am 'Add some feature'`
3. Push to the branch: `git push origin feature/my-new-feature`
4. Submit a pull request.

Please include a clear description of what the PR does and why it's needed. If it fixes a bug, reference the issue number.

## Code Style

- Use TypeScript. Avoid `any` types wherever possible.
- Use `log.info()`, `log.warn()`, and `log.caught()` from the internal logger rather than `console.log`.
- Document complex logic. Andromeda reads its own code to understand how it works; good JSDoc comments help the AI as much as they help humans.
