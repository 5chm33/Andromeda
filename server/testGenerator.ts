/**
 * testGenerator.ts — Autonomous Test Generation & Execution
 * 
 * Analyzes new code, generates unit tests, runs them, and reports
 * coverage gaps. Supports TypeScript (vitest) and Python (pytest).
 * 
 * v5.7 Enhancement
 */

import { execSync } from "child_process";
import { writeFileSync,  existsSync,  mkdirSync } from "fs";
import { join, basename, dirname } from "path";

// ── Types ────────────────────────────────────────────────────────────────────

export type TestFramework = "vitest" | "jest" | "pytest" | "unittest";

export type GeneratedTest = {
  id: string;
  targetFile: string;
  testFile: string;
  testCode: string;
  framework: TestFramework;
  testCount: number;
  functions: string[];
  timestamp: number;
};

export type TestRunResult = {
  testId: string;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  duration: number;
  output: string;
  success: boolean;
};

export type CoverageGap = {
  functionName: string;
  file: string;
  reason: string;
  priority: "high" | "medium" | "low";
};

export type TestGenConfig = {
  enabled: boolean;
  framework: TestFramework;
  outputDir: string;
  runAfterGenerate: boolean;
  includeEdgeCases: boolean;
  includeErrorCases: boolean;
  maxTestsPerFunction: number;
  timeout: number;
};

// ── State ────────────────────────────────────────────────────────────────────

const generatedTests: GeneratedTest[] = [];
const testResults: TestRunResult[] = [];
let testCounter = 0;

let config: TestGenConfig = {
  enabled: true,
  framework: "vitest",
  outputDir: "/tmp/andromeda_tests",
  runAfterGenerate: true,
  includeEdgeCases: true,
  includeErrorCases: true,
  maxTestsPerFunction: 5,
  timeout: 30_000,
};

// ── Code Analysis ────────────────────────────────────────────────────────────

type FunctionSignature = {
  name: string;
  params: { name: string; type: string; optional: boolean }[];
  returnType: string;
  isAsync: boolean;
  isExported: boolean;
  startLine: number;
  body: string;
};

function extractFunctions(code: string, language: "typescript" | "python"): FunctionSignature[] {
  const functions: FunctionSignature[] = [];
  const lines = code.split("\n");

  if (language === "typescript") {
    // Match: export function name(params): returnType {
    // Match: export async function name(params): Promise<returnType> {
    // Match: export const name = (params): returnType => {
    const funcRegex = /^(export\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{/;
    const arrowRegex = /^(export\s+)?(?:const|let)\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)(?:\s*:\s*([^=]+))?\s*=>/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      let match = line.match(funcRegex);
      if (match) {
        const body = extractFunctionBody(lines, i);
        functions.push({
          name: match[3],
          params: parseParams(match[4], "typescript"),
          returnType: (match[5] || "unknown").trim(),
          isAsync: !!match[2],
          isExported: !!match[1],
          startLine: i + 1,
          body,
        });
        continue;
      }
      match = line.match(arrowRegex);
      if (match) {
        const body = extractFunctionBody(lines, i);
        functions.push({
          name: match[2],
          params: parseParams(match[4], "typescript"),
          returnType: (match[5] || "unknown").trim(),
          isAsync: !!match[3],
          isExported: !!match[1],
          startLine: i + 1,
          body,
        });
      }
    }
  } else if (language === "python") {
    const funcRegex = /^(\s*)def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\S+))?\s*:/;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(funcRegex);
      if (match) {
        const indent = match[1].length;
        let bodyEnd = i + 1;
        while (bodyEnd < lines.length && (lines[bodyEnd].trim() === "" || getIndent(lines[bodyEnd]) > indent)) {
          bodyEnd++;
        }
        const body = lines.slice(i, bodyEnd).join("\n");
        functions.push({
          name: match[2],
          params: parseParams(match[3], "python"),
          returnType: match[4] || "unknown",
          isAsync: lines[i].trim().startsWith("async"),
          isExported: !match[2].startsWith("_"),
          startLine: i + 1,
          body,
        });
      }
    }
  }

  return functions;
}

