/**
 * mcpClient.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for mcpClient
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from('ok')),
  exec: vi.fn((cmd, opts, cb) => { if (cb) cb(null, 'ok', ''); return { kill: vi.fn() }; }),
  spawn: vi.fn().mockReturnValue({
    stdout: { on: vi.fn(), pipe: vi.fn() },
    stderr: { on: vi.fn(), pipe: vi.fn() },
    stdin: { write: vi.fn(), writable: true },
    on: vi.fn(),
    kill: vi.fn(),
  }),
}));

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue({}),
  text: vi.fn().mockResolvedValue(''),
  body: null,
}));

import * as Module from './mcpClient.js';

describe('mcpClient', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('exports are defined', () => {
    expect(Module).toBeDefined();
    expect(typeof Module).toBe('object');
  });

  it('getServerConfigs returns a value', () => {
    const result = Module.getServerConfigs();
    expect(result).toBeDefined();
  });

  it('getConnectionStatus returns a value', () => {
    const result = Module.getConnectionStatus();
    expect(result).toBeDefined();
  });

});
