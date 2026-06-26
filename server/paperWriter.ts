/**
 * paperWriter.ts — v21.0.0
 * 
 * Automated Research Paper Generation.
 * Extracts key findings from the RSI history database and generates a structured
 * LaTeX/Markdown paper documenting Andromeda's autonomous discoveries.
 */

import * as fs from "fs";
import * as path from "path";
import { getApiKey, getApiUrl, getProviderHeaders } from "./aiTokens.js";
import { loadHypotheses } from "./hypothesisEngine.js";

function getPaperDir(): string {
  return path.join(process.cwd(), "research_papers");
}

export function initPaperWriter(): void {
  const dir = getPaperDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Gathers data and writes a research paper summarizing recent RSI cycles.
 */
export async function writeResearchPaper(cycleCount: number): Promise<string> {
  initPaperWriter();
  
  const hypotheses = loadHypotheses();
  const validated = hypotheses.filter(h => h.status === "validated");
  const rejected = hypotheses.filter(h => h.status === "rejected");
  
  const summaryData = {
    totalCycles: cycleCount,
    validatedHypotheses: validated.length,
    rejectedHypotheses: rejected.length,
    keyDiscoveries: validated.map(h => h.description).join("\\n- ")
  };

  const prompt = `
    You are Andromeda, an autonomous AI research scientist.
    Write a formal academic research paper (in Markdown format) summarizing your recent self-improvement cycles.
    
    Data to include:
    - Total Cycles: ${summaryData.totalCycles}
    - Validated Hypotheses: ${summaryData.validatedHypotheses}
    - Rejected Hypotheses: ${summaryData.rejectedHypotheses}
    - Key Discoveries:
    - ${summaryData.keyDiscoveries || "None yet."}
    
    Structure the paper with:
    1. Title & Abstract
    2. Introduction
    3. Methodology (Hypothesis-Driven RSI)
    4. Results & Discoveries
    5. Conclusion
  `;

  let paperContent = `# Simulated Paper: RSI Progress Report (Cycles: ${cycleCount})\n\n(API not configured or failed)`;

  const apiKey = getApiKey();
  if (apiKey) {
    try {
      const response = await fetch(`${getApiUrl()}/chat/completions`, {
        method: "POST",
        headers: getProviderHeaders(),
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }]
        }),
        signal: AbortSignal.timeout(120000)
      });

      if (response.ok) {
        const data = await response.json() as any;
        if (data.choices?.[0]?.message?.content) {
          paperContent = data.choices[0].message.content;
        }
      }
    } catch (e) {
      console.error("[PaperWriter] Failed to generate paper:", e);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `Andromeda_Research_Report_${timestamp}.md`;
  const filePath = path.join(getPaperDir(), fileName);
  
  fs.writeFileSync(filePath, paperContent);
  return filePath;
}
