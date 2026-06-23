/**
 * vitest.setup.ts — Global test setup for Andromeda
 *
 * Mocks native Node addons that require compiled binaries unavailable in CI:
 *   - canvas       (requires libcairo)
 *   - better-sqlite3 (requires compiled better_sqlite3.node)
 *   - @lydell/node-pty (requires compiled pty.node)
 *
 * This file runs before any test suite via vitest.config.ts `setupFiles`.
 * Individual test files may override these mocks with vi.mock() locally.
 */
import { vi } from "vitest";

// ─── canvas mock ─────────────────────────────────────────────────────────────
vi.mock("canvas", () => {
  const mockCtx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 100 })),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    clearRect: vi.fn(),
    createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    putImageData: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    font: "10px sans-serif",
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    globalAlpha: 1,
  };
  const mockCanvas = {
    getContext: vi.fn(() => mockCtx),
    toBuffer: vi.fn((_fmt: string) => Buffer.from("fake-png-data")),
    toDataURL: vi.fn(() => "data:image/png;base64,ZmFrZQ=="),
    width: 800,
    height: 600,
  };
  return {
    createCanvas: vi.fn((_w: number, _h: number) => mockCanvas),
    loadImage: vi.fn(async (src: string) => ({ width: 800, height: 600, src })),
    registerFont: vi.fn(),
    Canvas: vi.fn(() => mockCanvas),
    Image: vi.fn(() => ({ width: 0, height: 0, src: "" })),
  };
});

// ─── better-sqlite3 mock ─────────────────────────────────────────────────────
// Provides a full in-memory stub so tests that import andromedaDb.ts (or any
// module that transitively imports it) never try to load the native .node file.
vi.mock("better-sqlite3", () => {
  // Minimal statement stub
  const makeStmt = (rows: unknown[] = []) => ({
    run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
    get: vi.fn(() => rows[0] ?? undefined),
    all: vi.fn(() => rows),
    iterate: vi.fn(function* () { yield* rows; }),
    pluck: vi.fn(function(this: unknown) { return this; }),
    expand: vi.fn(function(this: unknown) { return this; }),
    raw: vi.fn(function(this: unknown) { return this; }),
    columns: vi.fn(() => []),
    bind: vi.fn(function(this: unknown) { return this; }),
  });

  // In-memory KV store so get/set work correctly within a single test
  const _store: Record<string, unknown> = {};

  const mockDb = {
    prepare: vi.fn((sql: string) => {
      // Return a statement that reads/writes the in-memory store for kv_store ops
      const stmt = makeStmt();
      if (/INSERT.*kv_store/i.test(sql) || /UPDATE.*kv_store/i.test(sql)) {
        stmt.run = vi.fn((key: string, value: string) => {
          _store[key] = value;
          return { changes: 1, lastInsertRowid: 1 };
        });
      } else if (/SELECT.*kv_store.*WHERE.*key/i.test(sql)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (stmt as any).get = vi.fn((key: string) =>
          _store[key] !== undefined ? { value: _store[key] } : undefined
        );
      } else if (/SELECT.*kv_store/i.test(sql)) {
        stmt.all = vi.fn(() =>
          Object.entries(_store).map(([key, value]) => ({ key, value }))
        );
      }
      return stmt;
    }),
    exec: vi.fn(),
    pragma: vi.fn(() => []),
    close: vi.fn(),
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
    backup: vi.fn(),
    serialize: vi.fn(() => Buffer.alloc(0)),
    loadExtension: vi.fn(),
    defaultSafeIntegers: vi.fn(),
    unsafeMode: vi.fn(),
    open: true,
    inTransaction: false,
    readonly: false,
    name: ":memory:",
    memory: true,
  };

  // Default export is the Database constructor
  const DatabaseMock = vi.fn(() => mockDb);
  (DatabaseMock as unknown as Record<string, unknown>).default = DatabaseMock;
  return { default: DatabaseMock };
});

// ─── @lydell/node-pty mock ────────────────────────────────────────────────────
vi.mock("@lydell/node-pty", () => {
  const mockPty = {
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
    process: "bash",
  };
  return {
    spawn: vi.fn(() => mockPty),
    default: { spawn: vi.fn(() => mockPty) },
  };
});
