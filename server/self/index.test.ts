/**
 * self/index.test.ts — Andromeda v6.20
 */
import { describe, it, expect, vi } from 'vitest';

describe('index', () => {
  it('module loads without throwing', async () => {
    await expect(import('./index.js')).resolves.toBeDefined();
  });
});
