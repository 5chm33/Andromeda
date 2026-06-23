/**
 * criticalPath.test.ts — Andromeda v6.20
 * Vitest-compatible version of critical path tests.
 * Uses isolated temp workspace to avoid loading production memory.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const testWorkspace = path.join(os.tmpdir(), `andromeda_critical_${Date.now()}`);

beforeAll(() => {
  fs.mkdirSync(testWorkspace, { recursive: true });
  process.env.ANDROMEDA_WORKSPACE = testWorkspace;
});

afterAll(() => {
  delete process.env.ANDROMEDA_WORKSPACE;
  try { fs.rmSync(testWorkspace, { recursive: true, force: true }); } catch {}
});

describe('memory module', () => {
  it('storeMemory returns a MemoryEntry object', async () => {
    const { storeMemory } = await import('./memory.js');
    const entry = storeMemory('TypeScript is a typed superset of JavaScript', 'fact', ['test']);
    expect(entry).toBeDefined();
    expect(typeof entry).toBe('object');
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('content');
  });

  it('searchMemory returns relevant results', async () => {
    const { storeMemory, searchMemory } = await import('./memory.js');
    storeMemory('Andromeda uses TF-IDF for semantic search', 'fact', { source: 'test' });
    storeMemory('The sky is blue on clear days', 'observation', { source: 'test' });
    const results = searchMemory('TF-IDF semantic search', 5);
    expect(results.length).toBeGreaterThan(0);
  });

  it('listMemories returns an array', async () => {
    const { listMemories } = await import('./memory.js');
    const memories = listMemories();
    expect(Array.isArray(memories)).toBe(true);
  });

  it('getMemoryStats returns stats object', async () => {
    const { getMemoryStats } = await import('./memory.js');
    const stats = getMemoryStats();
    expect(stats).toBeDefined();
    expect(typeof stats).toBe('object');
  });
});

describe('llmProvider module', () => {
  it('getActiveProvider returns a provider object', async () => {
    const { getActiveProvider } = await import('./llmProvider.js');
    const provider = getActiveProvider();
    expect(provider).toBeDefined();
    expect(provider).toHaveProperty('id');
  });

  it('listProviders returns an array of providers', async () => {
    const { listProviders } = await import('./llmProvider.js');
    const providers = listProviders();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
  });

  it('switchProvider does not throw for valid id', async () => {
    const { switchProvider, getActiveProvider } = await import('./llmProvider.js');
    // Save current provider
    const original = getActiveProvider();
    // Switch to deepseek (should not throw)
    expect(() => switchProvider('deepseek')).not.toThrow();
    // Restore
    expect(() => switchProvider(original.id)).not.toThrow();
  });
});

describe('twoPhaseCommit module', () => {
  it('getActiveCommits returns an object', async () => {
    const { getActiveCommits } = await import('./twoPhaseCommit.js');
    const commits = getActiveCommits();
    expect(commits).toBeDefined();
    expect(typeof commits).toBe('object');
  });

  it('getPerformanceRegressionReport returns a report', async () => {
    const { getPerformanceRegressionReport } = await import('./twoPhaseCommit.js');
    const report = getPerformanceRegressionReport();
    expect(report).toBeDefined();
    expect(report).toHaveProperty('status');
  });
});
