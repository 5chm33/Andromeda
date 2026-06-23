/**
 * codeRoutes.ts — Code intelligence, dependencies, workspace, and team agent endpoints
 *                 (extracted from streamRouter.ts v9.12.0)
 *
 * Routes:
 *   POST /api/code/execute-workspace — Execute code with workspace access
 *   POST /api/deps/resolve           — Resolve npm dependencies
 *   GET  /api/deps/package-json      — Read package.json
 *   POST /api/code/explain-error     — Explain a code error
 *   POST /api/workspace/search       — Search workspace code
 *   POST /api/code/diff              — Generate unified diff
 *   POST /api/workspace/file         — Write a workspace file
 *   DELETE /api/workspace/file       — Delete a workspace file
 *   GET  /api/workspace/files        — List workspace files
 *   GET  /api/workspace/file         — Read a workspace file
 *   POST /api/agent/team             — Multi-agent team task
 *   POST /api/agent/team/download    — Download team agent workspace files
 */
import type { Express, Request, Response } from "express";
import { executeCodeWithWorkspace, listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile, deleteWorkspaceFile, getWorkspaceDir } from "../workspace.js";
import { resolveDependencies, readPackageJson, diagnoseError, searchWorkspaceCode, generateUnifiedDiff } from "../codeIntel.js";
import { runTeamAgent } from "../multiAgent.js";

// ── Route registration ─────────────────────────────────────────────────────────

/**
 * Registers code intelligence, dependency resolution, workspace, and team agent routes.
 * @param app Express application instance
 * @param streamLimiter Rate limiter for standard requests
 * @param heavyLimiter Rate limiter for expensive requests
 */
export function registerCodeRoutes(
  app: Express,
  streamLimiter: import("express").RequestHandler,
  heavyLimiter: import("express").RequestHandler,
): void {

  // ── GET /api/workspace/files ───────────────────────────────────────────────
  app.get("/api/workspace/files", streamLimiter, async (_req: Request, res: Response) => {
    try {
      const files = await listWorkspaceFiles();
      res.json({ files, workspaceDir: getWorkspaceDir() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list workspace" });
    }
  });

  // ── GET /api/workspace/file ────────────────────────────────────────────────
  app.get("/api/workspace/file", streamLimiter, async (req: Request, res: Response) => {
    const { name } = req.query as { name: string };
    if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
    try {
      const content = await readWorkspaceFile(name.trim());
      res.json({ name, content });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "Failed to read file" });
    }
  });

  // ── POST /api/code/execute-workspace ──────────────────────────────────────
  app.post("/api/code/execute-workspace", streamLimiter, async (req: Request, res: Response) => {
    const { code, language } = req.body as { code: string; language?: string };
    if (!code?.trim()) { res.status(400).json({ error: "No code provided" }); return; }
    try {
      const result = await executeCodeWithWorkspace(code.trim(), language);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Execution failed" });
    }
  });

  // ── POST /api/deps/resolve ─────────────────────────────────────────────────
  app.post("/api/deps/resolve", streamLimiter, async (req: Request, res: Response) => {
    const { packages, projectRoot } = req.body as { packages?: string[]; projectRoot?: string };
    try {
      let pkgNames = packages;
      if (!pkgNames || pkgNames.length === 0) {
        const pkg = readPackageJson(projectRoot);
        pkgNames = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      }
      const results = await resolveDependencies(pkgNames, projectRoot);
      res.json({ dependencies: results });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Dependency resolution failed" });
    }
  });

  // ── GET /api/deps/package-json ─────────────────────────────────────────────
  app.get("/api/deps/package-json", streamLimiter, async (req: Request, res: Response) => {
    const { root } = req.query as { root?: string };
    try {
      const pkg = readPackageJson(root);
      res.json(pkg);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "Could not read package.json" });
    }
  });

  // ── POST /api/code/explain-error ───────────────────────────────────────────
  app.post("/api/code/explain-error", streamLimiter, async (req: Request, res: Response) => {
    const { error: rawError } = req.body as { error: string };
    if (!rawError?.trim()) { res.status(400).json({ error: "error text is required" }); return; }
    try {
      const diagnosis = diagnoseError(rawError.trim());
      res.json({ diagnosis });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Error analysis failed" });
    }
  });

  // ── POST /api/workspace/search ─────────────────────────────────────────────
  app.post("/api/workspace/search", streamLimiter, async (req: Request, res: Response) => {
    const { pattern, caseSensitive, maxResults } = req.body as {
      pattern: string;
      caseSensitive?: boolean;
      maxResults?: number;
    };
    if (!pattern?.trim()) { res.status(400).json({ error: "pattern is required" }); return; }
    try {
      const results = searchWorkspaceCode(pattern.trim(), { caseSensitive, maxResults });
      res.json({ results, count: results.length });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Code search failed" });
    }
  });

  // ── POST /api/code/diff ────────────────────────────────────────────────────
  app.post("/api/code/diff", streamLimiter, async (req: Request, res: Response) => {
    const { original, modified, fileName } = req.body as { original: string; modified: string; fileName?: string };
    if (original === undefined || modified === undefined) {
      res.status(400).json({ error: "original and modified are required" });
      return;
    }
    try {
      const diff = generateUnifiedDiff(original, modified, fileName);
      res.json({ diff });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Diff generation failed" });
    }
  });

  // ── POST /api/workspace/file ───────────────────────────────────────────────
  app.post("/api/workspace/file", streamLimiter, async (req: Request, res: Response) => {
    const { name, content } = req.body as { name: string; content: string };
    if (!name?.trim() || content === undefined) {
      res.status(400).json({ error: "name and content are required" });
      return;
    }
    try {
      await writeWorkspaceFile(name.trim(), content);
      res.json({ success: true, name: name.trim() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Write failed" });
    }
  });

  // ── DELETE /api/workspace/file ─────────────────────────────────────────────
  app.delete("/api/workspace/file", streamLimiter, async (req: Request, res: Response) => {
    const { name } = req.query as { name: string };
    if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
    try {
      await deleteWorkspaceFile(name.trim());
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Delete failed" });
    }
  });

  // ── POST /api/agent/team ───────────────────────────────────────────────────
  app.post("/api/agent/team", heavyLimiter, async (req: Request, res: Response) => {
    const { task } = req.body as { task: string };
    if (!task?.trim()) { res.status(400).json({ error: "task is required" }); return; }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();
    try {
      await runTeamAgent(task.trim(), res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Team agent failed";
      res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
      res.end();
    }
  });

  // ── POST /api/agent/team/download ──────────────────────────────────────────
  app.post("/api/agent/team/download", async (_req: Request, res: Response) => {
    try {
      const files = await listWorkspaceFiles();
      if (files.length === 0) { res.status(404).json({ error: "No workspace files to download" }); return; }
      const fileContents = await Promise.all(files.map(async (f) => {
        try { return { name: f.name, content: await readWorkspaceFile(f.name) }; }
        catch { return { name: f.name, content: "" }; }
      }));
      res.json({ files: fileContents });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Download failed" });
    }
  });
}
