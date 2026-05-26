/**
 * agentMemory.ts — Cross-Session Memory Tools for the ReAct Agent
 * Andromeda v5.40 (SOTA upgrade)
 *
 * Exposes the existing memory.ts system as agent-callable tools:
 *  - store_memory: Save a fact, preference, project detail, or error fix
 *  - recall_memory: Search memories by query to recall past learnings
 *  - list_memories: List recent memories by type
 */

import { registerTool } from "./toolRegistry";
import { storeMemory, searchMemory, listMemories } from "../memory";
import type { MemoryType } from "../memory";

// ─── store_memory ──────────────────────────────────────────────────────────

registerTool({
  name: "store_memory",
  description: "Store a piece of information in long-term memory for recall in future sessions.",
  category: "agent",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "store_memory",
      description: "Store a piece of information in long-term memory for recall in future sessions. Use this to remember user preferences, project details, error fixes, or important facts. Memories persist across conversations.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The information to remember. Be specific and concise.",
          },
          type: {
            type: "string",
            enum: ["preference", "error", "project", "feedback", "fact"],
            description: "Category: preference, error, project, feedback, or fact",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tags for easier retrieval",
          },
        },
        required: ["content", "type"],
      },
    },
  },
  execute: async (args) => {
    try {
      const content = String(args.content || "");
      const type = String(args.type || "fact") as MemoryType;
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];

      if (!content.trim()) {
        return { success: false, output: "", error: "Content cannot be empty" };
      }

      const entry = storeMemory(content, type, tags);
      return {
        success: true,
        output: `Memory stored successfully.\nID: ${entry.id}\nType: ${type}\nTags: ${tags.length > 0 ? tags.join(", ") : "none"}\nContent: ${content.slice(0, 100)}${content.length > 100 ? "..." : ""}`,
        error: undefined,
      };
    } catch (err) {
      return { success: false, output: "", error: `Failed to store memory: ${err}` };
    }
  },
});

// ─── recall_memory ─────────────────────────────────────────────────────────

registerTool({
  name: "recall_memory",
  description: "Search long-term memory for relevant information from past sessions.",
  category: "agent",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "recall_memory",
      description: "Search long-term memory for relevant information from past sessions. Use at the start of tasks to check if you already know something about the project or user preferences. Also use when you encounter an error to check if you have seen it before.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What to search for in memory. Use natural language.",
          },
          type: {
            type: "string",
            enum: ["preference", "error", "project", "feedback", "fact"],
            description: "Optional: filter by memory type to narrow results",
          },
          limit: {
            type: "number",
            description: "Maximum number of memories to return (default: 5)",
          },
        },
        required: ["query"],
      },
    },
  },
  execute: async (args) => {
    try {
      const query = String(args.query || "");
      const type = args.type ? String(args.type) as MemoryType : undefined;
      const limit = typeof args.limit === "number" ? args.limit : 5;

      if (!query.trim()) {
        return { success: false, output: "", error: "Query cannot be empty" };
      }

      const results = searchMemory(query, limit, type);

      if (results.length === 0) {
        return {
          success: true,
          output: `No memories found matching "${query}".${type ? ` (filtered by type: ${type})` : ""}`,
          error: undefined,
        };
      }

      const formatted = results.map((m, i) => {
        const e = m.entry;
        const age = Math.round((Date.now() - e.createdAt) / (1000 * 60 * 60));
        const ageStr = age < 1 ? "just now" : age < 24 ? `${age}h ago` : `${Math.round(age / 24)}d ago`;
        return `${i + 1}. [${e.type}] ${e.content}\n   Tags: ${e.tags.length > 0 ? e.tags.join(", ") : "none"} | Stored: ${ageStr} | Accessed: ${e.accessCount}x`;
      }).join("\n\n");

      return {
        success: true,
        output: `Found ${results.length} relevant memories:\n\n${formatted}`,
        error: undefined,
      };
    } catch (err) {
      return { success: false, output: "", error: `Failed to recall memory: ${err}` };
    }
  },
});

// ─── list_memories ─────────────────────────────────────────────────────────

registerTool({
  name: "list_memories",
  description: "List recent memories, optionally filtered by type.",
  category: "agent",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "list_memories",
      description: "List recent memories, optionally filtered by type. Use this to see what the agent has learned over time.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["preference", "error", "project", "feedback", "fact"],
            description: "Optional: filter by memory type",
          },
          limit: {
            type: "number",
            description: "Maximum number of memories to return (default: 10)",
          },
        },
        required: [],
      },
    },
  },
  execute: async (args) => {
    try {
      const type = args.type ? String(args.type) as MemoryType : undefined;
      const limit = typeof args.limit === "number" ? args.limit : 10;

      const results = listMemories(limit, type);

      if (results.length === 0) {
        return {
          success: true,
          output: `No memories stored yet.${type ? ` (filtered by type: ${type})` : ""}`,
          error: undefined,
        };
      }

      const formatted = results.map((m, i) => {
        const date = new Date(m.createdAt).toISOString().split("T")[0];
        return `${i + 1}. [${m.type}] ${m.content.slice(0, 120)}${m.content.length > 120 ? "..." : ""}\n   Tags: ${m.tags.join(", ") || "none"} | Date: ${date} | Accessed: ${m.accessCount}x`;
      }).join("\n\n");

      return {
        success: true,
        output: `${results.length} memories:\n\n${formatted}`,
        error: undefined,
      };
    } catch (err) {
      return { success: false, output: "", error: `Failed to list memories: ${err}` };
    }
  },
});
