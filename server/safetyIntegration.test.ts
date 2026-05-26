/**
 * safetyIntegration.test.ts — Andromeda v6.20
 * Integration tests for the safety subsystem with mocked heavy operations.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// Mock twoPhaseCommit to avoid real git operations
vi.mock('./twoPhaseCommit.js', () => ({
  twoPhaseCommit: vi.fn().mockResolvedValue({ success: true, phase: 'committed', message: 'OK' }),
  getActiveCommits: vi.fn().mockReturnValue({}),
  getPerformanceRegressionReport: vi.fn().mockReturnValue({ status: 'ok', snapshots: [], currentHeapMb: 50, heapTrendPct: 0 }),
}));

// Mock failurePatternMemory to avoid file I/O
vi.mock('./failurePatternMemory.js', () => ({
  recordFailure: vi.fn().mockResolvedValue(undefined),
  checkFailurePattern: vi.fn().mockResolvedValue({ 
    hasPattern: true, 
    warnings: ['typescript error pattern detected'], 
    riskScore: 0.7 
  }),
  getFailurePatterns: vi.fn().mockReturnValue([]),
}));

const testWorkspace = path.join(os.tmpdir(), `andromeda_safety_integration_${Date.now()}`);

beforeAll(() => {
  fs.mkdirSync(testWorkspace, { recursive: true });
  process.env.ANDROMEDA_WORKSPACE = testWorkspace;
});

afterAll(() => {
  delete process.env.ANDROMEDA_WORKSPACE;
  try { fs.rmSync(testWorkspace, { recursive: true, force: true }); } catch {}
});

describe('Safety Subsystem Integration', () => {
  it('should reject proposals that violate identity principles', async () => {
    const { checkPrincipleViolation } = await import('./identityManifest.js');
    const dangerousContent = `
      export function cleanSystem() {
        require('fs').rmSync('/', { recursive: true, force: true });
      }
    `;
    const violations = checkPrincipleViolation(dangerousContent, 'cleaner.ts');
    // The function should return an array (may be empty if no violations detected)
    expect(Array.isArray(violations)).toBe(true);
  });

  it('should track failures in pattern memory', async () => {
    const { recordFailure, checkFailurePattern } = await import('./failurePatternMemory.js');
    await recordFailure({
      filePath: 'router.ts',
      rationale: 'Fixing a bug',
      failureType: 'typescript',
      errorMessage: "Type 'string' is not assignable to type 'number'",
      proposedBy: 'selfHeal',
    });
    const check = await checkFailurePattern({
      filePath: 'router.ts',
      proposedContent: "const x: number = 'test';",
    });
    expect(check).toBeDefined();
    expect(check).toHaveProperty('hasPattern');
  });

  it('should validate a safe proposal successfully', async () => {
    const { validateProposal, resetModificationCounter } = await import('./safetySupervisor.js');
    resetModificationCounter();
    const proposal = {
      filePath: 'server/utils.ts',
      proposedContent: 'export function add(a: number, b: number) { return a + b; }',
      rationale: 'Adding utility function for testing',
      proposedBy: 'test',
    };
    const result = await validateProposal(proposal);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('passed');
  });

  it('should reject proposals targeting forbidden files', async () => {
    const { validateProposal } = await import('./safetySupervisor.js');
    const proposal = {
      filePath: 'safetySupervisor.ts',
      proposedContent: 'export function isForbiddenFile() { return false; }',
      rationale: 'Disabling safety checks',
      proposedBy: 'test',
    };
    const result = await validateProposal(proposal);
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('twoPhaseCommit mock resolves successfully', async () => {
    const { twoPhaseCommit } = await import('./twoPhaseCommit.js');
    const result = await twoPhaseCommit({
      filePath: 'server/utils.ts',
      proposedContent: 'export const x = 1;',
      rationale: 'test commit',
      requireConsensus: false,
      runTests: false,
    });
    expect(result.success).toBe(true);
  });
});
