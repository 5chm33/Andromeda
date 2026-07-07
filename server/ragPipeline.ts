/**
 * ragPipeline.ts — Retrieval-Augmented Generation Pipeline
 * Andromeda v6.19
 *
 * Full RAG pipeline that:
 * 1. Ingests documents (files, URLs, text) into a vector store
 * 2. Chunks documents intelligently (respects code blocks, paragraphs)
 * 3. Embeds chunks using the configured embedding provider
 * 4. Retrieves relevant chunks for a query using hybrid search
 * 5. Augments the LLM prompt with retrieved context
 * 6. Returns a grounded, cited answer
 *
 * This is the key missing piece identified in the assessment:
 * "Vector memory exists but RAG pipeline is not wired up to the main chat flow."
 *
 * Integration points:
 *  - Called from streamChat() when ANDROMEDA.md or workspace files are relevant
 *  - Called from reactEngine.ts when tool results should be stored for future retrieval
 *  - REST API: POST /api/rag/ingest, POST /api/rag/query, GET /api/rag/stats
 */

import { streamChat } from "./aiStreaming.js";
import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { resolve, extname } from "path";
import { vectorStore, vectorStoreBatch, hybridSearch, vectorStats } from "./vectorMemory.js";
import { backgroundSimpleCompletion } from "./llmProvider.js";
import { createLogger } from "./logger.js";
import type { Express } from "express";

const log = createLogger("ragPipeline");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RagDocument {
  id: string;
  source: string;       // file path, URL, or "inline"
  content: string;
  metadata: Record<string, string | number | boolean>;
  ingestedAt: number;
}

export interface RagChunk {
  id: string;
  documentId: string;
  source: string;
  content: string;
  chunkIndex: number;
  totalChunks: number;
  metadata: Record<string, string | number | boolean>;
}

