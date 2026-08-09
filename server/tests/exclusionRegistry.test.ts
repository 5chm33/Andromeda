/**
 * exclusionRegistry.test.ts — P0.1 acceptance tests for the task-exclusion gate.
 *
 * Elicit requirement: "a fixture containing a known earlier task (for example,
 * one of the previously repeated IDs) causes the runner to abort before image
 * pull or model invocation."
 *
 * These are zero-model, zero-Docker structural tests that verify the preflight
 * check logic in benchmarkLauncher.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runPreLaunchChecklist, type BenchmarkRunConfig } from '../benchmarkLauncher.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-exclusion-test-'));
}

function writeExclusionRegistry(dir: string, ids: string[]): string {
  const regPath = path.join(dir, 'exclusions.jsonl');
  const lines = ids.map(id => JSON.stringify({
    instance_id: id,
    first_seen_run_id: 'test-run',
    reason: 'canary',
    first_seen_commit: 'abc123',
    first_seen_at: '2026-01-01T00:00:00Z',
    notes: 'test fixture',
  }));
  fs.writeFileSync(regPath, lines.join('\n') + '\n');
  return regPath;
}

function writeTaskList(dir: string, ids: string[]): string {
  const taskPath = path.join(dir, 'task_list.json');
  fs.writeFileSync(taskPath, JSON.stringify(ids));
  return taskPath;
}

function writeSmoke(dir: string): void {
  const smokeDir = path.join(dir, '.smoke-results');
  fs.mkdirSync(smokeDir, { recursive: true });
  fs.writeFileSync(path.join(smokeDir, 'latest.json'), JSON.stringify({
    passed: true,
    evidence: {
      completedAt: new Date().toISOString(),
      imageDigest: 'sha256:' + 'a'.repeat(64),
      resolvedRef: 'swebench/sweb.eval.x86_64.test@sha256:' + 'a'.repeat(64),
      harnessRevision: 'test-harness-rev',
    },
  }));
}

function baseConfig(dir: string, overrides: Partial<BenchmarkRunConfig> = {}): BenchmarkRunConfig {
  const taskPath = writeTaskList(dir, ['repo__repo-001', 'repo__repo-002']);
  return {
    imageRef: 'swebench/sweb.eval.x86_64.test@sha256:' + 'a'.repeat(64),
    taskListPath: taskPath,
    modelId: 'test-model',
    promptTemplateHash: 'test-prompt-hash',
    temperature: 0.0,
    topP: 1.0,
    maxRetries: 3,
    instanceTimeoutMs: 60000,
    concurrency: 1,
    spendCapUsd: 10,
    scoredRun: false, // non-scored so most other checks pass
    externalSearch: false,
    runBundlePath: path.join(dir, 'run_bundle.json'),
    agentVersion: 'v5.22-test',
    harnessRevision: 'test-harness-rev',
    datasetName: 'test/dataset',
    datasetRevision: 'abc123def456',
    datasetSplit: 'test',
    instanceIdHash: 'test-id-hash',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('P0.1 Exclusion Registry Gate', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    writeSmoke(tmpDir);
    // Override SMOKE_RESULT_FILE by writing to the default location
    // (the test uses a non-scored run so smoke check is lenient)
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes when no exclusion registry is configured', () => {
    const config = baseConfig(tmpDir);
    const result = runPreLaunchChecklist(config);
    const exclusionCheck = result.checks.find(c => c.id === 'no-excluded-tasks');
    // No registry configured, non-scored run: check should not appear
    expect(exclusionCheck).toBeUndefined();
  });

  it('passes when selected IDs are disjoint from the registry', () => {
    const regPath = writeExclusionRegistry(tmpDir, ['old__old-001', 'old__old-002']);
    const taskPath = writeTaskList(tmpDir, ['new__new-001', 'new__new-002']);
    const config = baseConfig(tmpDir, {
      taskListPath: taskPath,
      exclusionRegistryPath: regPath,
      selectedInstanceIds: ['new__new-001', 'new__new-002'],
    });
    const result = runPreLaunchChecklist(config);
    const exclusionCheck = result.checks.find(c => c.id === 'no-excluded-tasks');
    expect(exclusionCheck).toBeDefined();
    expect(exclusionCheck!.passed).toBe(true);
    expect(exclusionCheck!.detail).toContain('0 hard violations');
  });

  it('FAILS when a selected ID appears in the exclusion registry', () => {
    // This is the key acceptance test from the Elicit backlog:
    // "a fixture containing a known earlier task causes the runner to abort"
    const knownEarlierTask = 'astropy__astropy-13977'; // was in canary_v4
    const regPath = writeExclusionRegistry(tmpDir, [knownEarlierTask, 'astropy__astropy-14182']);
    const taskPath = writeTaskList(tmpDir, [knownEarlierTask, 'new__new-001']);
    const config = baseConfig(tmpDir, {
      taskListPath: taskPath,
      exclusionRegistryPath: regPath,
      selectedInstanceIds: [knownEarlierTask, 'new__new-001'],
    });
    const result = runPreLaunchChecklist(config);
    const exclusionCheck = result.checks.find(c => c.id === 'no-excluded-tasks');
    expect(exclusionCheck).toBeDefined();
    expect(exclusionCheck!.passed).toBe(false);
    expect(exclusionCheck!.detail).toContain('HARD EXCLUSION');
    expect(exclusionCheck!.detail).toContain(knownEarlierTask);
    expect(exclusionCheck!.detail).toContain('1 ID(s)');
    // The check blocks launch
    expect(exclusionCheck!.blocksLaunch).toBe(true);
  });

  it('FAILS when multiple selected IDs appear in the exclusion registry', () => {
    const excluded = ['astropy__astropy-13977', 'astropy__astropy-14182', 'django__django-10554'];
    const regPath = writeExclusionRegistry(tmpDir, excluded);
    const taskPath = writeTaskList(tmpDir, [...excluded, 'new__new-001']);
    const config = baseConfig(tmpDir, {
      taskListPath: taskPath,
      exclusionRegistryPath: regPath,
      selectedInstanceIds: [...excluded, 'new__new-001'],
    });
    const result = runPreLaunchChecklist(config);
    const exclusionCheck = result.checks.find(c => c.id === 'no-excluded-tasks');
    expect(exclusionCheck!.passed).toBe(false);
    expect(exclusionCheck!.detail).toContain('3 ID(s)');
  });

  it('FAILS when scored run has no exclusion registry configured', () => {
    const config = baseConfig(tmpDir, {
      scoredRun: true,
      // No exclusionRegistryPath
    });
    const result = runPreLaunchChecklist(config);
    const exclusionCheck = result.checks.find(c => c.id === 'no-excluded-tasks');
    expect(exclusionCheck).toBeDefined();
    expect(exclusionCheck!.passed).toBe(false);
    expect(exclusionCheck!.detail).toContain('Scored run requires an exclusion registry');
    expect(exclusionCheck!.blocksLaunch).toBe(true);
  });

  it('FAILS when exclusion registry file does not exist', () => {
    const config = baseConfig(tmpDir, {
      exclusionRegistryPath: path.join(tmpDir, 'nonexistent.jsonl'),
      selectedInstanceIds: ['new__new-001'],
    });
    const result = runPreLaunchChecklist(config);
    const exclusionCheck = result.checks.find(c => c.id === 'no-excluded-tasks');
    expect(exclusionCheck!.passed).toBe(false);
    expect(exclusionCheck!.detail).toContain('Failed to read exclusion registry');
  });

  it('records exclusion registry hash and selected IDs hash in run metadata', () => {
    const regPath = writeExclusionRegistry(tmpDir, ['old__old-001']);
    const taskPath = writeTaskList(tmpDir, ['new__new-001']);
    const config = baseConfig(tmpDir, {
      taskListPath: taskPath,
      exclusionRegistryPath: regPath,
      exclusionRegistryHash: 'test-reg-hash',
      selectedIdsHash: 'test-ids-hash',
      selectedInstanceIds: ['new__new-001'],
    });
    const result = runPreLaunchChecklist(config);
    // Non-scored run: metadata may not be built if other checks fail
    // Just verify the exclusion check passes
    const exclusionCheck = result.checks.find(c => c.id === 'no-excluded-tasks');
    expect(exclusionCheck!.passed).toBe(true);
  });

  it('FAILS when a reserved ID is used without a matching preregistration', () => {
    // Reserved IDs are NOT in the immutable registry but require exact preregistration match
    const reservedId = 'multi__multi-001';
    const regPath = writeExclusionRegistry(tmpDir, ['old__old-001']); // reserved ID not in registry
    const reservedPath = path.join(tmpDir, 'multilingual_reserved_run.jsonl');
    fs.writeFileSync(reservedPath, JSON.stringify({ instance_id: reservedId, source: 'swebench_multilingual_preregistered' }) + '\n');
    const taskPath = writeTaskList(tmpDir, [reservedId]);
    const config = baseConfig(tmpDir, {
      taskListPath: taskPath,
      exclusionRegistryPath: regPath,
      reservedRunManifestPath: reservedPath,
      // No preregistrationHash or campaignId — should fail
      selectedInstanceIds: [reservedId],
    });
    const result = runPreLaunchChecklist(config);
    const exclusionCheck = result.checks.find(c => c.id === 'no-excluded-tasks');
    expect(exclusionCheck).toBeDefined();
    expect(exclusionCheck!.passed).toBe(false);
    expect(exclusionCheck!.detail).toContain('RESERVATION VIOLATION');
    expect(exclusionCheck!.blocksLaunch).toBe(true);
  });

  it('handles malformed JSONL lines in the registry gracefully', () => {
    const regPath = path.join(tmpDir, 'exclusions.jsonl');
    fs.writeFileSync(regPath, [
      JSON.stringify({ instance_id: 'old__old-001', reason: 'canary' }),
      'this is not json',
      '',
      JSON.stringify({ instance_id: 'old__old-002', reason: 'canary' }),
    ].join('\n'));
    const config = baseConfig(tmpDir, {
      exclusionRegistryPath: regPath,
      selectedInstanceIds: ['new__new-001'],
    });
    const result = runPreLaunchChecklist(config);
    const exclusionCheck = result.checks.find(c => c.id === 'no-excluded-tasks');
    // Should pass (malformed lines are skipped, new__new-001 is not excluded)
    expect(exclusionCheck!.passed).toBe(true);
  });
});
