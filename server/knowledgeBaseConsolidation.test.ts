/**
 * knowledgeBaseConsolidation.test.ts — Andromeda v9.6.0
 * Tests for weekly LLM-driven knowledge base consolidation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{"learnings":[],"issues":[],"architectureDecisions":[]}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{"learnings":[],"issues":[],"architectureDecisions":[]}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('./llmProvider.js', () => ({
  simpleChatCompletion: vi.fn().mockResolvedValue(JSON.stringify({
    merged: [],
    removed: [],
    promoted: [],
    summary: 'No consolidation needed',
  })),
  backgroundSimpleCompletion: vi.fn().mockResolvedValue('mocked response'),
}));

describe('knowledgeBaseConsolidation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('module loads without error', async () => {
    const mod = await import('./knowledgeBaseConsolidation.js');
    expect(mod).toBeDefined();
  });

  it('exports runConsolidation function', async () => {
    const mod = await import('./knowledgeBaseConsolidation.js');
    expect(typeof mod.runConsolidation).toBe('function');
  });

  it('exports startConsolidationDaemon function', async () => {
    const mod = await import('./knowledgeBaseConsolidation.js');
    expect(typeof mod.startConsolidationDaemon).toBe('function');
  });

  it('runConsolidation returns result object', async () => {
    const mod = await import('./knowledgeBaseConsolidation.js');
    const result = await mod.runConsolidation();
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });
});
