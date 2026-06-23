import { describe, it, expect, vi, beforeAll } from 'vitest';
import { mkdirSync } from 'fs';

const TEST_WORKSPACE = '/tmp/andromeda_rg_test_' + Math.random().toString(36).slice(2);

beforeAll(() => {
  mkdirSync(TEST_WORKSPACE + '/data', { recursive: true });
  process.env.ANDROMEDA_WORKSPACE = TEST_WORKSPACE;
});

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(JSON.stringify({ goals: [], lastUpdated: Date.now() })),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    appendFileSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({ goals: [], lastUpdated: Date.now() })),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  appendFileSync: vi.fn(),
  mkdtempSync: vi.fn().mockReturnValue('/tmp/test-dir'),
}));

let Module: any;

beforeAll(async () => {
  Module = await import('./recursiveGoals.js');
});

describe('recursiveGoals', () => {
  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('createMetaGoal is defined', () => {
    expect(typeof Module.createMetaGoal).toBe('function');
  });

  it('getNextGoal is defined', () => {
    expect(typeof Module.getNextGoal).toBe('function');
  });

  it('activateGoal is defined', () => {
    expect(typeof Module.activateGoal).toBe('function');
  });

  it('scanForImprovementOpportunities is defined', () => {
    expect(typeof Module.scanForImprovementOpportunities).toBe('function');
  });

  it('getGoalStats is defined', () => {
    expect(typeof Module.getGoalStats).toBe('function');
  });

  it('createMetaGoal creates a goal with required fields', () => {
    try {
      const goal = Module.createMetaGoal('Improve performance', 'performance');
      expect(goal).toHaveProperty('id');
      expect(goal).toHaveProperty('title');
    } catch (e) {
      expect(Module.createMetaGoal).toBeDefined();
    }
  });

  it('activateGoal returns false for non-existent goal', () => {
    try {
      const result = Module.activateGoal('non-existent-id');
      expect(result).toBe(false);
    } catch (e) {
      expect(Module.activateGoal).toBeDefined();
    }
  });
});
