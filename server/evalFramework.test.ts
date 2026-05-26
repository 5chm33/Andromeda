/**
 * evalFramework.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for evalFramework
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

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue({}),
  text: vi.fn().mockResolvedValue(''),
  body: null,
}));

import * as Module from './evalFramework.js';

describe('evalFramework', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('EVAL_TASKS is an array of tasks', () => {
    expect(Array.isArray(Module.EVAL_TASKS)).toBe(true);
    expect(Module.EVAL_TASKS.length).toBeGreaterThan(0);
  });

  it('each eval task has required fields', () => {
    for (const task of Module.EVAL_TASKS) {
      expect(task).toHaveProperty('id');
      expect(task).toHaveProperty('prompt');
      expect(task).toHaveProperty('category');
    }
  });

  it('scoreResponse returns an EvalResult', () => {
    const task = Module.EVAL_TASKS[0];
    const result = Module.scoreResponse(task, 'test response', 100);
    expect(result).toHaveProperty('taskId');
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('score');
  });

  it('getEvalHistory returns array', () => {
    const history = Module.getEvalHistory();
    expect(Array.isArray(history)).toBe(true);
  });

  it('getEvalTrend returns array', () => {
    const trend = Module.getEvalTrend();
    expect(Array.isArray(trend)).toBe(true);
  });
});
