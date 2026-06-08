/**
 * rlhfCollector.test.ts — Andromeda v9.6.0
 * Tests for the RLHF signal collection module
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{"signals":[]}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{"signals":[]}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

describe('rlhfCollector', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('module loads without error', async () => {
    const mod = await import('./rlhfCollector.js');
    expect(mod).toBeDefined();
  });

  it('exports recordSignal function', async () => {
    const mod = await import('./rlhfCollector.js');
    expect(typeof mod.recordSignal).toBe('function');
  });

  it('exports getSignals function', async () => {
    const mod = await import('./rlhfCollector.js');
    expect(typeof mod.getSignals).toBe('function');
  });

  it('recordSignal does not throw for thumbs_up', async () => {
    const mod = await import('./rlhfCollector.js');
    expect(() => mod.recordSignal({
      messageId: 'msg_001',
      conversationId: 'conv_001',
      signal: 'thumbs_up',
      responseText: 'Great response',
      timestamp: Date.now(),
    })).not.toThrow();
  });

  it('recordSignal does not throw for thumbs_down', async () => {
    const mod = await import('./rlhfCollector.js');
    expect(() => mod.recordSignal({
      messageId: 'msg_002',
      conversationId: 'conv_001',
      signal: 'thumbs_down',
      responseText: 'Poor response',
      timestamp: Date.now(),
    })).not.toThrow();
  });

  it('getSignals returns an array', async () => {
    const mod = await import('./rlhfCollector.js');
    const signals = mod.getSignals();
    expect(Array.isArray(signals)).toBe(true);
  });
});
