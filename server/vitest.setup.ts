/**
 * vitest.setup.ts — Global test setup for Andromeda
 *
 * Mocks native Node addons that require compiled binaries unavailable in CI.
 * This file runs before any test suite via vitest.config.ts `setupFiles`.
 */
import { vi } from "vitest";

// Mock the `canvas` package (requires libcairo native binary, not available in CI).
// Tests that need real canvas functionality should override this mock locally.
vi.mock("canvas", () => {
  const mockCanvas = {
    getContext: vi.fn(() => ({
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
    })),
    toBuffer: vi.fn((_format: string) => Buffer.from("fake-png-data")),
    toDataURL: vi.fn(() => "data:image/png;base64,ZmFrZQ=="),
    width: 800,
    height: 600,
  };

  return {
    createCanvas: vi.fn((_width: number, _height: number) => mockCanvas),
    loadImage: vi.fn(async (_src: string) => ({
      width: 800,
      height: 600,
      src: _src,
    })),
    registerFont: vi.fn(),
    Canvas: vi.fn(() => mockCanvas),
    Image: vi.fn(() => ({ width: 0, height: 0, src: "" })),
  };
});
