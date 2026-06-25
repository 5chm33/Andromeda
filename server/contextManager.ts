/**
 * contextManager.ts — Context Window Management with Automatic Summarization
 * Andromeda v5.42 (SOTA upgrade)
 *
 * Prevents context window overflow by:
 *  1. Tracking estimated token count of the conversation
 *  2. When approaching the limit, summarizing older messages
 *  3. Replacing old messages with a compact summary
 *  4. Preserving the system prompt, recent messages, and critical tool results
 *  5. NEVER splitting an assistant+tool_calls message from its tool result messages
 *
 * This is how Manus handles 50+ step tasks without blowing out the context.
 */

import type { ChatMessage } from "./llmProvider";
import { chatCompletion } from "./llmProvider";

// ─── Token Estimation ──────────────────────────────────────────────────────

/**
 * Rough token estimation: ~3.5 chars per token for English text.
 * This is intentionally conservative (over-estimates) to prevent overflow.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

export function estimateMessageTokens(messages: ChatMessage[]): number {
  if (!messages) return 0;
  let total = 0;
  for (const msg of messages) {
    total += 4; // message overhead (role, separators)
    if (typeof msg.content === "string") {
      total += estimateTokens(msg.content);
    }
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(tc.function.name);
        total += estimateTokens(tc.function.arguments);
        total += 10; // tool call overhead
      }
    }
  }
  return total;
}

// ─── Context Window Configuration ──────────────────────────────────────────

export interface ContextWindowConfig {
  maxContextTokens: number;     // Total context window size (e.g., 128000)
  reserveForResponse: number;   // Tokens reserved for the response (e.g., 16000)
  summarizationThreshold: number; // Trigger summarization when usage exceeds this ratio (e.g., 0.75)
  minMessagesToKeep: number;    // Always keep at least this many recent messages
  maxSummaryTokens: number;     // Max tokens for the summary itself
}

const DEFAULT_CONFIG: ContextWindowConfig = {
  maxContextTokens: 128000,
  reserveForResponse: 16000,
  summarizationThreshold: 0.90,  // v5.45: Summarize only when 90% full - use more context
  minMessagesToKeep: 20,         // v5.45: Keep more messages for better continuity
  maxSummaryTokens: 2000,
};

// ─── Message Group Utilities ──────────────────────────────────────────────

/**
 * A "message group" is an atomic unit that cannot be split:
 *  - A standalone user/system/assistant message (no tool_calls) → 1 message
 *  - An assistant message with tool_calls + all its corresponding tool result messages → N+1 messages
 *
 * DeepSeek/OpenAI APIs REQUIRE that every `role: "tool"` message immediately follows
 * an `assistant` message that has `tool_calls` with a matching `tool_call_id`.
 * Splitting them causes: "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"
 */
interface MessageGroup {
  messages: ChatMessage[];
  tokenEstimate: number;
}

/**
 * Split a flat message array into atomic groups that cannot be broken apart.
 * This ensures assistant+tool_calls is always paired with its tool responses.
 */
function groupMessages(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    // If this is an assistant message with tool_calls, group it with subsequent tool messages
    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const groupMsgs: ChatMessage[] = [msg];
      i++;

      // Collect all immediately following tool messages
      while (i < messages.length && messages[i].role === "tool") {
        groupMsgs.push(messages[i]);
        i++;
      }

      groups.push({
        messages: groupMsgs,
        tokenEstimate: estimateMessageTokens(groupMsgs),
      });
    } else {
      // Standalone message (system, user, or assistant without tool_calls)
      groups.push({
        messages: [msg],
        tokenEstimate: estimateMessageTokens([msg]),
      });
      i++;
    }
  }

  return groups;
}

// ─── Context Manager ───────────────────────────────────────────────────────

export class ContextManager {
  private config: ContextWindowConfig;
  private summaryCount = 0;

