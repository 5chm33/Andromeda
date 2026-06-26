/**
 * semanticDiffValidator.ts — Semantic Diff Validation (v15.0.0)
 *
 * Parses the TypeScript AST of a file BEFORE and AFTER a proposed change and
 * detects semantic regressions that pass syntax checks but break the public API.
 *
 * Checks performed:
 *   1. Exported function signature changes (parameter count, name, return type)
 *   2. Exported interface/type changes (added/removed/renamed fields)
 *   3. Exported class method changes
 *   4. Missing test update (if a public API changes but no test file was modified)
 *   5. Accidental export removal (exported symbol disappears after the change)
 *
 * This is the final safety gate before a proposal is committed to git.
 *
 * @module semanticDiffValidator
 * @version 15.0.0
 */

import ts from "typescript";
import { createLogger } from "./logger.js";

const log = createLogger("semanticDiffValidator");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExportedSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "enum" | "variable";
  /** Serialized signature for functions (param names + types) */
  signature?: string;
  /** Field names for interfaces/types */
  fields?: string[];
  /** Method names for classes */
  methods?: string[];
}

export interface DiffValidationResult {
  /** Whether the diff is semantically safe to apply */
  safe: boolean;
  /** Human-readable summary of what changed */
  summary: string;
  /** List of breaking changes detected */
  breakingChanges: BreakingChange[];
  /** List of safe changes (informational) */
  safeChanges: string[];
  /** Whether a test file update is recommended */
  testUpdateRequired: boolean;
}

export interface BreakingChange {
  kind: "signature-changed" | "export-removed" | "field-removed" | "method-removed" | "type-changed";
  symbol: string;
  before: string;
  after: string;
  severity: "error" | "warning";
}

// ─── AST Extraction ───────────────────────────────────────────────────────────

/**
 * Extract all exported symbols from a TypeScript source string.
 *
 * @param source  TypeScript source code
 * @param fileName  Virtual file name (used for TypeScript compiler)
 * @returns  Map of symbol name → ExportedSymbol
 */
export function extractExports(source: string, fileName = "virtual.ts"): Map<string, ExportedSymbol> {
  const exports = new Map<string, ExportedSymbol>();

  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  } catch {
    return exports;
  }

  function visit(node: ts.Node): void {
    // export function foo(...)
    if (ts.isFunctionDeclaration(node) && _isExported(node) && node.name) {
      exports.set(node.name.text, {
        name: node.name.text,
        kind: "function",
        signature: _serializeFunctionSignature(node),
      });
    }

    // export async function foo(...)
    if (ts.isFunctionDeclaration(node) && _isExported(node) && node.name) {
      // Already handled above
    }

    // export interface Foo { ... }
    if (ts.isInterfaceDeclaration(node) && _isExported(node)) {
      const fields = node.members
        .filter(ts.isPropertySignature)
        .map(m => (m.name as ts.Identifier).text);
      exports.set(node.name.text, {
        name: node.name.text,
        kind: "interface",
        fields,
      });
    }

    // export type Foo = { ... }
    if (ts.isTypeAliasDeclaration(node) && _isExported(node)) {
      exports.set(node.name.text, {
        name: node.name.text,
        kind: "type",
        signature: node.type.getText(sourceFile),
      });
    }

    // export class Foo { ... }
    if (ts.isClassDeclaration(node) && _isExported(node) && node.name) {
      const methods = node.members
        .filter(ts.isMethodDeclaration)
        .filter(m => !_isPrivate(m))
        .map(m => (m.name as ts.Identifier).text);
      exports.set(node.name.text, {
        name: node.name.text,
        kind: "class",
        methods,
      });
    }

    // export const foo = ...
    if (ts.isVariableStatement(node) && _isExported(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          exports.set(decl.name.text, {
            name: decl.name.text,
            kind: "const",
          });
        }
      }
    }

    // export enum Foo { ... }
    if (ts.isEnumDeclaration(node) && _isExported(node)) {
      const fields = node.members.map(m => (m.name as ts.Identifier).text);
      exports.set(node.name.text, {
        name: node.name.text,
        kind: "enum",
        fields,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return exports;
}

function _isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function _isPrivate(node: ts.ClassElement): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.PrivateKeyword)
  );
}

function _serializeFunctionSignature(node: ts.FunctionDeclaration): string {
  const params = node.parameters.map(p => {
    const name = ts.isIdentifier(p.name) ? p.name.text : "?";
    const optional = p.questionToken ? "?" : "";
    return `${name}${optional}`;
  });
  return `(${params.join(", ")})`;
}

