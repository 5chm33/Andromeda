/**
 * dataTransformRegistry.ts — v69.0.0 "Data Pipeline"
 * Registry of reusable data transformations with composition and chaining.
 */
export type TransformFn = (data: unknown) => unknown;
export interface Transform { name: string; description: string; fn: TransformFn; }

const registry = new Map<string, Transform>();

export function registerTransform(name: string, description: string, fn: TransformFn): void { registry.set(name, { name, description, fn }); }
export function applyTransform(name: string, data: unknown): unknown {
  const t = registry.get(name);
  if (!t) throw new Error(`[TransformRegistry] Transform not found: ${name}`);
  return t.fn(data);
}
export function composeTransforms(names: string[]): TransformFn {
  return (data: unknown) => names.reduce((acc, name) => applyTransform(name, acc), data);
}
export function listTransforms(): string[] { return [...registry.keys()]; }
export function _resetDataTransformRegistryForTest(): void { registry.clear(); }
