/**
 * Andromeda — self_write_file_chunked and verify_file_integrity Tools
 *
 * self_write_file_chunked: Write large files in multiple chunks to avoid LLM truncation.
 * verify_file_integrity: Verify a file's SHA-256 hash, size, and line count.
 */

import { registerTool } from "./toolRegistry";
import type { ToolResult, ToolExecutionContext } from "./toolRegistry";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { execSync } from "child_process";
import * as path from "path";
import { createHash } from "crypto";
import { isForbidden, resolveServerPath, getProjectRoot } from "./selfModifyHelpers.js";

// ─── Chunk Session Store ─────────────────────────────────────────────────────

interface ChunkSession {
  chunks: string[];
  totalChunks: number;
  filePath: string;
  rationale: string;
  expectedHash: string;
  startedAt: number;
}

/** In-memory store for active chunked write sessions. */
const _chunkSessions = new Map<string, ChunkSession>();

// ─── self_write_file_chunked ─────────────────────────────────────────────────

registerTool({
  name: "self_write_file_chunked",
  description: "Write a large file to the server source in multiple chunks to avoid LLM output truncation. WORKFLOW: 1) action='start' with filePath, totalChunks, expectedHash, rationale — returns chunkSessionId. 2) action='chunk' with chunkSessionId, chunkIndex, chunkContent for each chunk. 3) action='finish' to assemble and write. 4) action='abort' to cancel. WHEN TO USE: Any file larger than ~100 lines. Prefer self_patch_file for targeted edits. CHUNK SIZE: 40-80 lines per chunk is optimal.",
  category: "system" as const,
  safety: "moderate" as const,
  definition: {
    type: "function" as const,
    function: {
      name: "self_write_file_chunked",
      description: "Write a large file in multiple chunks to avoid truncation. Actions: start, chunk, finish, abort, status.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["start", "chunk", "finish", "abort", "status"] },
          filePath: { type: "string", description: "(start only) Relative path from project root." },
          totalChunks: { type: "number", description: "(start only) Total number of chunks." },
          expectedHash: { type: "string", description: "(start only) SHA-256 hex hash of the complete assembled file." },
          rationale: { type: "string", description: "(start only) Why this file is being written." },
          chunkSessionId: { type: "string", description: "(chunk/finish/abort/status) Session ID from 'start'." },
          chunkIndex: { type: "number", description: "(chunk only) Zero-based index of this chunk." },
          chunkContent: { type: "string", description: "(chunk only) Raw text content of this chunk." },
        },
        required: ["action"],
      },
    },
  },
  execute: async (params: Record<string, unknown>, _ctx?: ToolExecutionContext): Promise<ToolResult> => {
    const action = params.action as string;
    const { nanoid } = await import("nanoid");

    if (action === "start") {
      const filePath = params.filePath as string;
      const totalChunks = params.totalChunks as number;
      const expectedHash = (params.expectedHash as string) || "";
      const rationale = (params.rationale as string) || "";

      if (!filePath) return { success: false, output: "filePath is required for action='start'" };
      if (!totalChunks || totalChunks < 1) return { success: false, output: "totalChunks must be >= 1" };

      try { resolveServerPath(filePath); } catch (e) {
        return { success: false, output: `Path error: ${(e as Error).message}` };
      }
      if (isForbidden(filePath)) {
        return { success: false, output: `File '${filePath}' is in the forbidden list and cannot be modified.` };
      }

      const sessionId = nanoid(12);
      _chunkSessions.set(sessionId, {
        chunks: new Array(totalChunks).fill(null),
        totalChunks, filePath, rationale, expectedHash, startedAt: Date.now(),
      });

      // Clean up stale sessions (>2 hours old)
      for (const [id, session] of Array.from(_chunkSessions.entries())) {
        if (Date.now() - session.startedAt > 7_200_000) _chunkSessions.delete(id);
      }

      return {
        success: true,
        output: [
          `✓ Chunked write session started.`,
          `  Session ID: ${sessionId}`,
          `  File: ${filePath} | Total chunks: ${totalChunks}`,
          `  Expected hash: ${expectedHash ? expectedHash.slice(0, 12) + "..." : "(none — integrity check skipped)"}`,
          `NEXT: Send chunks with action='chunk', chunkSessionId='${sessionId}', chunkIndex=0..${totalChunks - 1}`,
        ].join("\n"),
      };
    }

    if (action === "chunk") {
      const sessionId = params.chunkSessionId as string;
      const chunkIndex = params.chunkIndex as number;
      const chunkContent = params.chunkContent as string;

      if (!sessionId || !_chunkSessions.has(sessionId)) {
        return { success: false, output: `Unknown session ID '${sessionId}'. Start a new session with action='start'.` };
      }
      const session = _chunkSessions.get(sessionId)!;
      if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
        return { success: false, output: `chunkIndex ${chunkIndex} out of range [0, ${session.totalChunks - 1}]` };
      }
      if (typeof chunkContent !== "string") {
        return { success: false, output: "chunkContent must be a string" };
      }

      session.chunks[chunkIndex] = chunkContent;
      const received = session.chunks.filter(c => c !== null).length;

      return {
        success: true,
        output: [
          `✓ Chunk ${chunkIndex + 1}/${session.totalChunks} received (${chunkContent.length} chars).`,
          `  Progress: ${received}/${session.totalChunks} chunks received.`,
          received === session.totalChunks
            ? `  All chunks received! Call action='finish' to assemble and write.`
            : `  Next: Send chunk ${chunkIndex + 1} (chunkIndex=${chunkIndex + 1}).`,
        ].join("\n"),
      };
    }

    if (action === "finish") {
      const sessionId = params.chunkSessionId as string;
      if (!sessionId || !_chunkSessions.has(sessionId)) {
        return { success: false, output: `Unknown session ID '${sessionId}'.` };
      }
      const session = _chunkSessions.get(sessionId)!;

      const missing = session.chunks.map((c, i) => c === null ? i : -1).filter(i => i >= 0);
      if (missing.length > 0) {
        return { success: false, output: `Missing chunks: [${missing.join(", ")}]. Send them before calling finish.` };
      }

      const fullContent = session.chunks.join("");
      const actualHash = createHash("sha256").update(fullContent, "utf8").digest("hex");

      if (session.expectedHash && session.expectedHash.length === 64) {
        if (actualHash !== session.expectedHash) {
          _chunkSessions.delete(sessionId);
          return {
            success: false,
            output: [
              `✗ Integrity check FAILED. Content does not match expected hash.`,
              `  Expected: ${session.expectedHash}`,
              `  Actual:   ${actualHash}`,
              `  Session aborted. Start a new session with action='start'.`,
            ].join("\n"),
          };
        }
      }

      const resolved = resolveServerPath(session.filePath);
      if (existsSync(resolved)) copyFileSync(resolved, resolved + ".bak");

      const dir = path.dirname(resolved);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const normalized = fullContent.replace(/\r\n/g, "\n");
      writeFileSync(resolved, normalized, "utf8");

      const writtenContent = readFileSync(resolved, "utf8");
      const writtenHash = createHash("sha256").update(writtenContent, "utf8").digest("hex");
      const expectedFinal = createHash("sha256").update(normalized, "utf8").digest("hex");
      if (writtenHash !== expectedFinal) {
        if (existsSync(resolved + ".bak")) copyFileSync(resolved + ".bak", resolved);
        _chunkSessions.delete(sessionId);
        return { success: false, output: `✗ Post-write integrity check failed. Backup restored. Try again.` };
      }

      _chunkSessions.delete(sessionId);

      try {
        const { storeMemory } = await import("../memory.js");
        await storeMemory(
          `Self-write-chunked SUCCESS: ${session.filePath} — ${session.rationale}. ${session.totalChunks} chunks, ${fullContent.length} chars. Hash: ${actualHash.slice(0, 12)}.`,
          "project",
          ["self-modification", "chunked-write", "success", path.basename(session.filePath)]
        );
      } catch { /* non-fatal */ }

      return {
        success: true,
        output: [
          `✓ File written successfully via chunked write!`,
          `  Path: ${session.filePath}`,
          `  Size: ${fullContent.length} chars (${session.totalChunks} chunks assembled)`,
          `  SHA-256: ${actualHash.slice(0, 12)}... ✓ verified`,
          `  Backup: ${path.basename(resolved)}.bak`,
          `NEXT STEP: Run self_run_tests to verify the change compiles.`,
        ].join("\n"),
      };
    }

    if (action === "abort") {
      const sessionId = params.chunkSessionId as string;
      if (_chunkSessions.has(sessionId)) {
        _chunkSessions.delete(sessionId);
        return { success: true, output: `Session ${sessionId} aborted and cleared.` };
      }
      return { success: false, output: `Unknown session ID '${sessionId}'.` };
    }

    if (action === "status") {
      const sessionId = params.chunkSessionId as string;
      if (!sessionId || !_chunkSessions.has(sessionId)) {
        const sessions = Array.from(_chunkSessions.entries()).map(([id, s]) => ({
          id, filePath: s.filePath,
          received: s.chunks.filter(c => c !== null).length,
          total: s.totalChunks,
          ageMinutes: Math.round((Date.now() - s.startedAt) / 60000),
        }));
        return {
          success: true,
          output: sessions.length > 0
            ? `Active sessions:\n${sessions.map(s => `  ${s.id}: ${s.filePath} (${s.received}/${s.total} chunks, ${s.ageMinutes}m old)`).join("\n")}`
            : "No active chunk sessions.",
        };
      }
      const session = _chunkSessions.get(sessionId)!;
      const received = session.chunks.filter(c => c !== null).length;
      const missing = session.chunks.map((c, i) => c === null ? i : -1).filter(i => i >= 0);
      return {
        success: true,
        output: [
          `Session: ${sessionId}`,
          `  File: ${session.filePath}`,
          `  Progress: ${received}/${session.totalChunks} chunks`,
          missing.length > 0 ? `  Missing: [${missing.join(", ")}]` : `  All chunks received — ready to finish`,
          `  Age: ${Math.round((Date.now() - session.startedAt) / 60000)} minutes`,
        ].join("\n"),
      };
    }

    return { success: false, output: `Unknown action '${action}'. Use: start, chunk, finish, abort, status.` };
  },
});

