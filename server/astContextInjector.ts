/**
 * astContextInjector.ts — v12.9.0 — AST-Based Context Injection
 *
 * Uses the TypeScript compiler API to extract precise, semantically-rich
 * context around a tsc error location. Unlike the line-radius approach in
 * tsHealEngine.ts (which extracts ±25 raw lines), this module:
 *
 *  1. Parses the file into a full AST using ts.createSourceFile()
 *  2. Walks the AST to find the enclosing function/class/interface at the
 *     error location
 *  3. Extracts the FULL enclosing declaration (not just ±N lines) so the
 *     LLM sees the complete function signature, all parameters, and the
 *     return type annotation
 *  4. Collects the type declarations of all symbols referenced in the
 *     enclosing scope (interfaces, type aliases, enums) from the same file
 *  5. Returns a structured context object that the heal engine injects
 *     directly into its system prompt
 *
 * Expected impact: +5-8% heal success rate by giving the LLM the full
 * type context it needs to produce a correct fix on the first attempt,
 * reducing the number of proposals that exhaust all 3 heal retries.
 *
 * Integration: called from tsHealEngine.ts::buildStrategyStructuredFix()
 * to enrich the prompt with AST-derived context.
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AstContext {
  /** The full text of the enclosing function/method/arrow function */
  enclosingFunction: string | null;
  /** The full text of the enclosing class, if any */
  enclosingClass: string | null;
  /** All interface/type/enum declarations referenced in the enclosing scope */
  referencedTypes: Array<{ name: string; declaration: string }>;
  /** Import statements at the top of the file */
  imports: string[];
  /** A summary string ready to inject into an LLM prompt */
  promptContext: string;
}

// ─── Core AST Extraction ──────────────────────────────────────────────────────

/**
 * Extract AST context around a specific line/column in a TypeScript file.
 * Returns a structured AstContext object.
 *
 * @param filePath - Absolute path to the TypeScript file
 * @param errorLine - 1-indexed line number of the error
 * @param errorCol  - 1-indexed column number of the error
 */
export function extractAstContext(
  filePath: string,
  errorLine: number,
  errorCol: number
): AstContext {
  const empty: AstContext = {
    enclosingFunction: null,
    enclosingClass: null,
    referencedTypes: [],
    imports: [],
    promptContext: "",
  };

  let source: string;
  try {
    source = fs.readFileSync(filePath, "utf-8");
  } catch {
    return empty;
  }

  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      path.basename(filePath),
      source,
      ts.ScriptTarget.Latest,
      true // setParentNodes
    );
  } catch {
    return empty;
  }

  // Convert 1-indexed line/col to 0-indexed character position
  const lines = source.split("\n");
  let charPos = 0;
  for (let i = 0; i < Math.min(errorLine - 1, lines.length); i++) {
    charPos += lines[i].length + 1; // +1 for newline
  }
  charPos += Math.max(0, errorCol - 1);

  // ── Walk AST to find enclosing function and class ──────────────────────────

  let enclosingFunction: ts.Node | null = null as ts.Node | null;
  let enclosingClass: ts.Node | null = null as ts.Node | null;
  const referencedTypeNames = new Set<string>();

  function walk(node: ts.Node): void {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();

    // Check if this node contains the error position
    if (start <= charPos && charPos <= end) {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isConstructorDeclaration(node)
      ) {
        enclosingFunction = node;
      }
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        enclosingClass = node;
      }
    }

    ts.forEachChild(node, walk);
  }

  try {
    walk(sourceFile);
  } catch {
    return empty;
  }

  // ── Collect referenced type names from the enclosing function ─────────────

  function collectTypeRefs(node: ts.Node): void {
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(sourceFile);
      if (name && /^[A-Z]/.test(name)) {
        // Only collect PascalCase type names (interfaces, classes, enums)
        referencedTypeNames.add(name);
      }
    }
    ts.forEachChild(node, collectTypeRefs);
  }

  if (enclosingFunction) {
    try {
      collectTypeRefs(enclosingFunction);
    } catch { /* non-fatal */ }
  }

  // ── Extract top-level type/interface/enum declarations ────────────────────

  const referencedTypes: Array<{ name: string; declaration: string }> = [];
  const imports: string[] = [];

  try {
    ts.forEachChild(sourceFile, (node) => {
      // Collect import statements
      if (ts.isImportDeclaration(node)) {
        const importText = node.getText(sourceFile);
        if (importText.length < 200) {
          imports.push(importText.trim());
        }
        return;
      }

      // Collect type/interface/enum declarations that are referenced
      if (
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)
      ) {
        const name = (node as any).name?.getText(sourceFile) ?? "";
        if (referencedTypeNames.has(name)) {
          const declText = node.getText(sourceFile);
          if (declText.length < 800) {
            referencedTypes.push({ name, declaration: declText.trim() });
          }
        }
      }
    });
  } catch { /* non-fatal */ }

  // ── Build the prompt context string ───────────────────────────────────────

  const parts: string[] = [];

  if (enclosingFunction) {
    const fnText = enclosingFunction.getText(sourceFile);
    // Limit to 600 chars to avoid bloating the prompt
    const fnTruncated = fnText.length > 600 ? fnText.slice(0, 600) + "\n  // ... (truncated)" : fnText;
    parts.push(`=== ENCLOSING FUNCTION (full declaration) ===\n\`\`\`typescript\n${fnTruncated}\n\`\`\``);
  }

  if (enclosingClass) {
    const clsText = enclosingClass.getText(sourceFile);
    // Only include class signature (first 200 chars) to avoid bloat
    const clsSignature = clsText.slice(0, 200);
    parts.push(`=== ENCLOSING CLASS (signature) ===\n\`\`\`typescript\n${clsSignature}\n// ...\n\`\`\``);
  }

  if (referencedTypes.length > 0) {
    const typeDecls = referencedTypes
      .slice(0, 4) // limit to 4 types
      .map(t => t.declaration)
      .join("\n\n");
    parts.push(`=== REFERENCED TYPE DECLARATIONS ===\n\`\`\`typescript\n${typeDecls}\n\`\`\``);
  }

  if (imports.length > 0) {
    const importBlock = imports.slice(0, 8).join("\n");
    parts.push(`=== FILE IMPORTS ===\n\`\`\`typescript\n${importBlock}\n\`\`\``);
  }

  const promptContext = parts.join("\n\n");

  return {
    enclosingFunction: enclosingFunction ? enclosingFunction.getText(sourceFile) : null,
    enclosingClass: enclosingClass ? enclosingClass.getText(sourceFile).slice(0, 300) : null,
    referencedTypes,
    imports,
    promptContext,
  };
}

/**
 * Extract AST context for multiple errors (e.g., all errors in a file).
 * Returns the context for the first error that yields a non-empty result.
 */
export function extractAstContextForErrors(
  filePath: string,
  errors: Array<{ line: number; col: number }>
): AstContext {
  for (const err of errors.slice(0, 3)) {
    const ctx = extractAstContext(filePath, err.line, err.col);
    if (ctx.enclosingFunction || ctx.referencedTypes.length > 0) {
      return ctx;
    }
  }
  // Return empty context if nothing useful found
  return {
    enclosingFunction: null,
    enclosingClass: null,
    referencedTypes: [],
    imports: [],
    promptContext: "",
  };
}
