/**
 * infiniteContextSummarizer.ts — v20.0.0
 * 
 * The "Infinite Context" Summarizer.
 * Maintains a hierarchical, continuously updated summary of the entire codebase,
 * allowing the agent to "understand" massive repos without exceeding token limits.
 */

import * as fs from "fs";
import * as path from "path";
import { getApiKey, getApiUrl, getProviderHeaders } from "./aiTokens.js";

export interface FileSummary {
  filePath: string;
  summary: string;
  exports: string[];
  dependencies: string[];
  lastUpdated: number;
}

export interface DirectorySummary {
  dirPath: string;
  summary: string;
  keyFiles: string[];
  lastUpdated: number;
}

function getSummaryDir(): string {
  return path.join(process.cwd(), ".andromeda_summaries");
}

/**
 * Initializes the summary storage.
 */
export function initSummarizer(): void {
  const summaryDir = getSummaryDir();
  if (!fs.existsSync(summaryDir)) {
    fs.mkdirSync(summaryDir, { recursive: true });
    fs.writeFileSync(path.join(summaryDir, "file_summaries.json"), JSON.stringify({}));
    fs.writeFileSync(path.join(summaryDir, "dir_summaries.json"), JSON.stringify({}));
  }
}

/**
 * Mock LLM summarization for the daemon.
 */
async function generateSummaryLLM(content: string, type: "file" | "dir"): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) return `Simulated ${type} summary generated without API key.`;

  try {
    const response = await fetch(`${getApiUrl()}/chat/completions`, {
      method: "POST",
      headers: getProviderHeaders(),
      body: JSON.stringify({
        model: "gpt-4o-mini", // Use cheap model for summarization
        messages: [
          { role: "system", content: `Summarize this ${type} concisely for an AI agent context window.` },
          { role: "user", content: content.substring(0, 10000) } // Truncate to save tokens
        ]
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (response.ok) {
      const data = await response.json() as any;
      return data.choices?.[0]?.message?.content || `Failed to generate ${type} summary.`;
    }
  } catch {}
  
  return `Simulated ${type} summary (API failed).`;
}

/**
 * Summarizes a single file and updates the graph.
 */
export async function summarizeFile(filePath: string): Promise<FileSummary> {
  initSummarizer();
  const content = fs.readFileSync(filePath, "utf-8");
  
  // Extract naive exports/deps
  const exports = (content.match(/export (?:const|function|class|interface|type) (\w+)/g) || [])
    .map(e => e.split(" ")[2]);
  const deps = (content.match(/import .* from ['"](.*)['"]/g) || [])
    .map(d => d.split(/['"]/)[1]);

  const summaryText = await generateSummaryLLM(content, "file");

  const summary: FileSummary = {
    filePath,
    summary: summaryText,
    exports,
    dependencies: deps,
    lastUpdated: Date.now()
  };

  const storePath = path.join(getSummaryDir(), "file_summaries.json");
  const store = JSON.parse(fs.readFileSync(storePath, "utf-8"));
  store[filePath] = summary;
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));

  return summary;
}

/**
 * Retrieves the hierarchical context for a given target file.
 */
export function getHierarchicalContext(targetFile: string): string {
  initSummarizer();
  const fileStore = JSON.parse(fs.readFileSync(path.join(getSummaryDir(), "file_summaries.json"), "utf-8"));
  
  const targetSummary = fileStore[targetFile];
  if (!targetSummary) return `No summary available for ${targetFile}.`;

  let context = `### Target File: ${targetFile}\n${targetSummary.summary}\n\n`;
  context += `### Dependencies Context:\n`;

  for (const dep of targetSummary.dependencies) {
    // Naive resolution for local deps
    if (dep.startsWith(".")) {
      const depName = path.basename(dep, ".js") + ".ts";
      const depKey = Object.keys(fileStore).find(k => k.endsWith(depName));
      if (depKey) {
        context += `- **${depName}**: ${fileStore[depKey].summary}\n`;
      }
    }
  }

  return context;
}