// ─── verify_file_integrity ───────────────────────────────────────────────────

registerTool({
  name: "verify_file_integrity",
  description: "Verify the integrity of a file by comparing its SHA-256 hash against an expected value. Also reports file size, line count, and whether it compiles (for .ts files). Use after any self_write_file or self_write_file_chunked to confirm the write was complete and uncorrupted.",
  category: "system" as const,
  safety: "safe" as const,
  definition: {
    type: "function" as const,
    function: {
      name: "verify_file_integrity",
      description: "Verify a file's SHA-256 hash, size, line count, and optionally TypeScript compilation.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Relative path from project root, e.g. 'server/ai.ts'." },
          expectedHash: { type: "string", description: "(Optional) Expected SHA-256 hex hash to verify against." },
          checkCompile: { type: "boolean", description: "(Optional) If true, run a quick TypeScript syntax check. Default: false." },
        },
        required: ["filePath"],
      },
    },
  },
  execute: async (params: Record<string, unknown>, _ctx?: ToolExecutionContext): Promise<ToolResult> => {
    const filePath = params.filePath as string;
    const expectedHash = params.expectedHash as string | undefined;
    const checkCompile = params.checkCompile as boolean | undefined;

    let resolved: string;
    try {
      resolved = resolveServerPath(filePath);
    } catch (e) {
      return { success: false, output: `Path error: ${(e as Error).message}` };
    }

    if (!existsSync(resolved)) {
      return { success: false, output: `File not found: ${filePath}` };
    }

    const content = readFileSync(resolved, "utf8");
    const actualHash = createHash("sha256").update(content, "utf8").digest("hex");
    const lines = content.split("\n").length;
    const sizeKB = (Buffer.byteLength(content, "utf8") / 1024).toFixed(1);

    const results: string[] = [
      `File: ${filePath}`,
      `  Size: ${sizeKB} KB | Lines: ${lines}`,
      `  SHA-256: ${actualHash}`,
    ];

    if (expectedHash) {
      if (actualHash === expectedHash) {
        results.push(`  Integrity: ✓ MATCH — file content is exactly as expected`);
      } else {
        results.push(`  Integrity: ✗ MISMATCH`);
        results.push(`  Expected: ${expectedHash}`);
        results.push(`  Actual:   ${actualHash}`);
        results.push(`  WARNING: The file may be truncated or corrupted!`);
        if (existsSync(resolved + ".bak")) {
          results.push(`  Backup available: ${path.basename(resolved)}.bak — restore with self_patch_file if needed.`);
        }
      }
    }

    if (checkCompile && filePath.endsWith(".ts")) {
      try {
        const projectRoot = getProjectRoot();
        execSync(`npx tsc --noEmit --allowImportingTsExtensions 2>&1`, {
          cwd: projectRoot, timeout: 30_000, stdio: "pipe",
        });
        results.push(`  TypeScript: ✓ No syntax errors`);
      } catch (e) {
        const errMsg = (e as { stderr?: Buffer; stdout?: Buffer }).stderr?.toString().slice(0, 500) ||
                       (e as { stdout?: Buffer }).stdout?.toString().slice(0, 500) || "Unknown error";
        results.push(`  TypeScript: ✗ Compile errors detected:`);
        results.push(`    ${errMsg.split("\n").slice(0, 5).join("\n    ")}`);
      }
    }

    return { success: true, output: results.join("\n") };
  },
});
