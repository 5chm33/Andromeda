import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerAgent,
  subscribe,
  publish,
  setAgentStatus,
  getAgentStates,
  getMessageLog,
  resetBus,
  orchestrate,
} from './multiAgentBus.js';

beforeEach(() => resetBus());

describe('registerAgent', () => {
  it('registers an agent and it appears in getAgentStates', () => {
    registerAgent('planner');
    const states = getAgentStates();
    expect(states.some(s => s.role === 'planner')).toBe(true);
  });

  it('registered agent starts as idle', () => {
    registerAgent('coder');
    const state = getAgentStates().find(s => s.role === 'coder');
    expect(state?.status).toBe('idle');
  });
});

describe('publish / subscribe', () => {
  it('delivers a message to a subscribed agent', async () => {
    registerAgent('planner');
    registerAgent('coder');
    const received: string[] = [];
    subscribe('coder', (msg) => { received.push(msg.type); });
    await publish('planner', 'coder', 'task', { task: 'write tests' });
    expect(received).toContain('task');
  });

  it('broadcast delivers to all agents except sender', async () => {
    registerAgent('orchestrator');
    registerAgent('planner');
    registerAgent('coder');
    const received: string[] = [];
    subscribe('planner', (msg) => { received.push('planner'); });
    subscribe('coder', (msg) => { received.push('coder'); });
    await publish('orchestrator', 'broadcast', 'status', 'ready');
    expect(received).toContain('planner');
    expect(received).toContain('coder');
  });

  it('message appears in the log', async () => {
    registerAgent('reviewer');
    registerAgent('tester');
    await publish('reviewer', 'tester', 'approval', 'code looks good');
    const log = getMessageLog();
    expect(log.some(m => m.from === 'reviewer' && m.to === 'tester')).toBe(true);
  });
});

describe('setAgentStatus', () => {
  it('updates agent status', () => {
    registerAgent('tester');
    setAgentStatus('tester', 'busy');
    const state = getAgentStates().find(s => s.role === 'tester');
    expect(state?.status).toBe('busy');
  });

  it('increments tasksCompleted when set back to idle', () => {
    registerAgent('coder');
    setAgentStatus('coder', 'busy');
    setAgentStatus('coder', 'idle');
    const state = getAgentStates().find(s => s.role === 'coder');
    expect(state?.tasksCompleted).toBeGreaterThan(0);
  });
});

describe('orchestrate', () => {
  it('runs a full pipeline and returns success', async () => {
    const result = await orchestrate('Write a hello world function', {
      planner: async (task) => ['search', 'write_file'],
      coder: async (plan) => `function hello() { return "Hello World"; }`,
      reviewer: async (code) => ({ approved: true, feedback: 'LGTM' }),
      tester: async (code) => ({ passed: true, report: 'All tests pass' }),
    });
    expect(result.success).toBe(true);
    expect(result.result).toContain('Hello World');
  });

  it('returns failure when reviewer rejects', async () => {
    const result = await orchestrate('Write bad code', {
      planner: async () => ['write_file'],
      coder: async () => 'eval(input)',
      reviewer: async () => ({ approved: false, feedback: 'Security violation: eval detected' }),
      tester: async () => ({ passed: true, report: '' }),
    });
    expect(result.success).toBe(false);
    expect(result.result).toContain('Security violation');
  });

  it('returns failure when tester fails', async () => {
    const result = await orchestrate('Write broken code', {
      planner: async () => ['write_file'],
      coder: async () => 'function x() { throw new Error(); }',
      reviewer: async () => ({ approved: true, feedback: 'ok' }),
      tester: async () => ({ passed: false, report: '3 tests failed' }),
    });
    expect(result.success).toBe(false);
    expect(result.result).toContain('3 tests failed');
  });

  it('log contains messages from all agents', async () => {
    await orchestrate('Simple task', {
      planner: async () => ['search'],
      coder: async () => 'const x = 1;',
      reviewer: async () => ({ approved: true, feedback: 'ok' }),
      tester: async () => ({ passed: true, report: 'pass' }),
    });
    const log = getMessageLog();
    const roles = new Set(log.map(m => m.from));
    expect(roles.has('planner')).toBe(true);
    expect(roles.has('coder')).toBe(true);
    expect(roles.has('reviewer')).toBe(true);
  });
});
