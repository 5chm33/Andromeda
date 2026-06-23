import { describe, it, expect } from 'vitest';
import { mctsPlan, planFromGoal } from './mctsPlan.js';

const TOOLS = ['search', 'read_file', 'write_file', 'run_code', 'browse', 'summarize'];

describe('mctsPlan', () => {
  it('returns a MctsResult with required fields', () => {
    const result = mctsPlan('Fix the bug in auth.ts', TOOLS);
    expect(result).toHaveProperty('bestPath');
    expect(result).toHaveProperty('bestReward');
    expect(result).toHaveProperty('iterations');
    expect(result).toHaveProperty('tree');
  });

  it('bestPath contains only valid actions', () => {
    const result = mctsPlan('Write a test for vectorMemory', TOOLS);
    for (const action of result.bestPath) {
      expect(TOOLS).toContain(action);
    }
  });

  it('runs the specified number of iterations', () => {
    const result = mctsPlan('Deploy the server', TOOLS, { maxIterations: 50 });
    expect(result.iterations).toBe(50);
  });

  it('respects maxDepth — bestPath length <= maxDepth', () => {
    const result = mctsPlan('Refactor codebase', TOOLS, { maxDepth: 3, maxIterations: 100 });
    expect(result.bestPath.length).toBeLessThanOrEqual(3);
  });

  it('handles empty action list gracefully', () => {
    const result = mctsPlan('Do something', []);
    expect(result.bestPath).toEqual([]);
    expect(result.bestReward).toBe(0);
  });

  it('tree root has the goal as its action', () => {
    const result = mctsPlan('Test goal', TOOLS);
    expect(result.tree.action).toContain('Test goal');
  });

  it('bestReward is a non-negative number', () => {
    const result = mctsPlan('Improve performance', TOOLS);
    expect(result.bestReward).toBeGreaterThanOrEqual(0);
  });
});

describe('planFromGoal', () => {
  it('returns an array of action strings', () => {
    const plan = planFromGoal('Fix the login bug', TOOLS);
    expect(Array.isArray(plan)).toBe(true);
  });

  it('returns only actions from the available tools list', () => {
    const plan = planFromGoal('Search for relevant files', TOOLS);
    for (const action of plan) {
      expect(TOOLS).toContain(action);
    }
  });

  it('handles single-tool list', () => {
    const plan = planFromGoal('Do the task', ['search']);
    expect(plan.every(a => a === 'search')).toBe(true);
  });
});
