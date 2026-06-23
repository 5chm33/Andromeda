/**
 * multiFileProposalPlanner.test.ts — Andromeda v11.17.0 Audit 9
 * Real function-level tests for multiFileProposalPlanner.ts
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('./_core/llm.js', () => ({
  invokeLLM: vi.fn().mockResolvedValue(JSON.stringify({
    title: 'Test plan',
    rationale: 'Test rationale',
    steps: [{ file: 'server/a.ts', change: 'add x' }],
  })),
}));

import {
  findRelatedFiles,
  planMultiFileImprovement,
} from './multiFileProposalPlanner.js';

describe('multiFileProposalPlanner', () => {
  it('module loads without errors', async () => {
    await expect(import('./multiFileProposalPlanner.js')).resolves.toBeDefined();
  });

  it('findRelatedFiles returns an array', async () => {
    const result = await findRelatedFiles('server/selfImprove.ts');
    expect(Array.isArray(result)).toBe(true);
  });

  it('findRelatedFiles returns strings', async () => {
    const result = await findRelatedFiles('server/continuousImprover.ts');
    for (const f of result) {
      expect(typeof f).toBe('string');
    }
  });

  it('planMultiFileImprovement returns null or a plan object', async () => {
    const result = await planMultiFileImprovement('server/selfImprove.ts', []);
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('planMultiFileImprovement handles empty related files', async () => {
    await expect(planMultiFileImprovement('server/utils.ts', [])).resolves.toBeDefined();
  });

  it('exports submitMultiFileProposal as a function', async () => {
    const mod = await import('./multiFileProposalPlanner.js');
    expect(typeof mod.submitMultiFileProposal).toBe('function');
  });
});
