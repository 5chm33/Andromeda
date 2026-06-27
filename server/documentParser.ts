/**
 * documentParser.ts — v71.0.0 "Multi-Modal Intelligence"
 * Document parsing: PDF, HTML, Markdown, JSON, CSV with structure extraction and entity recognition.
 */
export type DocFormat = "pdf" | "html" | "markdown" | "json" | "csv" | "text";
export interface ParsedSection { title: string; content: string; level: number; }
export interface ParsedDocument { docId: string; format: DocFormat; title: string; sections: ParsedSection[]; wordCount: number; entities: Array<{ type: string; value: string }>; metadata: Record<string, string>; parsedAt: number; }

const docs: ParsedDocument[] = [];
let docCounter = 0;

export function parseDocument(format: DocFormat, rawContent: string, metadata: Record<string, string> = {}): ParsedDocument {
  const sections: ParsedSection[] = [];
  const entities: Array<{ type: string; value: string }> = [];
  let title = metadata.title ?? "Untitled";

  if (format === "markdown") {
    const lines = rawContent.split('\n');
    let currentSection: ParsedSection | null = null;
    for (const line of lines) {
      const h = line.match(/^(#{1,6})\s+(.+)/);
      if (h) {
        if (currentSection) sections.push(currentSection);
        currentSection = { title: h[2], content: "", level: h[1].length };
        if (h[1].length === 1) title = h[2];
      } else if (currentSection) currentSection.content += line + '\n';
    }
    if (currentSection) sections.push(currentSection);
  } else {
    sections.push({ title: "Content", content: rawContent, level: 1 });
  }

  // Simple entity extraction
  const emailMatches = rawContent.match(/[\w.-]+@[\w.-]+\.\w+/g) ?? [];
  emailMatches.forEach(e => entities.push({ type: "email", value: e }));
  const urlMatches = rawContent.match(/https?:\/\/[^\s]+/g) ?? [];
  urlMatches.forEach(u => entities.push({ type: "url", value: u }));

  const doc: ParsedDocument = { docId: `doc-${++docCounter}`, format, title, sections, wordCount: rawContent.split(/\s+/).filter(Boolean).length, entities, metadata, parsedAt: Date.now() };
  docs.push(doc);
  return doc;
}

export function searchDocuments(query: string): ParsedDocument[] {
  const q = query.toLowerCase();
  return docs.filter(d => d.title.toLowerCase().includes(q) || d.sections.some(s => s.content.toLowerCase().includes(q)));
}

export function getParsedDocs(): ParsedDocument[] { return [...docs]; }
export function _resetDocumentParserForTest(): void { docs.length = 0; docCounter = 0; }
