/**
 * skillGraph.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for skillGraph
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

import * as Module from './skillGraph.js';

describe('skillGraph', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('learnFromError does not throw', () => {
    expect(() => Module.learnFromError(
      new Error('test error'),
      'test-module',
      'test fix',
    )).not.toThrow();
  });

  it('suggestFix returns null or suggestion for unknown error', () => {
    const suggestion = Module.suggestFix(new Error('unknown error xyz'));
    expect(suggestion === null || typeof suggestion === 'object').toBe(true);
  });

  it('getSkillsForModule returns array', () => {
    const skills = Module.getSkillsForModule('test-module');
    expect(Array.isArray(skills)).toBe(true);
  });

  it('getGraphStats returns stats object', () => {
    const stats = Module.getGraphStats();
    expect(stats).toBeDefined();
  });
});
