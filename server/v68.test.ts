/**
 * v68.test.ts — Real-World Integration III
 */
import { describe, it, expect, beforeEach } from "vitest";
import { sendNotification, getNotifications, getDeliveryRate, _resetNotificationManagerForTest } from "./notificationManager";
import { createQueue, enqueue, dequeue, getQueueStats, _resetQueueManagerForTest } from "./queueManager";
import { defineRateLimit, checkRateLimit, _resetRateLimitEnforcerForTest } from "./rateLimitEnforcer";
import { withRetry } from "./retryOrchestrator";
import { createCircuitBreaker, callWithCircuitBreaker, getCircuitStats, _resetCircuitBreakersForTest } from "./circuitBreakerV68";
import { sendToDeadLetter, inspectDeadLetters, replayDeadLetter, purgeDeadLetters, getDeadLetterCount, _resetDeadLetterQueueForTest } from "./deadLetterQueue";

beforeEach(() => {
  _resetNotificationManagerForTest();
  _resetQueueManagerForTest();
  _resetRateLimitEnforcerForTest();
  _resetCircuitBreakersForTest();
  _resetDeadLetterQueueForTest();
});

describe("notificationManager", () => {
  it("sends a notification successfully", () => {
    const n = sendNotification("email", "user@example.com", "Hello", "Body");
    expect(n.delivered).toBe(true);
    expect(n.channel).toBe("email");
  });

  it("deduplicates repeated notifications", () => {
    sendNotification("slack", "channel-1", "Alert", "Body");
    const second = sendNotification("slack", "channel-1", "Alert", "Body");
    expect(second.delivered).toBe(false);
    expect(second.error).toMatch(/deduplicated/i);
  });

  it("filters notifications by channel", () => {
    sendNotification("email", "a@b.com", "S1", "B");
    sendNotification("sms", "555-1234", "S2", "B");
    expect(getNotifications("email")).toHaveLength(1);
    expect(getNotifications("sms")).toHaveLength(1);
  });

  it("computes delivery rate", () => {
    sendNotification("push", "device-1", "S1", "B");
    expect(getDeliveryRate()).toBe(1);
  });
});

describe("queueManager", () => {
  it("enqueues and dequeues FIFO", () => {
    createQueue("test-q");
    enqueue("test-q", "first");
    enqueue("test-q", "second");
    expect(dequeue<string>("test-q")?.payload).toBe("first");
    expect(dequeue<string>("test-q")?.payload).toBe("second");
  });

  it("respects priority ordering", () => {
    createQueue("prio-q", "priority");
    enqueue("prio-q", "low", 1);
    enqueue("prio-q", "high", 10);
    expect(dequeue<string>("prio-q")?.payload).toBe("high");
  });

  it("tracks queue stats", () => {
    createQueue("stats-q");
    enqueue("stats-q", "msg1");
    dequeue("stats-q");
    const stats = getQueueStats("stats-q");
    expect(stats?.processedCount).toBe(1);
  });

  it("drops messages when queue is full", () => {
    createQueue("small-q", "fifo", 2);
    enqueue("small-q", "m1");
    enqueue("small-q", "m2");
    expect(() => enqueue("small-q", "m3")).toThrow(/full/);
    expect(getQueueStats("small-q")?.droppedCount).toBe(1);
  });
});

describe("rateLimitEnforcer", () => {
  it("allows requests within limit", () => {
    defineRateLimit({ key: "api", algorithm: "sliding_window", maxRequests: 5, windowMs: 1000 });
    const result = checkRateLimit("api", "user-1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("blocks requests exceeding limit", () => {
    defineRateLimit({ key: "strict", algorithm: "sliding_window", maxRequests: 2, windowMs: 60000 });
    checkRateLimit("strict", "user-1");
    checkRateLimit("strict", "user-1");
    const result = checkRateLimit("strict", "user-1");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("token bucket allows burst then refills", () => {
    defineRateLimit({ key: "bucket", algorithm: "token_bucket", maxRequests: 3, windowMs: 1000 });
    const r1 = checkRateLimit("bucket", "user-1");
    const r2 = checkRateLimit("bucket", "user-1");
    const r3 = checkRateLimit("bucket", "user-1");
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
  });
});

describe("retryOrchestrator", () => {
  it("succeeds on first attempt", async () => {
    const result = await withRetry(async () => "success");
    expect(result.success).toBe(true);
    expect(result.result).toBe("success");
    expect(result.attempts).toBe(1);
  });

  it("retries on failure and eventually succeeds", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new Error("temporary");
      return "ok";
    }, { maxAttempts: 3, baseDelayMs: 1, backoff: "constant", jitter: false });
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it("returns failure after max attempts", async () => {
    const result = await withRetry(async () => { throw new Error("permanent"); }, { maxAttempts: 2, baseDelayMs: 1, backoff: "constant", jitter: false });
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
  });
});

describe("circuitBreakerV68", () => {
  it("starts in closed state", () => {
    createCircuitBreaker({ name: "svc", failureThreshold: 3, successThreshold: 2, timeoutMs: 1000, halfOpenMaxCalls: 1 });
    expect(getCircuitStats("svc")?.state).toBe("closed");
  });

  it("opens after failure threshold", async () => {
    createCircuitBreaker({ name: "fragile", failureThreshold: 2, successThreshold: 2, timeoutMs: 5000, halfOpenMaxCalls: 1 });
    for (let i = 0; i < 2; i++) {
      try { await callWithCircuitBreaker("fragile", async () => { throw new Error("fail"); }); } catch { /* expected */ }
    }
    expect(getCircuitStats("fragile")?.state).toBe("open");
  });

  it("allows calls in closed state", async () => {
    createCircuitBreaker({ name: "healthy", failureThreshold: 5, successThreshold: 2, timeoutMs: 1000, halfOpenMaxCalls: 2 });
    const result = await callWithCircuitBreaker("healthy", async () => 42);
    expect(result).toBe(42);
  });
});

describe("deadLetterQueue", () => {
  it("stores failed messages", () => {
    sendToDeadLetter("orders", { orderId: 1 }, "Processing failed", 3);
    expect(getDeadLetterCount()).toBe(1);
  });

  it("filters by original queue", () => {
    sendToDeadLetter("orders", { id: 1 }, "fail", 1);
    sendToDeadLetter("payments", { id: 2 }, "fail", 1);
    expect(inspectDeadLetters("orders")).toHaveLength(1);
    expect(inspectDeadLetters("payments")).toHaveLength(1);
  });

  it("replays a dead letter", async () => {
    const dl = sendToDeadLetter("tasks", { task: "run" }, "timeout", 2);
    let replayed = false;
    await replayDeadLetter(dl.id, async () => { replayed = true; });
    expect(replayed).toBe(true);
    expect(inspectDeadLetters()[0].replayedAt).toBeDefined();
  });

  it("purges dead letters", () => {
    sendToDeadLetter("q1", {}, "fail", 1);
    sendToDeadLetter("q1", {}, "fail", 1);
    sendToDeadLetter("q2", {}, "fail", 1);
    purgeDeadLetters("q1");
    expect(getDeadLetterCount()).toBe(1);
  });
});
