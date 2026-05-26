/**
 * continuousImprover.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for continuousImprover
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

import * as Module from './continuousImprover.js';

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Isolate workspace to temp dir to avoid loading production memory files
const _tmpWs = mkdtempSync(join(tmpdir(), "andromeda-test-"));
process.env.ANDROMEDA_WORKSPACE = _tmpWs;


describe('continuousImprover', () => {

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

  it('startContinuousImprover does not throw', () => {
    expect(() => Module.startContinuousImprover()).not.toThrow();
  });

  it('stopContinuousImprover does not throw', () => {
    expect(() => Module.stopContinuousImprover()).not.toThrow();
  });

  it('getImproverStats returns a value', () => {
    const result = Module.getImproverStats();
    expect(result).toBeDefined();
  });

});
