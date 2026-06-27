/**
 * codeSearchIndexer.ts — v81.0.0 "Code Intelligence"
 * Indexes code symbols and provides fast full-text and symbol search across a codebase.
 */
export type SymbolKind = "function" | "class" | "variable" | "interface" | "type" | "enum" | "import";

export interface CodeSymbol {
  symbolId: string;
  name: string;
  kind: SymbolKind;
  fileName: string;
  line: number;
  signature: string;
  docComment: string;
}

export interface SearchResult {
  symbol: CodeSymbol;
  score: number;
  matchType: "exact" | "prefix" | "fuzzy" | "fulltext";
}

const index = new Map<string, CodeSymbol>();
let symbolCounter = 0;

export function indexSymbol(params: Omit<CodeSymbol, "symbolId">): CodeSymbol {
  const symbol: CodeSymbol = { ...params, symbolId: `sym-${++symbolCounter}` };
  index.set(symbol.symbolId, symbol);
  return symbol;
}

export function searchSymbols(query: string, options: { kind?: SymbolKind; fileName?: string; limit?: number } = {}): SearchResult[] {
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const symbol of index.values()) {
    if (options.kind && symbol.kind !== options.kind) continue;
    if (options.fileName && symbol.fileName !== options.fileName) continue;

    const name = symbol.name.toLowerCase();
    let score = 0;
    let matchType: SearchResult["matchType"] = "fuzzy";

    if (name === q) { score = 100; matchType = "exact"; }
    else if (name.startsWith(q)) { score = 80; matchType = "prefix"; }
    else if (name.includes(q)) { score = 60; matchType = "fuzzy"; }
    else if (symbol.docComment.toLowerCase().includes(q) || symbol.signature.toLowerCase().includes(q)) { score = 40; matchType = "fulltext"; }

    if (score > 0) results.push({ symbol, score, matchType });
  }

  results.sort((a, b) => b.score - a.score);
  return options.limit ? results.slice(0, options.limit) : results;
}

export function getSymbolsByFile(fileName: string): CodeSymbol[] {
  return [...index.values()].filter(s => s.fileName === fileName);
}

export function getIndexSize(): number { return index.size; }
export function _resetCodeSearchIndexerForTest(): void { index.clear(); symbolCounter = 0; }
