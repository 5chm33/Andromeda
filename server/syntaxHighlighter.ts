/**
 * syntaxHighlighter.ts — v81.0.0 "Code Intelligence"
 * Applies syntax highlighting to tokenized code, producing annotated HTML or ANSI output.
 */
export type OutputFormat = "html" | "ansi" | "plain";

export interface HighlightTheme {
  keyword: string;
  string: string;
  number: string;
  comment: string;
  identifier: string;
  operator: string;
  punctuation: string;
}

export interface HighlightResult {
  format: OutputFormat;
  output: string;
  tokenCount: number;
}

const HTML_THEME: HighlightTheme = {
  keyword: "#569cd6",
  string: "#ce9178",
  number: "#b5cea8",
  comment: "#6a9955",
  identifier: "#9cdcfe",
  operator: "#d4d4d4",
  punctuation: "#d4d4d4",
};

const ANSI_COLORS: Record<string, string> = {
  "#569cd6": "\x1b[34m",
  "#ce9178": "\x1b[33m",
  "#b5cea8": "\x1b[32m",
  "#6a9955": "\x1b[90m",
  "#9cdcfe": "\x1b[36m",
  "#d4d4d4": "\x1b[37m",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlight(tokens: Array<{ type: string; value: string }>, format: OutputFormat = "html", theme: HighlightTheme = HTML_THEME): HighlightResult {
  let output = "";

  for (const token of tokens) {
    const color = theme[token.type as keyof HighlightTheme] ?? theme.identifier;

    if (format === "html") {
      output += `<span style="color:${color}">${escapeHtml(token.value)}</span>`;
    } else if (format === "ansi") {
      const ansi = ANSI_COLORS[color] ?? "\x1b[0m";
      output += `${ansi}${token.value}\x1b[0m`;
    } else {
      output += token.value;
    }
  }

  return { format, output, tokenCount: tokens.length };
}

export function highlightCode(code: string, format: OutputFormat = "html"): HighlightResult {
  // Simple regex-based tokenizer for highlighting
  const tokenPattern = /(\/\/[^\n]*|"[^"]*"|'[^']*'|`[^`]*`|\b\d+\.?\d*\b|\b(?:import|export|const|let|var|function|class|return|if|else|for|while|async|await|new|from|type|interface)\b|[a-zA-Z_$][\w$]*|[+\-*/<>=!&|^~%]+|[{}()\[\];:,.])/g;
  const tokens: Array<{ type: string; value: string }> = [];
  const keywords = new Set(["import", "export", "const", "let", "var", "function", "class", "return", "if", "else", "for", "while", "async", "await", "new", "from", "type", "interface"]);

  let match;
  while ((match = tokenPattern.exec(code)) !== null) {
    const v = match[0];
    let type = "identifier";
    if (v.startsWith("//")) type = "comment";
    else if (v.startsWith('"') || v.startsWith("'") || v.startsWith("`")) type = "string";
    else if (/^\d/.test(v)) type = "number";
    else if (keywords.has(v)) type = "keyword";
    else if (/[+\-*/<>=!&|^~%]/.test(v)) type = "operator";
    else if (/[{}()\[\];:,.]/.test(v)) type = "punctuation";
    tokens.push({ type, value: v });
  }

  return highlight(tokens, format);
}
