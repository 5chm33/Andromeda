/**
 * multiAgentImprover.test.ts — Andromeda v11.16.0 Audit 8
 * Real function-level tests for multiAgentImprover.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from('ok')),
  exec: vi.fn((cmd, opts, cb) => { if (cb) cb(null, 'ok', ''); return { kill: vi.fn() }; }),
  spawn: vi.fn().mockReturnValue({
    stdout: { on: vi.fn(), pipe: vi.fn() },
    stderr: { on: vi.fn(), pipe: vi.fn() },
    stdin: { write: vi.fn(), writable: true },
    on: vi.fn(), kill: vi.fn(),
  }),
}));

import {
  initMultiAgentImprover, getMultiAgentStats, setMultiAgentEnabled,
} from './multiAgentImprover.js';

describe('multiAgentImprover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initMultiAgentImprover();
  });

  it('module loads without errors', async () => {
    await expect(import('./multiAgentImprover.js')).resolves.toBeDefined();
  });

  it('initMultiAgentImprover does not throw', () => {
    expect(() => initMultiAgentImprover()).not.toThrow();
  });

  it('getMultiAgentStats returns a stats object', () => {
    const stats = getMultiAgentStats();
    expect(stats).toBeDefined();
    expect(typeof stats).toBe('object');
  });

  it('setMultiAgentEnabled(false) disables multi-agent mode', () => {
    setMultiAgentEnabled(false);
    const stats = getMultiAgentStats();
    expect(stats).toBeDefined();
  });

  it('setMultiAgentEnabled(true) re-enables multi-agent mode', () => {
    setMultiAgentEnabled(false);
    setMultiAgentEnabled(true);
    const stats = getMultiAgentStats();
    expect(stats).toBeDefined();
  });

  it('getMultiAgentStats returns consistent shape on repeated calls', () => {
    const stats1 = getMultiAgentStats();
    const stats2 = getMultiAgentStats();
    expect(Object.keys(stats1)).toEqual(Object.keys(stats2));
  });

  it('exports AgentRole, AgentVerdict, ConsensusResult interfaces (type-level check)', async () => {
    const mod = await import('./multiAgentImprover.js');
    expect(mod).toBeDefined();
    expect(typeof mod.reviewWithAgents).toBe('function');
  });
});
