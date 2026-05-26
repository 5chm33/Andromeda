/**
 * routes/autonomyRoutes.test.ts — Andromeda v6.20
 * Tests for routes/autonomyRoutes
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

describe('autonomyRoutes', () => {
  it('module loads without throwing', async () => {
    await expect(import('./autonomyRoutes.js')).resolves.toBeDefined();
  });

  it('registerAutonomyRoutes registers routes on app', async () => {
    const mod = await import('./autonomyRoutes.js');
    expect(mod.registerAutonomyRoutes).toBeDefined();
    const app = createMockApp();
    expect(() => mod.registerAutonomyRoutes(app as any)).not.toThrow();
  });

  it('exported functions are callable', async () => {
    const mod = await import('./autonomyRoutes.js');
    const fns = Object.values(mod).filter(v => typeof v === 'function');
    expect(fns.length).toBeGreaterThan(0);
  });
});