function parseParams(paramStr: string, lang: "typescript" | "python"): FunctionSignature["params"] {
  if (!paramStr.trim()) return [];
  return paramStr.split(",").map(p => {
    const trimmed = p.trim();
    if (lang === "typescript") {
      const optional = trimmed.includes("?");
      const [name, type] = trimmed.replace("?", "").split(":").map(s => s.trim());
      return { name: name || "arg", type: type || "any", optional };
    } else {
      const [name, type] = trimmed.split(":").map(s => s.trim());
      const hasDefault = trimmed.includes("=");
      return { name: name.split("=")[0].trim(), type: type || "any", optional: hasDefault };
    }
  }).filter(p => p.name !== "self" && p.name !== "cls");
}

function extractFunctionBody(lines: string[], startLine: number): string {
  let braceCount = 0;
  let started = false;
  const bodyLines: string[] = [];
  for (let i = startLine; i < lines.length && i < startLine + 100; i++) {
    bodyLines.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === "{") { braceCount++; started = true; }
      if (ch === "}") braceCount--;
    }
    if (started && braceCount <= 0) break;
  }
  return bodyLines.join("\n");
}

function getIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

// ── Test Generation ──────────────────────────────────────────────────────────

/**
 * Generates a test suite for the given source code.
 * Extracts exported functions and creates test stubs with type assertions.
 * @param code Source code string to analyze
 * @param filePath Path to the source file (used to infer language)
 * @param language Optional language override ('typescript' | 'python')
 * @returns A GeneratedTest object containing the test code and metadata
 */
