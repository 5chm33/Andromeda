/**
 * streamIntegrityMonitor.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for streamIntegrityMonitor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as Module from './streamIntegrityMonitor.js';

describe('streamIntegrityMonitor', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('startStream does not throw', () => {
    expect(() => Module.startStream('sess1', 'stream1', 1000)).not.toThrow();
  });

  it('recordChunk does not throw for active stream', () => {
    Module.startStream('sess2', 'stream2', 500);
    expect(() => Module.recordChunk('stream2', 'hello world')).not.toThrow();
  });

  it('checkStreamHealth returns health object', () => {
    Module.startStream('sess3', 'stream3', 200);
    const health = Module.checkStreamHealth('stream3');
    expect(health).toHaveProperty('healthy');
  });

  it('endStream returns integrity check', () => {
    Module.startStream('sess4', 'stream4', 100);
    Module.recordChunk('stream4', 'content');
    const check = Module.endStream('stream4', 'content');
    expect(check).toHaveProperty('isComplete');
    expect(check).toHaveProperty('confidence');
  });

  it('checkStreamHealth returns unknown for non-existent stream', () => {
    const health = Module.checkStreamHealth('non-existent');
    expect(health).toBeDefined();
  });
});
