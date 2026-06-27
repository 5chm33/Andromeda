/**
 * codeParser.ts — v81.0.0 "Code Intelligence"
 * Parses source code into a simplified AST-like structure for analysis.
 */
export type TokenType = "keyword" | "identifier" | "string" | "number" | "operator" | "comment" | "whitespace" | "punctuation";
export type Language = "typescript" | "javascript" | "python" | "rust" | "go" | "java";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export interface ParsedFile {
  language: Language;
  fileName: string;
  tokens: Token[];
  lineCount: number;
  tokenCount: number;
  imports: string[];
  exports: string[];
  functions: string[];
  classes: string[];
}

const TS_KEYWORDS = new Set(["import", "export", "const", "let", "var", "function", "class", "interface", "type", "return", "if", "else", "for", "while", "async", "await", "new", "extends", "implements", "from", "default"]);

function tokenizeTypeScript(code: string): Token[] {
  const tokens: Token[] = [];
  const lines = code.split("\n");
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    let col = 0;
    while (col < line.length) {
      // Skip whitespace
      if (/\s/.test(line[col])) { col++; continue; }
      // Comment
      if (line.slice(col, col + 2) === "//") {
        tokens.push({ type: "comment", value: line.slice(col), line: lineNum + 1, column: col });
        break;
      }
      // String
      if (line[col] === '"' || line[col] === "'" || line[col] === "`") {
        const q = line[col];
        let end = col + 1;
        while (end < line.length && line[end] !== q) end++;
        tokens.push({ type: "string", value: line.slice(col, end + 1), line: lineNum + 1, column: col });
        col = end + 1; continue;
      }
      // Number
      if (/\d/.test(line[col])) {
        let end = col;
        while (end < line.length && /[\d.]/.test(line[end])) end++;
        tokens.push({ type: "number", value: line.slice(col, end), line: lineNum + 1, column: col });
        col = end; continue;
      }
      // Identifier or keyword
      if (/[a-zA-Z_$]/.test(line[col])) {
        let end = col;
        while (end < line.length && /[\w$]/.test(line[end])) end++;
        const word = line.slice(col, end);
        tokens.push({ type: TS_KEYWORDS.has(word) ? "keyword" : "identifier", value: word, line: lineNum + 1, column: col });
        col = end; continue;
      }
      // Operator / punctuation
      tokens.push({ type: /[+\-*/<>=!&|^~%]/.test(line[col]) ? "operator" : "punctuation", value: line[col], line: lineNum + 1, column: col });
      col++;
    }
  }
  return tokens;
}

export function parseFile(fileName: string, code: string, language: Language = "typescript"): ParsedFile {
  const tokens = tokenizeTypeScript(code);
  const lines = code.split("\n");

  const imports: string[] = [];
  const exports: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "keyword") {
      if (t.value === "import" && tokens[i + 1]) imports.push(tokens[i + 1].value);
      if (t.value === "export" && tokens[i + 1]) exports.push(tokens[i + 1].value);
      if (t.value === "function" && tokens[i + 1]?.type === "identifier") functions.push(tokens[i + 1].value);
      if (t.value === "class" && tokens[i + 1]?.type === "identifier") classes.push(tokens[i + 1].value);
    }
  }

  return { language, fileName, tokens, lineCount: lines.length, tokenCount: tokens.length, imports, exports, functions, classes };
}

export function _resetCodeParserForTest(): void { /* stateless */ }
