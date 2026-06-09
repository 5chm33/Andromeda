import { describe, it, expect } from "vitest";
import {
  goalCreateSchema,
  subGoalCreateSchema,
  scheduledTaskCreateSchema,
  busPublishSchema,
  selfModifySchema
} from "./zodSchemas";

describe("zodSchemas", () => {
  describe("goalCreateSchema", () => {
    it("should validate valid goal", () => {
      const result = goalCreateSchema.safeParse({
        title: "Test Goal",
        description: "Test Description"
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid goal", () => {
      const result = goalCreateSchema.safeParse({
        title: ""
      });
      expect(result.success).toBe(false);
    });
  });

  describe("subGoalCreateSchema", () => {
    it("should validate valid subGoal", () => {
      const result = subGoalCreateSchema.safeParse({
        title: "Test SubGoal",
        description: "Test Description",
        estimatedComplexity: "simple"
      });
      expect(result.success).toBe(true);
    });
  });

  describe("scheduledTaskCreateSchema", () => {
    it("should validate valid scheduled task", () => {
      const result = scheduledTaskCreateSchema.safeParse({
        name: "Test Task",
        description: "Test Description",
        action: "do-something",
        actionType: "script"
      });
      expect(result.success).toBe(true);
    });
  });

  describe("busPublishSchema", () => {
    it("should validate valid bus publish", () => {
      const result = busPublishSchema.safeParse({
        channel: "test",
        agentId: "agent-1",
        agentRole: "tester",
        type: "finding",
        title: "Found something",
        content: "Details here"
      });
      expect(result.success).toBe(true);
    });
  });

  describe("selfModifySchema", () => {
    it("should validate valid self modify request", () => {
      const result = selfModifySchema.safeParse({
        filePath: "/test.ts",
        newContent: "code",
        reason: "fix bug",
        impact: "low",
        category: "bugfix"
      });
      expect(result.success).toBe(false); // "bugfix" is not in the enum
      
      const result2 = selfModifySchema.safeParse({
        filePath: "/test.ts",
        newContent: "code",
        reason: "fix bug",
        impact: "low",
        category: "security"
      });
      expect(result2.success).toBe(true);
    });
  });
});
