/**
 * apiIntegrationTester.ts — v53.0.0
 *
 * Automated integration testing for API endpoints: test case management,
 * assertion evaluation, and test suite reporting.
 */

export interface ApiTestCase {
  testId: string;
  name: string;
  apiId: string;
  endpoint: string;
  method: string;
  requestBody?: unknown;
  expectedStatus: number;
  assertions: ApiAssertion[];
}

export interface ApiAssertion {
  field: string;    // dot-notation path or "$status"
  operator: "eq" | "neq" | "gt" | "lt" | "contains" | "exists";
  expected: unknown;
}

export interface TestResult {
  testId: string;
  name: string;
  passed: boolean;
  actualStatus?: number;
  failedAssertions: string[];
  durationMs: number;
  runAt: number;
}

export interface TestSuiteReport {
  suiteId: string;
  totalTests: number;
  passed: number;
  failed: number;
  passRate: number;
  results: TestResult[];
  runAt: number;
}

const testCases = new Map<string, ApiTestCase>();
let testCounter = 0;

export function registerTestCase(tc: Omit<ApiTestCase, "testId">): ApiTestCase {
  const testCase: ApiTestCase = { testId: `test-${++testCounter}`, ...tc };
  testCases.set(testCase.testId, testCase);
  return testCase;
}

export function runTestCase(testId: string, mockResponse?: { status: number; body: unknown }): TestResult {
  const tc = testCases.get(testId);
  if (!tc) throw new Error(`[IntegrationTester] Test "${testId}" not found`);

  const start = Date.now();
  const response = mockResponse ?? { status: tc.expectedStatus, body: {} };
  const failedAssertions: string[] = [];

  // Check status
  if (response.status !== tc.expectedStatus) {
    failedAssertions.push(`Expected status ${tc.expectedStatus}, got ${response.status}`);
  }

  // Evaluate assertions
  for (const assertion of tc.assertions) {
    const actual = assertion.field === "$status" ? response.status : getPath(response.body as Record<string, unknown>, assertion.field);
    if (!evaluate(actual, assertion.operator, assertion.expected)) {
      failedAssertions.push(`Assertion failed: ${assertion.field} ${assertion.operator} ${JSON.stringify(assertion.expected)} (got ${JSON.stringify(actual)})`);
    }
  }

  return {
    testId,
    name: tc.name,
    passed: failedAssertions.length === 0,
    actualStatus: response.status,
    failedAssertions,
    durationMs: Date.now() - start,
    runAt: Date.now(),
  };
}

export function runTestSuite(testIds: string[], mockResponses?: Map<string, { status: number; body: unknown }>): TestSuiteReport {
  const results = testIds.map(id => runTestCase(id, mockResponses?.get(id)));
  const passed = results.filter(r => r.passed).length;
  return {
    suiteId: `suite-${Date.now()}`,
    totalTests: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length > 0 ? passed / results.length : 0,
    results,
    runAt: Date.now(),
  };
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce((cur: unknown, key) => (cur as Record<string, unknown>)?.[key], obj);
}

function evaluate(actual: unknown, op: ApiAssertion["operator"], expected: unknown): boolean {
  switch (op) {
    case "eq": return actual === expected;
    case "neq": return actual !== expected;
    case "gt": return (actual as number) > (expected as number);
    case "lt": return (actual as number) < (expected as number);
    case "contains": return String(actual).includes(String(expected));
    case "exists": return actual !== undefined && actual !== null;
    default: return false;
  }
}

export function _resetIntegrationTesterForTest(): void {
  testCases.clear();
  testCounter = 0;
}
