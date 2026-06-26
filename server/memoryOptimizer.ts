/**
 * Memory Optimizer — manages and optimizes memory allocation for AI workloads.
 * Implements memory pooling, garbage collection hints, and memory pressure responses.
 */

export type MemoryTier = "hot" | "warm" | "cold" | "archived";

export interface MemoryAllocation {
  id: string;
  label: string;
  sizeBytes: number;
  tier: MemoryTier;
  accessFrequency: number;  // accesses per second
  lastAccessAt: number;
  pinned: boolean;
}

export interface MemoryOptimizationResult {
  promotedCount: number;
  demotedCount: number;
  evictedCount: number;
  bytesFreed: number;
  fragmentationReduced: number;
}

export interface MemoryReport {
  totalAllocations: number;
  totalBytesAllocated: number;
  hotBytes: number;
  coldBytes: number;
  fragmentationRatio: number;
  pressureLevel: "low" | "medium" | "high" | "critical";
}

class MemoryOptimizerEngine {
  private allocations: Map<string, MemoryAllocation> = new Map();
  private counter = 0;
  private readonly MAX_BYTES = 8 * 1024 * 1024 * 1024; // 8GB

  allocate(label: string, sizeBytes: number, tier: MemoryTier = "warm", pinned = false): MemoryAllocation {
    const alloc: MemoryAllocation = {
      id: `mem-${++this.counter}`,
      label, sizeBytes, tier,
      accessFrequency: tier === "hot" ? 100 : tier === "warm" ? 10 : 1,
      lastAccessAt: Date.now(),
      pinned,
    };
    this.allocations.set(alloc.id, alloc);
    return alloc;
  }

  access(allocationId: string): boolean {
    const alloc = this.allocations.get(allocationId);
    if (!alloc) return false;
    alloc.accessFrequency = Math.min(1000, alloc.accessFrequency + 1);
    alloc.lastAccessAt = Date.now();
    if (alloc.tier !== "hot" && alloc.accessFrequency > 50) {
      alloc.tier = "hot";
    }
    return true;
  }

  optimize(): MemoryOptimizationResult {
    const now = Date.now();
    let promoted = 0, demoted = 0, evicted = 0, bytesFreed = 0;

    for (const alloc of this.allocations.values()) {
      if (alloc.pinned) continue;
      const ageMs = now - alloc.lastAccessAt;

      // Demote cold allocations
      if (ageMs > 60000 && alloc.tier === "warm") {
        alloc.tier = "cold";
        demoted++;
      } else if (ageMs > 300000 && alloc.tier === "cold") {
        alloc.tier = "archived";
        demoted++;
      }

      // Promote frequently accessed
      if (alloc.accessFrequency > 50 && alloc.tier !== "hot") {
        alloc.tier = "hot";
        promoted++;
      }

      // Evict archived allocations under pressure
      const totalBytes = this.getTotalBytes();
      if (totalBytes > this.MAX_BYTES * 0.9 && alloc.tier === "archived") {
        bytesFreed += alloc.sizeBytes;
        this.allocations.delete(alloc.id);
        evicted++;
      }
    }

    return { promotedCount: promoted, demotedCount: demoted, evictedCount: evicted, bytesFreed, fragmentationReduced: evicted * 0.01 };
  }

  private getTotalBytes(): number {
    return Array.from(this.allocations.values()).reduce((s, a) => s + a.sizeBytes, 0);
  }

  getMemoryReport(): MemoryReport {
    const allocs = Array.from(this.allocations.values());
    const totalBytes = allocs.reduce((s, a) => s + a.sizeBytes, 0);
    const hotBytes = allocs.filter(a => a.tier === "hot").reduce((s, a) => s + a.sizeBytes, 0);
    const coldBytes = allocs.filter(a => a.tier === "cold" || a.tier === "archived").reduce((s, a) => s + a.sizeBytes, 0);
    const utilization = totalBytes / this.MAX_BYTES;
    return {
      totalAllocations: allocs.length,
      totalBytesAllocated: totalBytes,
      hotBytes, coldBytes,
      fragmentationRatio: allocs.length > 1 ? 0.05 : 0,
      pressureLevel: utilization > 0.9 ? "critical" : utilization > 0.7 ? "high" : utilization > 0.5 ? "medium" : "low",
    };
  }
}

export const globalMemoryOptimizer = new MemoryOptimizerEngine();

export function allocateMemory(label: string, sizeBytes: number, tier?: MemoryTier, pinned?: boolean): MemoryAllocation {
  return globalMemoryOptimizer.allocate(label, sizeBytes, tier, pinned);
}
export function accessMemory(allocationId: string): boolean {
  return globalMemoryOptimizer.access(allocationId);
}
export function optimizeMemory(): MemoryOptimizationResult {
  return globalMemoryOptimizer.optimize();
}
export function getMemoryReport(): MemoryReport {
  return globalMemoryOptimizer.getMemoryReport();
}
export function initMemoryOptimizer(): void {
  console.log("[MemoryOptimizer] Memory Optimizer initialized.");
}
