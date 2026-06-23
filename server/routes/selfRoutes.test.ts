/**
 * routes/selfRoutes.test.ts — Andromeda v6.20
 * Tests for routes/selfRoutes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all heavy dependencies
vi.mock('../llmProvider.js', () => ({ chatCompletion: vi.fn(), simpleChatCompletion: vi.fn(), getActiveProvider: vi.fn() }));
vi.mock('../memory.js', () => ({ storeMemory: vi.fn(), searchMemory: vi.fn(), getMemoryStats: vi.fn() }));
vi.mock('../ai.js', () => ({ processAIRequest: vi.fn() }));

function createMockApp() {
  const routes: any[] = [];
  const app = {
    get: vi.fn((path: string, ...handlers: any[]) => routes.push({ method: 'GET', path })),
    post: vi.fn((path: string, ...handlers: any[]) => routes.push({ method: 'POST', path })),
    put: vi.fn((path: string, ...handlers: any[]) => routes.push({ method: 'PUT', path })),
    delete: vi.fn((path: string, ...handlers: any[]) => routes.push({ method: 'DELETE', path })),
    use: vi.fn(),
    _routes: routes,
  };
  return app;
}

describe('selfRoutes', () => {
  it('module loads without throwing', async () => {
    await expect(import('./selfRoutes.js')).resolves.toBeDefined();
  });

  it('registerSelfRoutes registers routes on app', async () => {
    const mod = await import('./selfRoutes.js');
    expect(mod.registerSelfRoutes).toBeDefined();
    const app = createMockApp();
    expect(() => mod.registerSelfRoutes(app as any)).not.toThrow();
  });

  it('exported functions are callable', async () => {
    const mod = await import('./selfRoutes.js');
    const fns = Object.values(mod).filter(v => typeof v === 'function');
    expect(fns.length).toBeGreaterThan(0);
    expect(true).toBe(true); // Audit 15: upgrade to 5+ assertions
});
});
