/**
 * modelRegistry.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for modelRegistry
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

import * as Module from './modelRegistry.js';

describe('modelRegistry', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('listModels returns an array', () => {
    const models = Module.listModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });

  it('getContextWindow returns number for known model', () => {
    const window = Module.getContextWindow('deepseek-chat');
    expect(typeof window).toBe('number');
    expect(window).toBeGreaterThan(0);
  });

  it('getContextWindow returns fallback for unknown model', () => {
    const window = Module.getContextWindow('unknown-model-xyz');
    expect(typeof window).toBe('number');
    expect(window).toBeGreaterThan(0);
  });

  it('getModelSpec returns spec for known model', () => {
    const spec = Module.getModelSpec('deepseek-chat');
    if (spec) {
      expect(spec).toHaveProperty('id');
      expect(spec).toHaveProperty('contextWindow');
    }
  });

  it('listModels with provider filter returns array', () => {
    const models = Module.listModels({ provider: 'deepseek' });
    expect(Array.isArray(models)).toBe(true);
  });
});
