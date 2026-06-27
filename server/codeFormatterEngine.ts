/**
 * codeFormatterEngine.ts — v81.0.0 "Code Intelligence"
 * Applies configurable formatting rules to source code (indentation, trailing whitespace, etc.).
 */
export interface FormatterConfig {
  indentSize: number;
  useTabs: boolean;
  maxLineLength: number;
  trailingNewline: boolean;
  trimTrailingWhitespace: boolean;
  semicolons: boolean;
  singleQuotes: boolean;
}

export interface FormattingResult {
  original: string;
  formatted: string;
  changeCount: number;
  issues: string[];
}

const DEFAULT_CONFIG: FormatterConfig = {
  indentSize: 2,
  useTabs: false,
  maxLineLength: 120,
  trailingNewline: true,
  trimTrailingWhitespace: true,
  semicolons: true,
  singleQuotes: false,
};

export function formatCode(code: string, config: Partial<FormatterConfig> = {}): FormattingResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let formatted = code;
  let changeCount = 0;
  const issues: string[] = [];

  // Trim trailing whitespace
  if (cfg.trimTrailingWhitespace) {
    const trimmed = formatted.split("\n").map(l => l.trimEnd()).join("\n");
    if (trimmed !== formatted) { changeCount++; formatted = trimmed; }
  }

  // Normalize indentation
  const indentChar = cfg.useTabs ? "\t" : " ".repeat(cfg.indentSize);
  const normalized = formatted.split("\n").map(line => {
    const match = line.match(/^(\s+)/);
    if (!match) return line;
    const spaces = match[1].replace(/\t/g, " ".repeat(cfg.indentSize));
    const indentCount = Math.floor(spaces.length / cfg.indentSize);
    return indentChar.repeat(indentCount) + line.trimStart();
  }).join("\n");
  if (normalized !== formatted) { changeCount++; formatted = normalized; }

  // Trailing newline
  if (cfg.trailingNewline && !formatted.endsWith("\n")) {
    formatted += "\n";
    changeCount++;
  }

  // Check line lengths
  formatted.split("\n").forEach((line, i) => {
    if (line.length > cfg.maxLineLength) {
      issues.push(`Line ${i + 1} exceeds max length (${line.length} > ${cfg.maxLineLength})`);
    }
  });

  // Quote normalization (simple: replace double quotes in strings with single if configured)
  if (cfg.singleQuotes) {
    const q = formatted.replace(/"([^"\\]*)"/g, "'$1'");
    if (q !== formatted) { changeCount++; formatted = q; }
  }

  return { original: code, formatted, changeCount, issues };
}

export function getDefaultConfig(): FormatterConfig { return { ...DEFAULT_CONFIG }; }
