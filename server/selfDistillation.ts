/**
 * selfDistillation.ts — Phase 3a: Self-Distillation Pipeline
 * Andromeda v9.16.0
 *
 * Extracts high-quality examples from the SQLite RLHF and eval databases
 * and formats them into Direct Preference Optimization (DPO) datasets.
 * This bridges the gap between runtime human feedback and foundation model fine-tuning.
 */

import * as fs from "fs";
import * as path from "path";
import { getDb } from "./andromedaDb.js";
import { createLogger } from "./logger.js";

const log = createLogger("selfDistillation");

export interface DpoPair {
  prompt: string;
  chosen: string;
  rejected: string;
}

/**
 * Extracts a DPO dataset from the SQLite feedback table.
 * Finds queries that have both a positive (rating=1) and negative (rating=-1) response.
 */
export function extractDpoDataset(minPairs = 10): DpoPair[] {
  const db = getDb();
  
  // Find queries that have at least one positive and one negative rating
  const rows = db.prepare(`
    SELECT query, response, rating
    FROM feedback
    WHERE rating IN (-1, 1)
    ORDER BY query, created_at DESC
  `).all() as Array<{ query: string; response: string; rating: number }>;

  // Group by query
  const grouped = new Map<string, { positive: string[]; negative: string[] }>();
  for (const row of rows) {
    if (!grouped.has(row.query)) {
      grouped.set(row.query, { positive: [], negative: [] });
    }
    const group = grouped.get(row.query)!;
    if (row.rating === 1) group.positive.push(row.response);
    else group.negative.push(row.response);
  }

  // Create pairs
  const dataset: DpoPair[] = [];
  for (const [query, group] of grouped.entries()) {
    if (group.positive.length > 0 && group.negative.length > 0) {
      // Pair the most recent positive with the most recent negative
      dataset.push({
        prompt: query,
        chosen: group.positive[0],
        rejected: group.negative[0],
      });
    }
  }

  log.info(`[Distillation] Extracted ${dataset.length} DPO pairs from RLHF database`);
  return dataset;
}

/**
 * Exports the extracted DPO dataset to a JSONL file suitable for HuggingFace / TRL.
 */
export function exportDpoDataset(outputPath?: string): { success: boolean; path?: string; count: number; error?: string } {
  try {
    const dataset = extractDpoDataset();
    if (dataset.length === 0) {
      return { success: false, count: 0, error: "Not enough RLHF data to form DPO pairs" };
    }

    const outPath = outputPath ?? path.join(process.cwd(), "data", `dpo_dataset_${Date.now()}.jsonl`);
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const lines = dataset.map(pair => JSON.stringify(pair)).join("\n");
    fs.writeFileSync(outPath, lines, "utf8");

    log.info(`[Distillation] Exported DPO dataset to ${outPath}`);
    return { success: true, path: outPath, count: dataset.length };
  } catch (err) {
    log.error(`[Distillation] Export failed: ${(err as Error).message}`);
    return { success: false, count: 0, error: (err as Error).message };
  }
}
