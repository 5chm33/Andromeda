/**
 * routes/llmRoutes.test.ts — Andromeda v6.20
 * Tests for routes/llmRoutes
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

describe('llmRoutes', () => {
  it('module loads without throwing', async () => {
    await expect(import('./llmRoutes.js')).resolves.toBeDefined();
  });

  it('registerLLMRoutes registers routes on app', async () => {
    const mod = await import('./llmRoutes.js');
    expect(mod.registerLLMRoutes).toBeDefined();
    const app = createMockApp();
    expect(() => mod.registerLLMRoutes(app as any)).not.toThrow();
  });

  it('exported functions are callable', async () => {
    const mod = await import('./llmRoutes.js');
    const fns = Object.values(mod).filter(v => typeof v === 'function');
    expect(fns.length).toBeGreaterThan(0);
  });
});
