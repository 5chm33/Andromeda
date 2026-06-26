import fs from "fs";
import path from "path";

export interface ArxivSubmissionResult {
  success: boolean;
  paperId?: string;
  feedback?: string;
}

const SUBMITTED_PAPERS_DB = path.join(process.cwd(), "data", "arxiv_submissions.json");

function loadSubmissions(): Record<string, string> {
  if (fs.existsSync(SUBMITTED_PAPERS_DB)) {
    try {
      return JSON.parse(fs.readFileSync(SUBMITTED_PAPERS_DB, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveSubmission(paperPath: string, arxivId: string) {
  const dir = path.dirname(SUBMITTED_PAPERS_DB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  const subs = loadSubmissions();
  subs[paperPath] = arxivId;
  fs.writeFileSync(SUBMITTED_PAPERS_DB, JSON.stringify(subs, null, 2));
}

/**
 * Validates a generated research paper against arXiv submission criteria.
 */
function validatePaperQuality(content: string): { isValid: boolean; reason?: string } {
  const wordCount = content.split(/\s+/).length;
  if (wordCount < 1000) {
    return { isValid: false, reason: `Paper too short (${wordCount} words). Minimum 1000 required.` };
  }

  const hasCitations = content.includes("[1]") || content.includes("References");
  if (!hasCitations) {
    return { isValid: false, reason: "Paper lacks proper citations or references section." };
  }

  const hasAbstract = content.toLowerCase().includes("abstract");
  if (!hasAbstract) {
    return { isValid: false, reason: "Paper lacks an abstract." };
  }

  return { isValid: true };
}

/**
 * Formats Markdown to a simulated LaTeX structure and submits to arXiv.
 * In production, this would use the arXiv submission API.
 */
export async function submitToArxiv(paperPath: string): Promise<ArxivSubmissionResult> {
  if (!fs.existsSync(paperPath)) {
    return { success: false, feedback: "Paper file not found." };
  }

  const subs = loadSubmissions();
  if (subs[paperPath]) {
    return { success: false, feedback: `Already submitted as ${subs[paperPath]}` };
  }

  const content = fs.readFileSync(paperPath, "utf-8");
  const validation = validatePaperQuality(content);

  if (!validation.isValid) {
    console.log(`[arXiv] Paper rejected by quality gate: ${validation.reason}`);
    return { success: false, feedback: validation.reason };
  }

  console.log(`[arXiv] Formatting ${paperPath} to LaTeX and submitting...`);
  
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Simulate successful submission
  const simulatedId = `arxiv.${new Date().getFullYear() % 100}${String(new Date().getMonth() + 1).padStart(2, '0')}.${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`;
  
  saveSubmission(paperPath, simulatedId);
  console.log(`[arXiv] Successfully submitted! ID: ${simulatedId}`);

  return { success: true, paperId: simulatedId };
}

/**
 * Daemon process that scans the research_papers directory for unsubmitted papers.
 */
export async function scanAndSubmitPapers() {
  const papersDir = path.join(process.cwd(), "research_papers");
  if (!fs.existsSync(papersDir)) return;

  const files = fs.readdirSync(papersDir).filter(f => f.endsWith(".md"));
  const subs = loadSubmissions();

  for (const file of files) {
    const fullPath = path.join(papersDir, file);
    if (!subs[fullPath]) {
      await submitToArxiv(fullPath);
    }
  }
}
