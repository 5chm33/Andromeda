import { describe, it, expect, vi, beforeAll } from 'vitest';
import { mkdirSync } from 'fs';

const TEST_WORKSPACE = '/tmp/andromeda_test_' + Math.random().toString(36).slice(2);

beforeAll(() => {
  mkdirSync(TEST_WORKSPACE + '/data', { recursive: true });
  process.env.ANDROMEDA_WORKSPACE = TEST_WORKSPACE;
});

vi.mock('./llmProvider.js', () => ({
  setActiveProvider: vi.fn(),
  getActiveProvider: vi.fn().mockReturnValue({ id: 'deepseek', name: 'DeepSeek' }),
  backgroundSimpleCompletion: vi.fn().mockResolvedValue('// improved code here'),
  simpleChatCompletion: vi.fn().mockResolvedValue('// improved code here'),
  chatCompletion: vi.fn().mockResolvedValue({ content: '// improved code here' }),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue('export const x = 1;'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now(), size: 100, isFile: () => true }),
    promises: {
      readFile: vi.fn().mockResolvedValue('export const x = 1;'),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  },
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('export const x = 1;'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now(), size: 100, isFile: () => true }),
  appendFileSync: vi.fn(),
  mkdtempSync: vi.fn().mockReturnValue('/tmp/test-dir'),
}));

describe('selfImprove', () => {
  it('module loads without errors', async () => {
    const Module = await import('./selfImprove.js');
    expect(Module).toBeDefined();
  });

  it('analyzeAndPropose is defined', async () => {
    const Module = await import('./selfImprove.js');
    expect(typeof Module.analyzeAndPropose).toBe('function');
  });

  it('module has at least one export', async () => {
    const Module = await import('./selfImprove.js');
    const keys = Object.keys(Module).filter(k => k !== 'default');
    expect(keys.length).toBeGreaterThan(0);
  });
});
