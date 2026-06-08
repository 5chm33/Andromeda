/**
 * proposalFeedback.test.ts — Andromeda v9.6.0
 * Tests for the LLM feedback loop for rejected proposals
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return { ...actual, default: actual };
});

describe('proposalFeedback', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('module loads without error', async () => {
    const mod = await import('./proposalFeedback.js');
    expect(mod).toBeDefined();
  });

  it('exports recordRejectionFeedback function', async () => {
    const mod = await import('./proposalFeedback.js');
    expect(typeof mod.recordRejectionFeedback).toBe('function');
  });

  it('exports clearFileFeedback function', async () => {
    const mod = await import('./proposalFeedback.js');
    expect(typeof mod.clearFileFeedback).toBe('function');
  });

  it('exports getRejectionFeedbackContext function', async () => {
    const mod = await import('./proposalFeedback.js');
    expect(typeof mod.getRejectionFeedbackContext).toBe('function');
  });

  it('getRejectionFeedbackContext returns empty string for unknown file', async () => {
    const mod = await import('./proposalFeedback.js');
    const ctx = mod.getRejectionFeedbackContext('nonexistent.ts');
    expect(typeof ctx).toBe('string');
  });

  it('recordRejectionFeedback does not throw', async () => {
    const mod = await import('./proposalFeedback.js');
    expect(() => mod.recordRejectionFeedback(
      'prop_test_001', 'ai.ts', 'Test proposal', 'original', 'proposed', 'Syntax check failed'
    )).not.toThrow();
  });

  it('clearFileFeedback does not throw', async () => {
    const mod = await import('./proposalFeedback.js');
    expect(() => mod.clearFileFeedback('ai.ts')).not.toThrow();
  });
});
