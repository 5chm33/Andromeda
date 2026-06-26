/**
 * apiChangeDetector.ts — v53.0.0
 *
 * Detects changes between API schema snapshots, classifying changes
 * as breaking, non-breaking, or additive.
 */

export type ChangeType = "breaking" | "non-breaking" | "additive";

export interface ApiChange {
  changeId: string;
  type: ChangeType;
  path: string;
  description: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface ChangeReport {
  apiId: string;
  fromSnapshot: string;
  toSnapshot: string;
  changes: ApiChange[];
  hasBreakingChanges: boolean;
  detectedAt: number;
}

let changeCounter = 0;

export function compareSchemas(
  apiId: string,
  oldSchema: Record<string, unknown>,
  newSchema: Record<string, unknown>,
  fromSnapshot = "v1",
  toSnapshot = "v2"
): ChangeReport {
  const changes: ApiChange[] = [];
  detectChanges(oldSchema, newSchema, "", changes);

  return {
    apiId,
    fromSnapshot,
    toSnapshot,
    changes,
    hasBreakingChanges: changes.some(c => c.type === "breaking"),
    detectedAt: Date.now(),
  };
}

function detectChanges(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  prefix: string,
  changes: ApiChange[]
): void {
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    if (!(key in oldObj)) {
      // Added field
      changes.push({ changeId: `chg-${++changeCounter}`, type: "additive", path, description: `Field "${path}" added`, newValue: newVal });
    } else if (!(key in newObj)) {
      // Removed field — breaking
      changes.push({ changeId: `chg-${++changeCounter}`, type: "breaking", path, description: `Field "${path}" removed`, oldValue: oldVal });
    } else if (typeof oldVal !== typeof newVal) {
      // Type changed — breaking
      changes.push({ changeId: `chg-${++changeCounter}`, type: "breaking", path, description: `Field "${path}" type changed from ${typeof oldVal} to ${typeof newVal}`, oldValue: oldVal, newValue: newVal });
    } else if (typeof oldVal === "object" && oldVal !== null && typeof newVal === "object" && newVal !== null) {
      detectChanges(oldVal as Record<string, unknown>, newVal as Record<string, unknown>, path, changes);
    } else if (oldVal !== newVal) {
      changes.push({ changeId: `chg-${++changeCounter}`, type: "non-breaking", path, description: `Field "${path}" value changed`, oldValue: oldVal, newValue: newVal });
    }
  }
}

export function _resetChangeDetectorForTest(): void {
  changeCounter = 0;
}
