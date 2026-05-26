/**
 * transactionLog.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for transactionLog
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue('{}'),
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
  },
  // Named exports (vitest requires both default and named)
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  mkdtempSync: vi.fn().mockReturnValue('/tmp/test-dir'),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now(), size: 100, isFile: () => true, isDirectory: () => false }),
  appendFileSync: vi.fn(),
  copyFileSync: vi.fn(),
  createWriteStream: vi.fn().mockReturnValue({ write: vi.fn(), end: vi.fn(), on: vi.fn() }),
}));

import * as Module from './transactionLog.js';

describe('transactionLog', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('beginTransaction returns a transaction ID', () => {
    const txnId = Module.beginTransaction('test transaction', ['file1.ts']);
    expect(typeof txnId).toBe('string');
    expect(txnId.length).toBeGreaterThan(0);
  });

  it('recordChange returns true for valid transaction', () => {
    const txnId = Module.beginTransaction('test', ['file.ts']);
    const result = Module.recordChange(txnId, 'file.ts', 'new content');
    expect(result).toBe(true);
  });

  it('recordChange returns false for invalid transaction', () => {
    const result = Module.recordChange('invalid-txn', 'file.ts', 'content');
    expect(result).toBe(false);
  });

  it('commitTransaction returns true for valid transaction', () => {
    const txnId = Module.beginTransaction('commit test', ['f.ts']);
    Module.recordChange(txnId, 'f.ts', 'content');
    const result = Module.commitTransaction(txnId);
    expect(result).toBe(true);
  });

  it('rollbackTransaction returns result object', () => {
    const txnId = Module.beginTransaction('rollback test', ['r.ts']);
    Module.recordChange(txnId, 'r.ts', 'content');
    const result = Module.rollbackTransaction(txnId);
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('filesRestored');
  });
});
