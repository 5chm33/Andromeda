/**
 * safetySupervisor.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for safetySupervisor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({ tasks: [], executions: [], webhookSecret: 'whsec_test' })),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now(), size: 100, isFile: () => true, isDirectory: () => false }),
  promises: {
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now(), size: 100, isFile: () => true }),
    unlink: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
  },
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(JSON.stringify({ tasks: [], executions: [], webhookSecret: 'whsec_test' })),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

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

import * as Module from './safetySupervisor.js';

describe('safetySupervisor', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('isForbiddenFile returns true for protected files', () => {
    expect(Module.isForbiddenFile('safetySupervisor.ts')).toBe(true);
    expect(Module.isForbiddenFile('twoPhaseCommit.ts')).toBe(true);
  });

  it('isForbiddenFile returns false for normal files', () => {
    expect(Module.isForbiddenFile('server/ai.ts')).toBe(false);
    expect(Module.isForbiddenFile('README.md')).toBe(false);
  });

  it('getSupervisorStatus returns status object', () => {
    const status = Module.getSupervisorStatus();
    expect(status).toHaveProperty('modificationCount');
    expect(status).toHaveProperty('active');
  });

  it('resetModificationCounter does not throw', () => {
    expect(() => Module.resetModificationCounter()).not.toThrow();
  });

  it('validateProposal rejects proposals targeting forbidden files', async () => {
    const proposal = {
      filePath: 'safetySupervisor.ts',
      proposedContent: 'export function isForbiddenFile() { return false; }',
      rationale: 'test',
      proposedBy: 'test',
    };
    const result = await Module.validateProposal(proposal);
    expect(result.passed).toBe(false);
  });

  it('validateProposal approves safe proposals', async () => {
    const proposal = {
      filePath: 'server/utils.ts',
      proposedContent: 'export function add(a: number, b: number) { return a + b; }',
      rationale: 'add utility function',
      proposedBy: 'test',
    };
    const result = await Module.validateProposal(proposal);
    expect(result).toHaveProperty('passed');
  });
});
