import { describe, it, expect } from 'vitest';

describe('toolRegistry', () => {
  it('module loads without errors', async () => {
    const Module = await import('./toolRegistry.js');
    expect(Module).toBeDefined();
  });

  it('registerTool is a function', async () => {
    const { registerTool } = await import('./toolRegistry.js');
    expect(typeof registerTool).toBe('function');
  });

  it('getTool is a function', async () => {
    const { getTool } = await import('./toolRegistry.js');
    expect(typeof getTool).toBe('function');
  });

  it('getAllTools returns an array', async () => {
    const { getAllTools } = await import('./toolRegistry.js');
    const tools = getAllTools();
    expect(Array.isArray(tools)).toBe(true);
  });

  it('listToolNames returns an array of strings', async () => {
    const { listToolNames } = await import('./toolRegistry.js');
    const names = listToolNames();
    expect(Array.isArray(names)).toBe(true);
  });

  it('executeTool is a function', async () => {
    const { executeTool } = await import('./toolRegistry.js');
    expect(typeof executeTool).toBe('function');
  });
});