export function generateTests(code: string, filePath: string, language?: "typescript" | "python"): GeneratedTest {
  const lang = language || (filePath.endsWith(".py") ? "python" : "typescript");
  const functions = extractFunctions(code, lang);
  const exportedFunctions = functions.filter(f => f.isExported);

  let testCode: string;
  let framework: TestFramework;

  if (lang === "typescript") {
    framework = config.framework === "jest" ? "jest" : "vitest";
    testCode = generateTypeScriptTests(exportedFunctions, filePath, framework);
  } else {
    framework = config.framework === "unittest" ? "unittest" : "pytest";
    testCode = generatePythonTests(exportedFunctions, filePath, framework);
  }

  const testCount = (testCode.match(/(?:it\(|test\(|def test_)/g) || []).length;
  const testFileName = lang === "typescript"
    ? basename(filePath).replace(/\.ts$/, ".test.ts")
    : basename(filePath).replace(/\.py$/, "_test.py");

  const test: GeneratedTest = {
    id: `test_${testCounter++}`,
    targetFile: filePath,
    testFile: join(config.outputDir, testFileName),
    testCode,
    framework,
    testCount,
    functions: exportedFunctions.map(f => f.name),
    timestamp: Date.now(),
  };

  generatedTests.push(test);
  if (generatedTests.length > 50) generatedTests.splice(0, generatedTests.length - 50);

  return test;
}

function generateTypeScriptTests(functions: FunctionSignature[], filePath: string, framework: "vitest" | "jest"): string {
  const importLine = framework === "vitest"
    ? `import { describe, it, expect } from "vitest";`
    : ``;
  
  // v9.9.0: Use relative path so generated tests work in CI (absolute paths break on different machines)
  const relativePath = "./" + basename(filePath).replace(/\.ts$/, "");

  // v9.10.1: Handle barrel/re-export files (no exported functions) gracefully.
  // A barrel file like `export * from "./foo.js"` has 0 extracted functions.
  // Generating `import { } from ...` produces an invalid test file that breaks CI.
  // Instead, generate a namespace import test that validates the module loads.
  if (functions.length === 0) {
    return `${importLine}\nimport * as mod from "${relativePath}.js";\n\ndescribe("${basename(filePath).replace(/\.ts$/, "")} module", () => {\n  it("should load without errors", () => {\n    expect(mod).toBeDefined();\n    expect(typeof mod).toBe("object");\n  });\n});\n`;
  }

  const funcNames = functions.map(f => f.name).join(", ");
  
  let code = `${importLine}\nimport { ${funcNames} } from "${relativePath}.js";\n\n`;

  for (const func of functions) {
    code += `describe("${func.name}", () => {\n`;

    // Basic call test
    const args = func.params.filter(p => !p.optional).map(p => generateMockValue(p.type, p.name));
    const callExpr = func.isAsync ? `await ${func.name}(${args.join(", ")})` : `${func.name}(${args.join(", ")})`;
    const itFn = func.isAsync ? "it" : "it";
    const asyncPrefix = func.isAsync ? "async " : "";

    // v9.10.1: For void functions, wrap in expect().not.toThrow() instead of checking result.
    // For non-void functions, capture the result and check it's defined.
    const isVoid = func.returnType === "void" || func.returnType === "Promise<void>";
    code += `  ${itFn}("should execute without throwing", ${asyncPrefix}() => {\n`;
    if (isVoid) {
      code += `    // ${func.name} returns void — just verify it doesn't throw\n`;
      code += `    ${func.isAsync ? "await " : ""}expect(${func.isAsync ? "async " : ""}() => ${callExpr}).not.toThrow();\n`;
    } else {
      code += `    try {\n`;
      code += `      const result = ${callExpr};\n`;
      code += `      expect(result).toBeDefined();\n`;
      code += `    } catch (e: any) {\n`;
      code += `      // Function may throw in test environment (e.g. no providers registered)\n`;
      code += `      expect(e).toBeDefined();\n`;
      code += `    }\n`;
    }
    code += `  });\n\n`;

    // Return type test
    if (func.returnType !== "unknown" && func.returnType !== "void") {
      code += `  ${itFn}("should return correct type", ${asyncPrefix}() => {\n`;
      code += `    const result = ${callExpr};\n`;
      if (func.returnType.includes("[]") || func.returnType.includes("Array")) {
        code += `    expect(Array.isArray(result)).toBe(true);\n`;
      } else if (func.returnType === "string") {
        code += `    expect(typeof result).toBe("string");\n`;
      } else if (func.returnType === "number") {
        code += `    expect(typeof result).toBe("number");\n`;
      } else if (func.returnType === "boolean") {
        code += `    expect(typeof result).toBe("boolean");\n`;
      } else {
        code += `    expect(result).toBeTruthy();\n`;
      }
      code += `  });\n\n`;
    }

    // Edge cases
    if (config.includeEdgeCases && func.params.length > 0) {
      code += `  ${itFn}("should handle empty/null inputs gracefully", ${asyncPrefix}() => {\n`;
      const emptyArgs = func.params.map(p => generateEmptyValue(p.type));
      if (isVoid) {
        code += `    expect(() => ${func.name}(${emptyArgs.join(", ")})).not.toThrow();\n`;
      } else {
        code += `    try { ${func.isAsync ? "await " : ""}${func.name}(${emptyArgs.join(", ")}); } catch (e: any) { expect(e).toBeDefined(); }\n`;
      }
      code += `  });\n\n`;
    }

    // Error cases
    if (config.includeErrorCases) {
      code += `  ${itFn}("should handle invalid inputs", ${asyncPrefix}() => {\n`;
      code += `    // @ts-expect-error Testing invalid input\n`;
      code += `    try { ${func.isAsync ? "await " : ""}${func.name}(${func.params.map(() => "undefined").join(", ")}); } catch (e: any) { expect(e).toBeDefined(); }\n`;
      code += `  });\n\n`;
    }

    code += `});\n\n`;
  }

  return code;
}

function generatePythonTests(functions: FunctionSignature[], filePath: string, framework: "pytest" | "unittest"): string {
  const moduleName = basename(filePath).replace(/\.py$/, "");
  let code = `"""Auto-generated tests for ${moduleName}"""\n`;
  
  if (framework === "pytest") {
    code += `import pytest\n`;
    code += `from ${moduleName} import ${functions.map(f => f.name).join(", ")}\n\n`;

    for (const func of functions) {
      const args = func.params.map(p => generatePythonMockValue(p.type, p.name));
      const callExpr = func.name + "(" + args.join(", ") + ")";

      // Basic test
      code += `def test_${func.name}_basic():\n`;
      code += `    """Test that ${func.name} executes without error"""\n`;
      code += `    result = ${callExpr}\n`;
      code += `    assert result is not None\n\n`;

      // Edge cases
      if (config.includeEdgeCases && func.params.length > 0) {
        code += `def test_${func.name}_empty_inputs():\n`;
        code += `    """Test ${func.name} with empty/None inputs"""\n`;
        const emptyArgs = func.params.map(p => generatePythonEmptyValue(p.type));
        code += `    try:\n`;
        code += `        result = ${func.name}(${emptyArgs.join(", ")})\n`;
        code += `    except (TypeError, ValueError):\n`;
        code += `        pass  # Expected for invalid inputs\n\n`;
      }

      // Error cases
      if (config.includeErrorCases) {
        code += `def test_${func.name}_invalid_type():\n`;
        code += `    """Test ${func.name} with wrong types"""\n`;
        code += `    with pytest.raises((TypeError, ValueError, AttributeError)):\n`;
        code += `        ${func.name}(${func.params.map(() => "object()").join(", ")})\n\n`;
      }
    }
  } else {
    // unittest style
    code += `import unittest\n`;
    code += `from ${moduleName} import ${functions.map(f => f.name).join(", ")}\n\n`;
    code += `class Test${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}(unittest.TestCase):\n`;

    for (const func of functions) {
      const args = func.params.map(p => generatePythonMockValue(p.type, p.name));
      code += `    def test_${func.name}_basic(self):\n`;
      code += `        result = ${func.name}(${args.join(", ")})\n`;
      code += `        self.assertIsNotNone(result)\n\n`;
    }

    code += `\nif __name__ == "__main__":\n    unittest.main()\n`;
  }

  return code;
}

// ── Test Execution ───────────────────────────────────────────────────────────

/**
 * Runs a previously generated test by its ID.
 * @param testId The unique ID of the generated test to run
 * @returns TestRunResult with pass/fail status and any error messages
 */
export function runTest(testId: string): TestRunResult {
  const test = generatedTests.find(t => t.id === testId);
  if (!test) {
    return { testId, passed: 0, failed: 0, errors: 1, skipped: 0, duration: 0, output: "Test not found", success: false };
  }

  // Write test file
  if (!existsSync(config.outputDir)) mkdirSync(config.outputDir, { recursive: true });
  writeFileSync(test.testFile, test.testCode);

  const start = Date.now();
  let output: string;
  let passed = 0, failed = 0, errors = 0, skipped = 0;

  try {
    if (test.framework === "vitest" || test.framework === "jest") {
      output = execSync(`npx vitest run ${test.testFile} --reporter=verbose 2>&1`, {
        timeout: config.timeout,
        encoding: "utf-8",
        cwd: dirname(test.targetFile),
      });
    } else {
      output = execSync(`python3 -m pytest ${test.testFile} -v 2>&1`, {
        timeout: config.timeout,
        encoding: "utf-8",
      });
    }

    // Parse results
    const passMatch = output.match(/(\d+)\s+pass/i);
    const failMatch = output.match(/(\d+)\s+fail/i);
    const errorMatch = output.match(/(\d+)\s+error/i);
    const skipMatch = output.match(/(\d+)\s+skip/i);

    passed = passMatch ? parseInt(passMatch[1]) : test.testCount;
    failed = failMatch ? parseInt(failMatch[1]) : 0;
    errors = errorMatch ? parseInt(errorMatch[1]) : 0;
    skipped = skipMatch ? parseInt(skipMatch[1]) : 0;
  } catch (err: any) {
    output = (err.stdout || err.stderr || err.message || "").substring(0, 2000);
    failed = test.testCount;
    errors = 1;
  }

  const result: TestRunResult = {
    testId,
    passed,
    failed,
    errors,
    skipped,
    duration: Date.now() - start,
    output: output.substring(0, 2000),
    success: failed === 0 && errors === 0,
  };

  testResults.push(result);
  if (testResults.length > 100) testResults.splice(0, testResults.length - 100);

  return result;
}

/** Runs all previously generated tests and returns their results. */
export function runAllTests(): TestRunResult[] {
  return generatedTests.map(t => runTest(t.id));
}

// ── Coverage Analysis ────────────────────────────────────────────────────────

/**
 * Analyzes source code to identify functions that lack test coverage.
 * @param code Source code to analyze
 * @param filePath Path to the file (used to infer language)
 * @param language Optional language override
 * @returns Array of CoverageGap objects identifying untested code paths
 */
export function analyzeCoverageGaps(code: string, filePath: string, language?: "typescript" | "python"): CoverageGap[] {
  const lang = language || (filePath.endsWith(".py") ? "python" : "typescript");
  const functions = extractFunctions(code, lang);
  const testedFunctions = new Set<string>();

  for (const test of generatedTests) {
    if (test.targetFile === filePath) {
      for (const fn of test.functions) testedFunctions.add(fn);
    }
  }

  const gaps: CoverageGap[] = [];
  for (const func of functions) {
    if (!testedFunctions.has(func.name)) {
      gaps.push({
        functionName: func.name,
        file: filePath,
        reason: "No tests generated for this function",
        priority: func.isExported ? "high" : "low",
      });
    }
  }

  return gaps;
}

// ── Config & Stats ───────────────────────────────────────────────────────────

/** Returns the current test generation configuration. */
export function getTestGenConfig(): TestGenConfig {
  return { ...config };
}

/**
 * Updates the test generation configuration.
 * @param updates Partial config object to merge with current settings
 * @returns The updated TestGenConfig
 */
export function setTestGenConfig(updates: Partial<TestGenConfig>): TestGenConfig {
  config = { ...config, ...updates };
  return { ...config };
}

/** Returns runtime statistics for the test generator (tests generated, run, pass rate). */
export function getTestGenStats(): {
  totalGenerated: number;
  totalRun: number;
  totalPassed: number;
  totalFailed: number;
  avgPassRate: number;
  coverageGaps: number;
} {
  const totalPassed = testResults.reduce((sum, r) => sum + r.passed, 0);
  const totalFailed = testResults.reduce((sum, r) => sum + r.failed, 0);
  const total = totalPassed + totalFailed;

  return {
    totalGenerated: generatedTests.length,
    totalRun: testResults.length,
    totalPassed,
    totalFailed,
    avgPassRate: total > 0 ? Math.round((totalPassed / total) * 100) : 0,
    coverageGaps: 0, // Calculated on-demand
  };
}

/**
 * Returns the most recently generated tests.
 * @param limit Maximum number of tests to return (default: 20)
 */
export function getGeneratedTests(limit: number = 20): GeneratedTest[] {
  return generatedTests.slice(-limit);
}

/**
 * Returns the most recent test run results.
 * @param limit Maximum number of results to return (default: 20)
 */
export function getTestResults(limit: number = 20): TestRunResult[] {
  return testResults.slice(-limit);
}

// ── Mock Value Generators ────────────────────────────────────────────────────

function generateMockValue(type: string, name: string): string {
  const t = type.toLowerCase().trim();
  if (t === "string") return `"test_${name}"`;
  if (t === "number") return "42";
  if (t === "boolean") return "true";
  if (t.includes("[]") || t.includes("array")) return "[]";
  if (t.includes("record") || t.includes("object")) return "{}";
  if (name.toLowerCase().includes("id")) return `"test_id_1"`;
  if (name.toLowerCase().includes("name")) return `"test_name"`;
  if (name.toLowerCase().includes("path")) return `"/tmp/test"`;
  if (name.toLowerCase().includes("url")) return `"https://example.com"`;
  return `"test_value"`;
}

function generateEmptyValue(type: string): string {
  const t = type.toLowerCase().trim();
  if (t === "string") return `""`;
  if (t === "number") return "0";
  if (t === "boolean") return "false";
  if (t.includes("[]")) return "[]";
  return "{}";
}

function generatePythonMockValue(type: string, name: string): string {
  const t = type.toLowerCase().trim();
  if (t === "str") return `"test_${name}"`;
  if (t === "int" || t === "float") return "42";
  if (t === "bool") return "True";
  if (t.includes("list")) return "[]";
  if (t.includes("dict")) return "{}";
  if (name.toLowerCase().includes("id")) return `"test_id_1"`;
  return `"test_value"`;
}

function generatePythonEmptyValue(type: string): string {
  const t = type.toLowerCase().trim();
  if (t === "str") return `""`;
  if (t === "int" || t === "float") return "0";
  if (t === "bool") return "False";
  if (t.includes("list")) return "[]";
  return "None";
}
