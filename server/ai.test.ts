/**
 * Andromeda v6.12 — Core AI Module Tests
 *
 * Tests for the ai.ts module:
 *  - Todo CRUD operations
 *  - Andromeda memory (ANDROMEDA.md read/write)
 *  - Model configuration (getModel, setModel, getAvailableModels)
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  todoCreate,
  todoUpdate,
  todoList,
  todoDelete,
  readAndromedaMemory,
  writeAndromedaMemory,
  getModel,
  setModel,
  getAvailableModels,
} from "./ai.js";

describe("ai — Todo CRUD", () => {
  it("creates a todo item", () => {
    const item = todoCreate("Test task", "high");
    expect(item).toHaveProperty("id");
    expect(item).toHaveProperty("content", "Test task");
    expect(item).toHaveProperty("priority", "high");
    expect(item).toHaveProperty("status");
  });

  it("creates with default priority", () => {
    const item = todoCreate("Default priority task");
    expect(item.priority).toBe("medium");
  });

  it("lists todos", () => {
    const list = todoList();
    expect(Array.isArray(list)).toBe(true);
  });

  it("updates a todo item", () => {
    const item = todoCreate("Update me");
    const updated = todoUpdate(item.id, { status: "done" });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("done");
  });

  it("returns null for non-existent update", () => {
    const result = todoUpdate("non-existent-id", { status: "done" });
    expect(result).toBeNull();
  });

  it("deletes a todo item", () => {
    const item = todoCreate("Delete me");
    const deleted = todoDelete(item.id);
    expect(deleted).toBe(true);
  });

  it("returns false for non-existent delete", () => {
    const result = todoDelete("non-existent-id");
    expect(result).toBe(false);
  });
});

describe("ai — Andromeda Memory", () => {
  it("writeAndromedaMemory writes content", async () => {
    const result = await writeAndromedaMemory("Test memory content");
    expect(result).toHaveProperty("path");
    expect(result).toHaveProperty("chars");
    expect(result.chars).toBe(19);
  });

  it("readAndromedaMemory reads back written content", async () => {
    const testContent = `Memory test ${Date.now()}`;
    await writeAndromedaMemory(testContent);
    const result = readAndromedaMemory();
    expect(result).toBe(testContent);
  });

  it("readAndromedaMemory returns string or null", () => {
    const result = readAndromedaMemory();
    expect(result === null || typeof result === "string").toBe(true);
  });
});

describe("ai — Model Configuration", () => {
  it("getModel returns a string", () => {
    const model = getModel();
    expect(typeof model).toBe("string");
    expect(model.length).toBeGreaterThan(0);
  });

  it("setModel changes the active model", () => {
    const original = getModel();
    setModel("test-model");
    expect(getModel()).toBe("test-model");
    // Restore
    setModel(original);
  });

  it("getAvailableModels returns an array", () => {
    const models = getAvailableModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });

  it("getAvailableModels items have required fields", () => {
    const models = getAvailableModels();
    for (const m of models) {
      expect(m).toHaveProperty("id");
      expect(m).toHaveProperty("name");
      expect(m).toHaveProperty("type");
    }
  });
});
