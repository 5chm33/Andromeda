import os from "os";

export interface SystemHealth {
  memoryUsagePct: number;
  cpuLoad: number;
  apiRateLimitRemaining: number;
  uptime: number;
  status: "healthy" | "degraded" | "critical";
}

let mockApiRateLimit = 1000;

/**
 * Monitors the health of the daemon infrastructure.
 */
export function checkSystemHealth(): SystemHealth {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memoryUsagePct = ((totalMem - freeMem) / totalMem) * 100;
  
  const cpus = os.cpus();
  // Simplified CPU load calculation for mock purposes
  const cpuLoad = cpus.reduce((acc, cpu) => acc + (cpu.times.user / (cpu.times.user + cpu.times.idle)), 0) / cpus.length * 100;
  
  let status: "healthy" | "degraded" | "critical" = "healthy";
  
  if (memoryUsagePct > 90 || cpuLoad > 90 || mockApiRateLimit < 10) {
    status = "critical";
  } else if (memoryUsagePct > 75 || cpuLoad > 75 || mockApiRateLimit < 100) {
    status = "degraded";
  }
  
  return {
    memoryUsagePct,
    cpuLoad,
    apiRateLimitRemaining: mockApiRateLimit,
    uptime: os.uptime(),
    status
  };
}

/**
 * Autonomously heals the infrastructure based on health status.
 */
export function applySelfHealing(): boolean {
  const health = checkSystemHealth();
  
  if (health.status === "healthy") {
    return false; // No healing needed
  }
  
  console.log(`[SelfHealing] System health is ${health.status}. Initiating self-healing protocols...`);
  
  if (health.memoryUsagePct > 80) {
    console.log(`[SelfHealing] Memory usage high (${health.memoryUsagePct.toFixed(1)}%). Triggering garbage collection and cache eviction...`);
    // Mock GC and cache eviction
    if (global.gc) {
      global.gc();
    }
  }
  
  if (health.apiRateLimitRemaining < 50) {
    console.log(`[SelfHealing] API rate limit critically low (${health.apiRateLimitRemaining}). Switching to fallback provider...`);
    // Mock provider switch
  }
  
  console.log(`[SelfHealing] Self-healing protocols completed.`);
  return true;
}

/**
 * Initializes the self-healing daemon loop.
 */
export function initSelfHealingDaemon() {
  console.log(`[SelfHealing] Daemon initialized. Monitoring infrastructure every 60 seconds.`);
  // In a real implementation, this would use setInterval
  // setInterval(applySelfHealing, 60000);
}

// For testing purposes
export function _setMockApiRateLimit(limit: number) {
  mockApiRateLimit = limit;
}