  constructor(config?: Partial<ContextWindowConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if the conversation needs summarization and perform it if so.
   * Returns the (possibly compacted) message array.
   */
  async manageContext(messages: ChatMessage[]): Promise<ChatMessage[]> {
    if (!messages || messages.length === 0) return messages || [];
    const currentTokens = estimateMessageTokens(messages);
    const availableTokens = this.config.maxContextTokens - this.config.reserveForResponse;
    const threshold = availableTokens * this.config.summarizationThreshold;

    if (currentTokens <= threshold) {
      return messages; // No compaction needed
    }

    console.log(`[ContextManager] Token usage ${currentTokens}/${availableTokens} exceeds threshold ${Math.round(threshold)}. Compacting...`);

    return this.compactMessages(messages);
  }

  /**
   * Compact the message history by summarizing older message GROUPS.
   * Preserves: system prompt, summary of old messages, recent messages.
   * CRITICAL: Never splits an assistant+tool_calls from its tool responses.
   */
  private async compactMessages(messages: ChatMessage[]): Promise<ChatMessage[]> {
    if (messages.length <= this.config.minMessagesToKeep) {
      return messages; // Too few messages to compact
    }

    // The first message is always the system prompt
    const systemMsg = messages[0];
    const restMessages = messages.slice(1);

    // Group the rest into atomic units
    const groups = groupMessages(restMessages);

    if (groups.length < 3) {
      return messages; // Not enough groups to compact
    }

    // Determine how many groups to keep (at least 30% or minMessagesToKeep groups)
    const keepGroupCount = Math.max(
      2, // Always keep at least 2 groups
      Math.ceil(groups.length * 0.6), // v5.45: Keep 60% of groups
      Math.ceil(this.config.minMessagesToKeep / 2)
    );

    const oldGroups = groups.slice(0, groups.length - keepGroupCount);
    const recentGroups = groups.slice(groups.length - keepGroupCount);

    if (oldGroups.length < 2) {
      return messages; // Not enough old groups to summarize
    }

    // Flatten old groups back to messages for summarization
    const oldMessages = oldGroups.flatMap(g => g.messages);

    // Generate summary of old messages
    const summary = await this.summarizeMessages(oldMessages);
    this.summaryCount++;

    // Flatten recent groups back to messages
    const recentMessages = recentGroups.flatMap(g => g.messages);

    // Build compacted conversation
    const compacted: ChatMessage[] = [
      systemMsg,
      {
        role: "system" as const,
        content: `[Context Compaction #${this.summaryCount}] The following is a summary of earlier conversation steps that have been compacted to save context space:\n\n${summary}\n\n[End of compacted context. Recent messages follow.]`,
      },
      ...recentMessages,
    ];

    // SAFETY CHECK: Verify the compacted messages don't start with a tool message
    // after the system messages (which would be invalid)
    if (recentMessages.length > 0 && recentMessages[0].role === "tool") {
      // This shouldn't happen with proper grouping, but as a safety net:
      // Find the assistant message that owns these tool messages and include it
      console.warn(`[ContextManager] Safety check: recent messages start with tool role. Skipping compaction.`);
      return messages;
    }

    const oldTokens = estimateMessageTokens(messages);
    const newTokens = estimateMessageTokens(compacted);
    console.log(`[ContextManager] Compacted ${messages.length} messages → ${compacted.length} messages. Tokens: ${oldTokens} → ${newTokens} (saved ${oldTokens - newTokens})`);

    return compacted;
  }

  /**
   * Summarize a set of messages into a compact text summary.
   * Uses the LLM itself to generate the summary.
   */
  private async summarizeMessages(messages: ChatMessage[]): Promise<string> {
    // Build a text representation of the messages to summarize
    const textParts: string[] = [];
    for (const msg of messages) {
      const role = msg.role.toUpperCase();
      if (msg.role === "assistant" && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          textParts.push(`TOOL_CALL: ${tc.function.name}(${tc.function.arguments.slice(0, 200)}...)`);
        }
      }
      if (typeof msg.content === "string" && msg.content.trim()) {
        // Truncate very long tool results
        const content = msg.content.length > 500
          ? msg.content.slice(0, 400) + `... [truncated ${msg.content.length - 400} chars]`
          : msg.content;
        textParts.push(`${role}: ${content}`);
      }
    }

    const conversationText = textParts.join("\n\n");

    try {
      const result = await chatCompletion([
        {
          role: "system",
          content: "You are a conversation summarizer. Summarize the following agent conversation steps into a concise summary. Focus on: (1) What tools were called and what they did, (2) What files were created/modified, (3) Key decisions made, (4) Current state of the task. Be concise but preserve all important details. Output only the summary, no preamble.",
        },
        {
          role: "user",
          content: `Summarize these ${messages.length} conversation steps:\n\n${conversationText.slice(0, 8000)}`,
        },
      ], {
        temperature: 0.3,
        maxTokens: this.config.maxSummaryTokens,
      });

      return result.content || "Summary generation failed — previous steps involved tool calls and reasoning.";
    } catch (err) {
      // Fallback: create a simple mechanical summary
      console.warn(`[ContextManager] LLM summarization failed: ${err}. Using fallback.`);
      return this.fallbackSummary(messages);
    }
  }

  /**
   * Fallback summary when LLM is unavailable — extracts key info mechanically.
   */
  private fallbackSummary(messages: ChatMessage[]): string {
    const toolCalls = this.extractToolCalls(messages);
    const files = this.extractFilePaths(messages);
    const lastContent = this.extractLastContent(messages);

    const parts: string[] = [];
    if (toolCalls.length > 0) {
      parts.push(`Tools called: ${toolCalls.join(", ")}`);
    }
    if (files.size > 0) {
      parts.push(`Files involved: ${[...files].join(", ")}`);
    }
    if (lastContent) {
      parts.push(`Last context: ${lastContent}`);
    }

    return parts.join("\n") || "Previous steps involved agent reasoning and tool execution.";
  }

  private extractToolCalls(messages: ChatMessage[]): string[] {
    return messages
      .filter(msg => msg.role === "assistant" && msg.tool_calls)
      .flatMap(msg => msg.tool_calls!.map(tc => tc.function.name));
  }

  private extractFilePaths(messages: ChatMessage[]): Set<string> {
    const files = new Set<string>();
    messages
      .filter(msg => msg.role === "assistant" && msg.tool_calls)
      .forEach(msg => msg.tool_calls!.forEach(tc => {
        const match = tc.function.arguments.match(/"path"\s*:\s*"([^"]+)"/);
        if (match) files.add(match[1]);
      }));
    return files;
  }

  private extractLastContent(messages: ChatMessage[]): string {
    for (const msg of messages) {
      if (typeof msg.content === "string" && msg.content.length > 10) {
        return msg.content.slice(0, 200);
      }
    }
    return "";
  }

  /**
   * Get current context usage stats.
   */
  getStats(messages: ChatMessage[]): {
    estimatedTokens: number;
    maxTokens: number;
    usagePercent: number;
    summaryCount: number;
    messageCount: number;
  } {
    const estimated = estimateMessageTokens(messages);
    const max = this.config.maxContextTokens - this.config.reserveForResponse;
    return {
      estimatedTokens: estimated,
      maxTokens: max,
      usagePercent: Math.round((estimated / max) * 100),
      summaryCount: this.summaryCount,
      messageCount: messages.length,
    };
  }
}
