/**
 * multiFileProposalPlanner.test.ts — Andromeda v9.6.0
 * Tests for multi-file atomic proposal planning
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue('{"proposals":[]}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    statSync: vi.fn().mockReturnValue({ size: 100, isFile: () => true }),
  },
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('{"proposals":[]}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ size: 100, isFile: () => true }),
}));

vi.mock('./llmProvider.js', () => ({
  simpleChatCompletion: vi.fn().mockResolvedValue(JSON.stringify({
    title: 'Test multi-file proposal',
    rationale: 'Test rationale',
    primaryFile: 'ai.ts',
    primaryOriginalSnippet: 'old code',
    primaryProposedSnippet: 'new code',
    secondaryChanges: [],
    confidence: 0.8,
    impact: 'medium',
    category: 'refactor',
  })),
  backgroundSimpleCompletion: vi.fn().mockResolvedValue('mocked response'),
}));

describe('multiFileProposalPlanner', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('module loads without error', async () => {
    const mod = await import('./multiFileProposalPlanner.js');
    expect(mod).toBeDefined();
  });

  it('exports planMultiFileProposal function', async () => {
    const mod = await import('./multiFileProposalPlanner.js');
    expect(typeof mod.planMultiFileProposal).toBe('function');
  });

  it('exports runMultiFilePlanningCycle function', async () => {
    const mod = await import('./multiFileProposalPlanner.js');
    expect(typeof mod.runMultiFilePlanningCycle).toBe('function');
  });
});