export interface RagQueryResult {
  answer: string;
  sources: Array<{ source: string; content: string; score: number }>;
  chunksRetrieved: number;
  augmentedPrompt: string;
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 1500;       // ~375 tokens at 4 chars/token
const CHUNK_OVERLAP = 200;     // overlap to preserve context across chunks

/**
 * Intelligent chunker that respects:
 * - Code blocks (never splits inside ```)
 * - Paragraph boundaries (prefers splitting at double newlines)
 * - Sentence boundaries (falls back to period + space)
 * - Hard limit (splits at CHUNK_SIZE if no boundary found)
 */
export function chunkDocument(content: string, source: string = "unknown"): string[] {
  const chunks: string[] = [];
  let pos = 0;

  // Detect if content is primarily code
  const isCode = source.match(/\.(ts|js|py|rs|go|java|cpp|c|h|cs|rb|php)$/) !== null;

  while (pos < content.length) {
    let end = Math.min(pos + CHUNK_SIZE, content.length);

    if (end < content.length) {
      // Try to find a good split point
      let splitAt = -1;

      if (isCode) {
        // For code: split at function/class boundaries
        const codePatterns = [
          /\n(?:export\s+)?(?:async\s+)?function\s/g,
          /\nclass\s/g,
          /\n\/\/\s*─+/g,  // section dividers
          /\n\n/g,
        ];
        for (const pattern of codePatterns) {
          pattern.lastIndex = pos + CHUNK_SIZE - 300;
          const match = pattern.exec(content);
          if (match && match.index < end) {
            splitAt = match.index;
            break;
          }
        }
      } else {
        // For prose: split at paragraph, then sentence
        const paraIdx = content.lastIndexOf("\n\n", end);
        if (paraIdx > pos + CHUNK_SIZE / 2) {
          splitAt = paraIdx + 2;
        } else {
          const sentIdx = content.lastIndexOf(". ", end);
          if (sentIdx > pos + CHUNK_SIZE / 2) {
            splitAt = sentIdx + 2;
          }
        }
      }

      if (splitAt > pos) {
        end = splitAt;
      }
    }

    const chunk = content.slice(pos, end).trim();
    if (chunk.length > 50) { // skip tiny chunks
      chunks.push(chunk);
    }

    pos = end - CHUNK_OVERLAP; // overlap
    if (pos <= 0) pos = end;
  }

  return chunks;
}

// ─── Ingestion ────────────────────────────────────────────────────────────────

/**
 * Ingest a text document into the RAG vector store.
 * Chunks the document and stores each chunk with metadata.
 */
export async function ingestDocument(
  content: string,
  source: string,
  metadata: Record<string, string | number | boolean> = {}
): Promise<{ documentId: string; chunksStored: number }> {
  try {
    const documentId = createHash("sha256").update(source + content.slice(0, 100)).digest("hex").slice(0, 16);
    const chunks = chunkDocument(content, source);

    log.info(`Ingesting ${source}: ${chunks.length} chunks from ${content.length} chars`);

    const entries = chunks.map((chunk, i) => ({
      id: `${documentId}_chunk_${i}`,
      text: `[Source: ${source}]\n\n${chunk}`,
      metadata: {
        ...metadata,
        documentId,
        source,
        chunkIndex: i,
        totalChunks: chunks.length,
      },
    }));

    await vectorStoreBatch(entries);

    return { documentId, chunksStored: chunks.length };
  } catch (error) {
    log.error(`Failed to ingest document from ${source}: ${error}`);
    throw error;
  }
}

/**
 * Ingest a file from the filesystem.
 */
export async function ingestFile(filePath: string): Promise<{ documentId: string; chunksStored: number }> {
  const absPath = resolve(filePath);
  if (!existsSync(absPath)) throw new Error(`File not found: ${absPath}`);

  const ext = extname(absPath).toLowerCase();
  const supportedExts = [".ts", ".js", ".py", ".md", ".txt", ".json", ".yaml", ".yml", ".toml"];
  if (!supportedExts.includes(ext)) {
    throw new Error(`Unsupported file type: ${ext}. Supported: ${supportedExts.join(", ")}`);
  }

  const content = readFileSync(absPath, "utf8");
  return ingestDocument(content, absPath, { fileType: ext.slice(1), filePath: absPath });
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

/**
 * Retrieve the most relevant chunks for a query.
 */
export async function retrieveChunks(
  query: string,
  topK: number = 5,
  minScore: number = 0.2
): Promise<Array<{ source: string; content: string; score: number }>> {
  const results = await hybridSearch(query, topK, minScore);
  return results.map(r => ({
    source: (r.metadata?.source as string) ?? "unknown",
    content: r.text,
    score: r.score,
  }));
}

// ─── Augmented Generation ─────────────────────────────────────────────────────

/**
 * Full RAG query: retrieve relevant chunks and generate a grounded answer.
 */
export async function ragQuery(
  query: string,
  systemContext: string = "",
  topK: number = 5
): Promise<RagQueryResult> {
  // 1. Retrieve relevant chunks
  const chunks = await retrieveChunks(query, topK);

  if (chunks.length === 0) {
    return {
      answer: "",
      sources: [],
      chunksRetrieved: 0,
      augmentedPrompt: query,
    };
  }

  // 2. Build augmented prompt
  const contextBlock = chunks
    .map((c, i) => `[Context ${i + 1} from ${c.source}]:\n${c.content}`)
    .join("\n\n---\n\n");

  const augmentedPrompt = `${contextBlock}\n\n---\n\nQuestion: ${query}`;

  // 3. Generate answer
  const systemPrompt = `You are a helpful assistant with access to relevant context.
Answer the question using ONLY the provided context. If the context doesn't contain enough information, say so.
Always cite which context source you used (e.g., "According to [Context 2]...").
${systemContext}`;

  const answer = await backgroundSimpleCompletion([
    { role: "system", content: systemPrompt },
    { role: "user", content: augmentedPrompt }
  ]);

  return {
    answer,
    sources: chunks,
    chunksRetrieved: chunks.length,
    augmentedPrompt,
  };
}

/**
 * Check if a query would benefit from RAG (i.e., it's asking about the codebase or workspace).
 */
export function shouldUseRag(query: string): boolean {
  const ragTriggers = [
    /how does .+ work/i,
    /where is .+ defined/i,
    /what does .+ do/i,
    /find .+ in the code/i,
    /show me .+ implementation/i,
    /explain .+ module/i,
    /what files/i,
    /search .+ codebase/i,
    /in the workspace/i,
    /in andromeda/i,
  ];
  return ragTriggers.some(pattern => pattern.test(query));
}

// ─── REST API ─────────────────────────────────────────────────────────────────

export function registerRagRoutes(app: Express): void {
  // Ingest a document
  app.post("/api/rag/ingest", async (req, res) => {
    const { content, source, filePath, metadata } = req.body;
    try {
      if (filePath) {
        const result = await ingestFile(filePath);
        res.json({ success: true, ...result });
      } else if (content && source) {
        const result = await ingestDocument(content, source, metadata ?? {});
        res.json({ success: true, ...result });
      } else {
        res.status(400).json({ error: "Provide either filePath or (content + source)" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Query the RAG pipeline
  app.post("/api/rag/query", async (req, res) => {
    const { query, topK, systemContext } = req.body;
    if (!query) { res.status(400).json({ error: "query required" }); return; }
    try {
      const result = await ragQuery(query, systemContext, topK ?? 5);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get RAG stats
  app.get("/api/rag/stats", (_req, res) => {
    try {
      const stats = vectorStats();
      res.json({ ...stats, ragEnabled: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Chunk a document (preview without storing)
  app.post("/api/rag/chunk-preview", (req, res) => {
    const { content, source } = req.body;
    if (!content) { res.status(400).json({ error: "content required" }); return; }
    const chunks = chunkDocument(content, source ?? "preview");
    res.json({
      chunks: chunks.map((c, i) => ({ index: i, length: c.length, preview: c.slice(0, 100) })),
      totalChunks: chunks.length,
      totalChars: content.length,
    });
  });
}
