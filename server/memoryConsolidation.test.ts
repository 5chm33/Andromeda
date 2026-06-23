/**
 * memoryConsolidation.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for memoryConsolidation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as Module from './memoryConsolidation.js';

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Isolate workspace to temp dir to avoid loading production memory files
const _tmpWs = mkdtempSync(join(tmpdir(), "andromeda-test-"));
process.env.ANDROMEDA_WORKSPACE = _tmpWs;


describe('memoryConsolidation', () => {

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

  it('startConsolidation does not throw', () => {
    expect(() => Module.startConsolidation()).not.toThrow();
  });

  it('stopConsolidation does not throw', () => {
    expect(() => Module.stopConsolidation()).not.toThrow();
  });

  it('getConsolidationConfig returns a value', () => {
    const result = Module.getConsolidationConfig();
    expect(result).toBeDefined();
  });

  it('getConsolidationStats returns a value', () => {
    const result = Module.getConsolidationStats();
    expect(result).toBeDefined();
  });

  it('getScoredMemories returns a value', () => {
    const result = Module.getScoredMemories();
    expect(result).toBeDefined();
  });

});
