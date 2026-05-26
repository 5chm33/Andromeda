/**
 * Andromeda v5.31 — Circuit Breaker
 *
 * Prevents cascade failures when AI API calls fail repeatedly.
 * Implements the standard circuit breaker pattern:
 *
 * CLOSED → (failures exceed threshold) → OPEN → (timeout) → HALF_OPEN → (success) → CLOSED
 *                                                                       → (failure) → OPEN
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms to wait before transitioning from OPEN → HALF_OPEN */
  resetTimeoutMs: number;
  /** Number of successes in HALF_OPEN needed to close the circuit */
  successThreshold: number;
  /** Optional: max time a request can take before counting as failure */
  requestTimeoutMs?: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  lastStateChange: number;
  openedCount: number;
}

// ─── Default Config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000, // 30 seconds
  successThreshold: 2,
  requestTimeoutMs: 180_000, // 3 minutes
};

// ─── Circuit Breaker Class ────────────────────────────────────────────────────

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalRequests = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private lastStateChange = Date.now();
  private openedCount = 0;
  private config: CircuitBreakerConfig;
  private name: string;

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitOpenError if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new CircuitOpenError(
        `Circuit breaker [${this.name}] is OPEN. Waiting ${this.remainingResetTime()}ms before retry.`,
        this.remainingResetTime()
      );
    }

    this.totalRequests++;

    try {
      let result: T;
      if (this.config.requestTimeoutMs) {
        result = await this.withTimeout(fn, this.config.requestTimeoutMs);
      } else {
        result = await fn();
      }
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Check if the circuit allows execution.
   */
  canExecute(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "half_open") return true;

    // OPEN state: check if reset timeout has elapsed
    if (this.state === "open") {
      const elapsed = Date.now() - this.lastStateChange;
      if (elapsed >= this.config.resetTimeoutMs) {
        this.transitionTo("half_open");
        return true;
      }
      return false;
    }

    return false;
  }

  /**
   * Get current stats.
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastStateChange: this.lastStateChange,
      openedCount: this.openedCount,
    };
  }

  /**
   * Manually reset the circuit breaker to closed state.
   */
  reset(): void {
    this.transitionTo("closed");
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
  }

  // ─── Private Methods ──────────────────────────────────────────────────────

  private onSuccess(): void {
    this.totalSuccesses++;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;
    this.lastSuccessTime = Date.now();

    if (this.state === "half_open" && this.consecutiveSuccesses >= this.config.successThreshold) {
      this.transitionTo("closed");
    }
  }

  private onFailure(error: unknown): void {
    this.totalFailures++;
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === "half_open") {
      // Any failure in half_open goes back to open
      this.transitionTo("open");
    } else if (this.state === "closed" && this.consecutiveFailures >= this.config.failureThreshold) {
      this.transitionTo("open");
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === "open") {
      this.openedCount++;
      console.warn(`[CircuitBreaker:${this.name}] ${oldState} → OPEN (${this.consecutiveFailures} consecutive failures)`);
    } else if (newState === "closed") {
      console.log(`[CircuitBreaker:${this.name}] ${oldState} → CLOSED (recovered)`);
      this.consecutiveFailures = 0;
    } else {
      console.log(`[CircuitBreaker:${this.name}] ${oldState} → HALF_OPEN (testing)`);
      this.consecutiveSuccesses = 0;
    }
  }

  private remainingResetTime(): number {
    if (this.state !== "open") return 0;
    const elapsed = Date.now() - this.lastStateChange;
    return Math.max(0, this.config.resetTimeoutMs - elapsed);
  }

  private async withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Circuit breaker [${this.name}] request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      fn()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}

// ─── Custom Error ─────────────────────────────────────────────────────────────

export class CircuitOpenError extends Error {
  public retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "CircuitOpenError";
    this.retryAfterMs = retryAfterMs;
  }
}

// ─── Global Circuit Breakers ──────────────────────────────────────────────────

const breakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a named circuit breaker.
 */
export function getCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  if (!breakers.has(name)) {
    breakers.set(name, new CircuitBreaker(name, config));
  }
  return breakers.get(name)!;
}

/**
 * Get stats for all circuit breakers.
 */
export function getAllCircuitBreakerStats(): Record<string, CircuitBreakerStats> {
  const stats: Record<string, CircuitBreakerStats> = {};
  for (const [name, breaker] of Array.from(breakers.entries())) {
    stats[name] = breaker.getStats();
  }
  return stats;
}

/**
 * Reset all circuit breakers.
 */
export function resetAllCircuitBreakers(): void {
  for (const breaker of Array.from(breakers.values())) {
    breaker.reset();
  }
}

// ─── Pre-configured breakers for common use ───────────────────────────────────

/** Circuit breaker for the main LLM API (DeepSeek) */
export const llmBreaker = getCircuitBreaker("llm_api", {
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  successThreshold: 2,
  requestTimeoutMs: 180_000,
});

/** Circuit breaker for search APIs (Brave, SearXNG) */
export const searchBreaker = getCircuitBreaker("search_api", {
  failureThreshold: 5,
  resetTimeoutMs: 15_000,
  successThreshold: 1,
  requestTimeoutMs: 30_000,
});

/** Circuit breaker for code execution */
export const codeExecBreaker = getCircuitBreaker("code_exec", {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  successThreshold: 1,
  requestTimeoutMs: 120_000,
});