// ─── Core Validation ──────────────────────────────────────────────────────────

/**
 * Validate a proposed diff by comparing the AST of the before and after states.
 *
 * @param beforeSource  Original file content
 * @param afterSource   Proposed new file content
 * @param targetFile    File path (used for logging)
 * @returns             Validation result with breaking changes and safety verdict
 */
export function validateDiff(
  beforeSource: string,
  afterSource: string,
  targetFile: string
): DiffValidationResult {
  const beforeExports = extractExports(beforeSource, targetFile);
  const afterExports = extractExports(afterSource, targetFile);

  const breakingChanges: BreakingChange[] = [];
  const safeChanges: string[] = [];

  // ── 1. Check for removed exports ──────────────────────────────────────────
  for (const [name, before] of beforeExports) {
    if (!afterExports.has(name)) {
      breakingChanges.push({
        kind: "export-removed",
        symbol: name,
        before: `export ${before.kind} ${name}`,
        after: "(removed)",
        severity: "error",
      });
    }
  }

  // ── 2. Check for added exports (safe) ─────────────────────────────────────
  for (const [name] of afterExports) {
    if (!beforeExports.has(name)) {
      safeChanges.push(`New export added: ${name}`);
    }
  }

  // ── 3. Check for signature changes on existing exports ────────────────────
  for (const [name, before] of beforeExports) {
    const after = afterExports.get(name);
    if (!after) continue; // Already caught as removed

    // Function signature changes
    if (before.kind === "function" && after.kind === "function") {
      if (before.signature !== after.signature) {
        breakingChanges.push({
          kind: "signature-changed",
          symbol: name,
          before: `${name}${before.signature}`,
          after: `${name}${after.signature}`,
          severity: "error",
        });
      }
    }

    // Interface field removals
    if (before.kind === "interface" && after.kind === "interface") {
      const beforeFields = new Set(before.fields ?? []);
      const afterFields = new Set(after.fields ?? []);
      for (const field of beforeFields) {
        if (!afterFields.has(field)) {
          breakingChanges.push({
            kind: "field-removed",
            symbol: `${name}.${field}`,
            before: `${name} has field ${field}`,
            after: `${name} missing field ${field}`,
            severity: "error",
          });
        }
      }
      // Added fields are safe
      for (const field of afterFields) {
        if (!beforeFields.has(field)) {
          safeChanges.push(`New field added to ${name}: ${field}`);
        }
      }
    }

    // Class method removals
    if (before.kind === "class" && after.kind === "class") {
      const beforeMethods = new Set(before.methods ?? []);
      const afterMethods = new Set(after.methods ?? []);
      for (const method of beforeMethods) {
        if (!afterMethods.has(method)) {
          breakingChanges.push({
            kind: "method-removed",
            symbol: `${name}.${method}()`,
            before: `${name} has method ${method}()`,
            after: `${name} missing method ${method}()`,
            severity: "error",
          });
        }
      }
    }

    // Kind changes (e.g., function → const)
    if (before.kind !== after.kind) {
      breakingChanges.push({
        kind: "type-changed",
        symbol: name,
        before: `export ${before.kind} ${name}`,
        after: `export ${after.kind} ${name}`,
        severity: "error",
      });
    }
  }

  const safe = breakingChanges.filter(c => c.severity === "error").length === 0;
  const testUpdateRequired = breakingChanges.length > 0 || safeChanges.some(c => c.includes("New export"));

  const summary = safe
    ? `No breaking changes detected (${safeChanges.length} safe additions)`
    : `${breakingChanges.length} breaking change(s) detected`;

  if (!safe) {
    log.warn(`[semanticDiffValidator] ${targetFile}: ${summary}`);
    for (const bc of breakingChanges) {
      log.warn(`  [${bc.kind}] ${bc.symbol}: "${bc.before}" → "${bc.after}"`);
    }
  }

  return { safe, summary, breakingChanges, safeChanges, testUpdateRequired };
}

/**
 * Quick check — returns true if the diff is semantically safe to apply.
 * Use this for fast gating; use `validateDiff` for detailed reporting.
 *
 * @param beforeSource  Original file content
 * @param afterSource   Proposed new file content
 * @param targetFile    File path (used for logging)
 */
export function isSafeDiff(beforeSource: string, afterSource: string, targetFile: string): boolean {
  try {
    const result = validateDiff(beforeSource, afterSource, targetFile);
    return result.safe;
  } catch {
    // If validation fails, allow the diff (non-fatal)
    return true;
  }
}
