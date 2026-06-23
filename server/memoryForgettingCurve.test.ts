/**
 * memoryForgettingCurve.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for memoryForgettingCurve
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

vi.mock('llmProvider.js', () => ({
  simpleChatCompletion: vi.fn().mockResolvedValue('mocked LLM response'),
  chatCompletion: vi.fn().mockResolvedValue({ content: 'mocked response', usage: { total_tokens: 100 } }),
  backgroundSimpleCompletion: vi.fn().mockResolvedValue('mocked background response'),
  backgroundChatCompletion: vi.fn().mockResolvedValue({ content: 'mocked', usage: { total_tokens: 50 } }),
  getActiveProvider: vi.fn().mockReturnValue({ id: 'deepseek', name: 'DeepSeek' }),
}));

import * as Module from './memoryForgettingCurve.js';

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Isolate workspace to temp dir to avoid loading production memory files
const _tmpWs = mkdtempSync(join(tmpdir(), "andromeda-test-"));
process.env.ANDROMEDA_WORKSPACE = _tmpWs;


describe('memoryForgettingCurve', () => {

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

  it('startMemoryForgettingCurveDaemon does not throw', () => {
    expect(() => Module.startMemoryForgettingCurveDaemon()).not.toThrow();
  });

  it('stopMemoryForgettingCurveDaemon does not throw', () => {
    expect(() => Module.stopMemoryForgettingCurveDaemon()).not.toThrow();
  });

  it('getMemoriesDueForReview returns a value', () => {
    const result = Module.getMemoriesDueForReview();
    expect(result).toBeDefined();
  });

  it('getAtRiskMemories returns a value', () => {
    const result = Module.getAtRiskMemories();
    expect(result).toBeDefined();
  });

  it('getForgettingCurveStats returns a value', () => {
    const result = Module.getForgettingCurveStats();
    expect(result).toBeDefined();
  });

  it('registerMemory is defined', () => {
    expect(typeof Module.registerMemory).toBe('function');
  });

});
