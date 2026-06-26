import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface CodePattern {
  hash: string;
  occurrences: string[]; // file paths
  lines: string[];
  frequency: number;
}

const ABSTRACTION_STATE = path.join(process.cwd(), ".andromeda_abstractions.json");

export function initAbstractionEngine(): void {
  if (!fs.existsSync(ABSTRACTION_STATE)) {
    fs.writeFileSync(ABSTRACTION_STATE, JSON.stringify({ patterns: [] }, null, 2));
  }
}

/**
 * Scans a file for repeated logic blocks that exist elsewhere in the codebase.
 * A very simplified AST-agnostic exact-match scanner for demonstration.
 */
export function scanForAbstractions(filePath: string, content: string): CodePattern[] {
  const lines = content.split("\n");
  const patterns: CodePattern[] = [];
  
  // Look for blocks of 5+ lines
  for (let i = 0; i < lines.length - 5; i++) {
    const block = lines.slice(i, i + 5).join("\n");
    // Ignore empty or comment-heavy blocks
    if (block.trim().length < 50 || block.includes("/*") || block.includes("//")) continue;
    
    const hash = crypto.createHash("md5").update(block).digest("hex");
    patterns.push({
      hash,
      occurrences: [filePath],
      lines: lines.slice(i, i + 5),
      frequency: 1
    });
  }
  
  return patterns;
}

export function recordAbstractions(patterns: CodePattern[]): void {
  try {
    const state = JSON.parse(fs.readFileSync(ABSTRACTION_STATE, "utf-8"));
    const existing = state.patterns as CodePattern[];
    
    for (const p of patterns) {
      const match = existing.find(e => e.hash === p.hash);
      if (match) {
        if (!match.occurrences.includes(p.occurrences[0])) {
          match.occurrences.push(p.occurrences[0]);
          match.frequency++;
        }
      } else {
        existing.push(p);
      }
    }
    
    // Sort by frequency
    existing.sort((a, b) => b.frequency - a.frequency);
    state.patterns = existing.slice(0, 100); // Keep top 100
    
    fs.writeFileSync(ABSTRACTION_STATE, JSON.stringify(state, null, 2));
  } catch (e) {
    // Ignore read/write errors
  }
}

export function getTopAbstractions(): CodePattern[] {
  try {
    const state = JSON.parse(fs.readFileSync(ABSTRACTION_STATE, "utf-8"));
    return state.patterns.filter((p: CodePattern) => p.frequency >= 3);
  } catch {
    return [];
  }
}
