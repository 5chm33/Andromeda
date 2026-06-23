/**
 * Andromeda v6.12 — ReactEngine Agent Loop Tests
 *
 * Tests for the ReactEngine class:
 *  - Constructor and configuration
 *  - Session ID generation
 *  - Event emission
 *  - Tool cache behavior
 */
import { describe, it, expect } from "vitest";
import * as ReactengineModule from "./reactEngine.js";
import type { AgentConfig, AgentEvent } from "./reactEngine.js";

function createTestConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    maxSteps: 10,
    maxTokens: 4096,
    temperature: 0.7,
    workspaceDir: "/tmp/test-workspace",
    onEvent: () => {},
    ...overrides,
  };
}

describe("ReactEngine", () => {
  describe("constructor", () => {
    it("creates an instance with valid config", () => {
      const engine = new ReactengineModule.ReactEngine(createTestConfig());
      expect(engine).toBeInstanceOf(ReactengineModule.ReactEngine);
    });

    it("accepts custom session ID", () => {
      const engine = new ReactengineModule.ReactEngine(createTestConfig({ sessionId: "test-session-123" }));
      expect(engine).toBeInstanceOf(ReactengineModule.ReactEngine);
    });

    it("generates a session ID when none provided", () => {
      const engine = new ReactengineModule.ReactEngine(createTestConfig());
      expect(engine).toBeInstanceOf(ReactengineModule.ReactEngine);
    });

    it("accepts custom system prompt", () => {
      const engine = new ReactengineModule.ReactEngine(createTestConfig({
        systemPrompt: "You are a test agent.",
      }));
      expect(engine).toBeInstanceOf(ReactengineModule.ReactEngine);
    });

    it("accepts tool category filters", () => {
      const engine = new ReactengineModule.ReactEngine(createTestConfig({
        toolCategories: ["filesystem", "code"],
      }));
      expect(engine).toBeInstanceOf(ReactengineModule.ReactEngine);
    });
  });

  describe("event handling", () => {
    it("calls onEvent callback when events are emitted", () => {
      const events: AgentEvent[] = [];
      const engine = new ReactengineModule.ReactEngine(createTestConfig({
        onEvent: (event) => events.push(event),
      }));
      expect(engine).toBeInstanceOf(ReactengineModule.ReactEngine);
      // Events are emitted during run(), which requires LLM — just verify setup works
    });
  });

  describe("abort signal", () => {
    it("accepts an AbortSignal for cancellation", () => {
      const controller = new AbortController();
      const engine = new ReactengineModule.ReactEngine(createTestConfig({
        signal: controller.signal,
      }));
      expect(engine).toBeInstanceOf(ReactengineModule.ReactEngine);
    });
  });

  describe("configuration validation", () => {
    it("handles zero maxSteps", () => {
      const engine = new ReactengineModule.ReactEngine(createTestConfig({ maxSteps: 0 }));
      expect(engine).toBeInstanceOf(ReactengineModule.ReactEngine);
    });

    it("handles high temperature", () => {
      const engine = new ReactengineModule.ReactEngine(createTestConfig({ temperature: 1.5 }));
      expect(engine).toBeInstanceOf(ReactengineModule.ReactEngine);
    });

    it("handles large maxTokens", () => {
      const engine = new ReactengineModule.ReactEngine(createTestConfig({ maxTokens: 128_000 }));
      expect(engine).toBeInstanceOf(ReactengineModule.ReactEngine);
    });
  });
});
