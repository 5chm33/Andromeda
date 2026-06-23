/**
 * Chunked Code Writer
 * 
 * Safely writes large files by chunking them, preventing LLM truncation
 * issues when modifying files >800 lines.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export interface WriteSession {
  sessionId: string;
  filePath: string;
  totalChunks: number;
  receivedChunks: number;
  chunks: Map<number, string>;
  status: 'pending' | 'completed' | 'failed';
  error?: string;
  startedAt: number;
  lastUpdatedAt: number;
}

const activeSessions = new Map<string, WriteSession>();

export function beginWriteSession(
  filePath: string,
  totalChunks: number,
  workspaceRoot: string = process.cwd()
): string {
  const sessionId = `write_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const absolutePath = join(workspaceRoot, filePath);

  activeSessions.set(sessionId, {
    sessionId,
    filePath: absolutePath,
    totalChunks,
    receivedChunks: 0,
    chunks: new Map(),
    status: 'pending',
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
  });

  return sessionId;
}

export function writeChunk(
  sessionId: string,
  chunkIndex: number,
  content: string
): WriteSession {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw new Error(`Write session ${sessionId} not found or expired.`);
  }

  if (session.status !== 'pending') {
    throw new Error(`Write session ${sessionId} is already ${session.status}.`);
  }

  if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
    throw new Error(`Invalid chunk index ${chunkIndex}. Expected 0 to ${session.totalChunks - 1}.`);
  }

  if (!session.chunks.has(chunkIndex)) {
    session.receivedChunks++;
  }
  
  session.chunks.set(chunkIndex, content);
  session.lastUpdatedAt = Date.now();

  // If all chunks received, assemble and write to disk
  if (session.receivedChunks === session.totalChunks) {
    try {
      assembleAndWrite(session);
      session.status = 'completed';
    } catch (error: any) {
      session.status = 'failed';
      session.error = error.message;
      throw error;
    }
  }

  return session;
}

export function getSessionStatus(sessionId: string): WriteSession | undefined {
  return activeSessions.get(sessionId);
}

function assembleAndWrite(session: WriteSession): void {
  // Assemble chunks in order
  let fullContent = '';
  for (let i = 0; i < session.totalChunks; i++) {
    const chunk = session.chunks.get(i);
    if (chunk === undefined) {
      throw new Error(`Missing chunk ${i} during assembly.`);
    }
    fullContent += chunk;
  }

  // Ensure directory exists
  const dir = dirname(session.filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Write the assembled file
  writeFileSync(session.filePath, fullContent, 'utf-8');
}

// Cleanup stale sessions (older than 1 hour)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeSessions.entries()) {
    if (now - session.lastUpdatedAt > 60 * 60 * 1000) {
      activeSessions.delete(id);
    }
  }
}, 15 * 60 * 1000);
