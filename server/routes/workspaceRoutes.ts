/**
 * workspaceRoutes.ts — Workspace File Management Routes
 * Andromeda v6.19 — extracted from streamRouter.ts
 *
 * @deprecated v12.0.0 — All routes here are fully covered by codeRoutes.ts
 * (registerCodeRoutes, wired via streamRouter.ts). This file is kept for
 * reference only and is NOT registered anywhere. Do not add new routes here.
 *
 * Routes (reference only — served by codeRoutes.ts):
 *  GET  /api/workspace/files         — list workspace files
 *  GET  /api/workspace/file          — read a workspace file
 *  POST /api/workspace/file          — write a workspace file
 *  DELETE /api/workspace/file        — delete a workspace file
 *  POST /api/workspace/search        — search workspace files
 */

import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import { createLogger } from "../logger.js";

const log = createLogger("workspaceRoutes");

const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");

function ensureWorkspace(): void {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  }
}

function safePath(relativePath: string): string | null {
  const resolved = path.resolve(WORKSPACE_DIR, relativePath);
  // Prevent path traversal
  if (!resolved.startsWith(WORKSPACE_DIR)) return null;
  return resolved;
}

export function registerWorkspaceRoutes(app: Express): void {
  // List workspace files
  app.get("/api/workspace/files", async (_req, res) => {
    ensureWorkspace();
    try {
      const files: { path: string; size: number; modified: string }[] = [];
      function walk(dir: string, prefix: string = ""): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walk(path.join(dir, entry.name), rel);
          } else {
            const stat = fs.statSync(path.join(dir, entry.name));
            files.push({ path: rel, size: stat.size, modified: stat.mtime.toISOString() });
          }
        }
      }
      walk(WORKSPACE_DIR);
      res.json({ files });
    } catch (err) {
      log.error("Failed to list workspace files:", err);
      res.status(500).json({ error: "Failed to list files" });
    }
  });

  // Read a workspace file
  app.get("/api/workspace/file", async (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) { res.status(400).json({ error: "path required" }); return; }
    const safe = safePath(filePath);
    if (!safe) { res.status(403).json({ error: "Path traversal denied" }); return; }
    if (!fs.existsSync(safe)) { res.status(404).json({ error: "File not found" }); return; }
    try {
      const content = fs.readFileSync(safe, "utf8");
      res.json({ path: filePath, content, size: content.length });
    } catch (err) {
      res.status(500).json({ error: "Failed to read file" });
    }
  });

  // Write a workspace file
  app.post("/api/workspace/file", async (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) { res.status(400).json({ error: "path and content required" }); return; }
    const safe = safePath(filePath);
    if (!safe) { res.status(403).json({ error: "Path traversal denied" }); return; }
    try {
      fs.mkdirSync(path.dirname(safe), { recursive: true });
      fs.writeFileSync(safe, content, "utf8");
      res.json({ success: true, path: filePath, size: content.length });
    } catch (err) {
      res.status(500).json({ error: "Failed to write file" });
    }
  });

  // Delete a workspace file
  app.delete("/api/workspace/file", async (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) { res.status(400).json({ error: "path required" }); return; }
    const safe = safePath(filePath);
    if (!safe) { res.status(403).json({ error: "Path traversal denied" }); return; }
    if (!fs.existsSync(safe)) { res.status(404).json({ error: "File not found" }); return; }
    try {
      fs.unlinkSync(safe);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete file" });
    }
  });

  // Search workspace files
  app.post("/api/workspace/search", async (req, res) => {
    const { query, filePattern } = req.body;
    if (!query) { res.status(400).json({ error: "query required" }); return; }
    ensureWorkspace();
    try {
      const results: { path: string; line: number; content: string }[] = [];
      const pattern = filePattern ? new RegExp(filePattern) : null;

      function searchFile(filePath: string, relativePath: string): void {
        if (pattern && !pattern.test(relativePath)) return;
        try {
          const content = fs.readFileSync(filePath, "utf8");
          const lines = content.split("\n");
          lines.forEach((line, idx) => {
            if (line.toLowerCase().includes(query.toLowerCase())) {
              results.push({ path: relativePath, line: idx + 1, content: line.trim() });
            }
          });
        } catch { /* skip binary files */ }
      }

      function walkSearch(dir: string, prefix: string = ""): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walkSearch(path.join(dir, entry.name), rel);
          } else {
            searchFile(path.join(dir, entry.name), rel);
          }
        }
      }

      walkSearch(WORKSPACE_DIR);
      res.json({ results: results.slice(0, 100), total: results.length });
    } catch (err) {
      res.status(500).json({ error: "Search failed" });
    }
  });
}
