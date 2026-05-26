import { describe, it, expect } from 'vitest';

describe('chunked_writer', () => {
  it('module loads without errors', async () => {
    const Module = await import('./chunked_writer.js');
    expect(Module).toBeDefined();
  });

  it('beginWriteSession is exported and callable', async () => {
    const Module = await import('./chunked_writer.js');
    expect(Module.beginWriteSession).toBeDefined();
    expect(typeof Module.beginWriteSession).toBe('function');
  });

  it('writeChunk is exported and callable', async () => {
    const Module = await import('./chunked_writer.js');
    expect(Module.writeChunk).toBeDefined();
    expect(typeof Module.writeChunk).toBe('function');
  });

});