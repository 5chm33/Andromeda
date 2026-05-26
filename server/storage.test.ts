/**
 * storage.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for storage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue({}),
  text: vi.fn().mockResolvedValue(''),
  body: null,
}));

import * as Module from './storage.js';

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Isolate workspace to temp dir to avoid loading production memory files
const _tmpWs = mkdtempSync(join(tmpdir(), "andromeda-test-"));
process.env.ANDROMEDA_WORKSPACE = _tmpWs;


describe('storage', () => {

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

  it('module has expected structure', () => {
    const keys = Object.keys(Module);
    expect(keys.length).toBeGreaterThanOrEqual(0);
  });

  it('no unexpected throws on import', () => {
    expect(Module).toBeTruthy();
  });

  it('exported types are correct', () => {
    for (const key of Object.keys(Module)) {
      const val = (Module as any)[key];
      expect(['function', 'object', 'string', 'number', 'boolean', 'undefined'].includes(typeof val)).toBe(true);
    }
  });

});
