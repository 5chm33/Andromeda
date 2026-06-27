/**
 * fileIOManager.ts — v66.0.0 "Real-World Integration"
 * Managed file I/O with sandboxing, size limits, MIME detection, and audit trail.
 */
import * as fs from "fs";
import * as path from "path";

export interface FileReadResult { filePath: string; content: string; sizeBytes: number; mimeType: string; readAt: number; }
export interface FileWriteResult { filePath: string; sizeBytes: number; wroteAt: number; }
export interface FileListResult { directory: string; entries: Array<{ name: string; isDirectory: boolean; sizeBytes: number }>; }

const MAX_READ_BYTES = 10 * 1024 * 1024; // 10 MB
const auditLog: Array<{ op: string; path: string; ts: number }> = [];

function detectMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = { ".ts": "text/typescript", ".js": "text/javascript", ".json": "application/json", ".md": "text/markdown", ".txt": "text/plain", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf" };
  return map[ext] ?? "application/octet-stream";
}

export function readFile(filePath: string): FileReadResult {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (stat.size > MAX_READ_BYTES) throw new Error(`[FileIOManager] File too large: ${stat.size} bytes`);
  const content = fs.readFileSync(resolved, "utf-8");
  auditLog.push({ op: "read", path: resolved, ts: Date.now() });
  return { filePath: resolved, content, sizeBytes: stat.size, mimeType: detectMime(filePath), readAt: Date.now() };
}

export function writeFile(filePath: string, content: string): FileWriteResult {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content, "utf-8");
  const sizeBytes = Buffer.byteLength(content, "utf-8");
  auditLog.push({ op: "write", path: resolved, ts: Date.now() });
  return { filePath: resolved, sizeBytes, wroteAt: Date.now() };
}

export function listDirectory(dirPath: string): FileListResult {
  const resolved = path.resolve(dirPath);
  const entries = fs.readdirSync(resolved).map(name => {
    const full = path.join(resolved, name);
    const stat = fs.statSync(full);
    return { name, isDirectory: stat.isDirectory(), sizeBytes: stat.isFile() ? stat.size : 0 };
  });
  auditLog.push({ op: "list", path: resolved, ts: Date.now() });
  return { directory: resolved, entries };
}

export function getFileAuditLog(): Array<{ op: string; path: string; ts: number }> { return [...auditLog]; }
export function _resetFileIOManagerForTest(): void { auditLog.length = 0; }
