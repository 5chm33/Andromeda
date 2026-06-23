/**
 * contextBus.ts — Shared Context Bus for Multi-Agent Communication
 *
 * Provides a pub/sub event bus that allows agents in the orchestrator to:
 *   1. Publish context updates (findings, progress, artifacts) to shared channels
 *   2. Subscribe to other agents' context updates in real-time
 *   3. Query the shared context store for cross-agent knowledge
 *   4. Coordinate handoffs and avoid duplicate work
 *
 * Integrations:
 *   - agentOrchestrator.ts: Agents publish/subscribe during team execution
 *   - reactEngine.ts: ReAct loop can read shared context for multi-step tasks
 *   - memory.ts: Important shared context is persisted to long-term memory
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContextEntryType =
  | "finding"       // A factual discovery or result
  | "progress"      // Status update on task progress
  | "artifact"      // A produced artifact (code, file, text)
  | "question"      // A question for other agents
  | "answer"        // An answer to a question
  | "handoff"       // Handing a sub-task to another agent
  | "warning"       // A warning or concern
  | "decision"      // A decision that affects other agents
  | "dependency";   // A dependency declaration

export type ContextEntry = {
  id: string;
  channel: string;           // Channel name (e.g., "research", "code", "review")
  agentId: string;           // Who published this
  agentRole: string;         // Role of the publishing agent
  type: ContextEntryType;
  title: string;             // Short summary
  content: string;           // Full content
  metadata: Record<string, unknown>;
  replyTo?: string;          // ID of entry this is replying to
  tags: string[];
  timestamp: number;
  readBy: Set<string>;       // Agent IDs that have read this
};

export type Channel = {
  name: string;
  description: string;
  subscribers: Set<string>;  // Agent IDs subscribed
  createdAt: number;
  entryCount: number;
};

export type ContextSubscription = {
  id: string;
  agentId: string;
  channel: string;
  filter?: {
    types?: ContextEntryType[];
    fromAgents?: string[];
    tags?: string[];
  };
  callback?: (entry: ContextEntry) => void;
  createdAt: number;
};

export type ContextQuery = {
  channels?: string[];
  types?: ContextEntryType[];
  fromAgents?: string[];
  tags?: string[];
  since?: number;
  limit?: number;
  unreadOnly?: boolean;
  forAgent?: string;
};

export type AgentWorkClaim = {
  agentId: string;
  taskDescription: string;
  channel: string;
  claimedAt: number;
  expiresAt: number;
};

export type BusStats = {
  totalEntries: number;
  totalChannels: number;
  totalSubscriptions: number;
  activeAgents: string[];
  entriesByType: Record<string, number>;
  entriesByChannel: Record<string, number>;
  activeClaims: number;
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const entries: ContextEntry[] = [];
const channels = new Map<string, Channel>();
const subscriptions = new Map<string, ContextSubscription>();
const workClaims: AgentWorkClaim[] = [];
const MAX_ENTRIES = 5000;
const MAX_CLAIMS = 200;
const MAX_AGE_MS = 30 * 60 * 1000; // v5.32: Evict entries older than 30 minutes
// Eviction interval handled by MAX_SUBSCRIPTIONS cap (see subscribe())

// ─── Channel Management ──────────────────────────────────────────────────────

function ensureChannel(name: string, description?: string): Channel {
  let channel = channels.get(name);
  if (!channel) {
    channel = {
      name,
      description: description || `Channel: ${name}`,
      subscribers: new Set(),
      createdAt: Date.now(),
      entryCount: 0,
    };
    channels.set(name, channel);
  }
  return channel;
}

export function createChannel(name: string, description: string): Channel {
  return ensureChannel(name, description);
}

export function listChannels(): Array<Omit<Channel, "subscribers"> & { subscribers: string[] }> {
  return Array.from(channels.values()).map(ch => ({
    ...ch,
    subscribers: Array.from(ch.subscribers),
  }));
}

export function deleteChannel(name: string): boolean {
  // Remove all entries in this channel
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].channel === name) entries.splice(i, 1);
  }
  // Remove subscriptions for this channel
  for (const [id, sub] of Array.from(subscriptions.entries())) {
    if (sub.channel === name) subscriptions.delete(id);
  }
  return channels.delete(name);
}

// ─── Publishing ──────────────────────────────────────────────────────────────

export function publish(opts: {
  channel: string;
  agentId: string;
  agentRole: string;
  type: ContextEntryType;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  replyTo?: string;
  tags?: string[];
}): ContextEntry {
  const channel = ensureChannel(opts.channel);

  const entry: ContextEntry = {
    id: randomUUID(),
    channel: opts.channel,
    agentId: opts.agentId,
    agentRole: opts.agentRole,
    type: opts.type,
    title: opts.title,
    content: opts.content,
    metadata: opts.metadata || {},
    replyTo: opts.replyTo,
    tags: opts.tags || [],
    timestamp: Date.now(),
    readBy: new Set([opts.agentId]), // Publisher has read it
  };

  entries.push(entry);
  channel.entryCount++;

  // Evict old entries (size-based)
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }

  // v5.32: Age-based eviction — remove entries older than MAX_AGE_MS
  const now = Date.now();
  const cutoff = now - MAX_AGE_MS;
  let ageEvicted = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].timestamp < cutoff) {
      entries.splice(i, 1);
      ageEvicted++;
    }
  }
  if (ageEvicted > 0) {
    console.log(`[ContextBus] Age-evicted ${ageEvicted} entries older than ${MAX_AGE_MS / 60000}min`);
  }

  // Notify subscribers
  for (const sub of Array.from(subscriptions.values())) {
    if (sub.channel !== opts.channel) continue;
    if (sub.agentId === opts.agentId) continue; // Don't notify self

    // Apply filters
    if (sub.filter) {
      if (sub.filter.types && !sub.filter.types.includes(opts.type)) continue;
      if (sub.filter.fromAgents && !sub.filter.fromAgents.includes(opts.agentId)) continue;
      if (sub.filter.tags && opts.tags && !opts.tags.some(t => sub.filter!.tags!.includes(t))) continue;
    }

    // Fire callback if registered
    if (sub.callback) {
      try { sub.callback(entry); } catch { /* swallow */ }
    }
  }

  return entry;
}

// ─── Subscribing ─────────────────────────────────────────────────────────────

export function subscribe(opts: {
  agentId: string;
  channel: string;
  filter?: ContextSubscription["filter"];
  callback?: (entry: ContextEntry) => void;
}): ContextSubscription {
  const channel = ensureChannel(opts.channel);
  channel.subscribers.add(opts.agentId);

  const sub: ContextSubscription = {
    id: randomUUID(),
    agentId: opts.agentId,
    channel: opts.channel,
    filter: opts.filter,
    callback: opts.callback,
    createdAt: Date.now(),
  };

  subscriptions.set(sub.id, sub);
  return sub;
}

export function unsubscribe(subscriptionId: string): boolean {
  const sub = subscriptions.get(subscriptionId);
  if (!sub) return false;

  const channel = channels.get(sub.channel);
  if (channel) {
    // Only remove from subscribers if no other subscriptions for this agent+channel
    const otherSubs = Array.from(subscriptions.values()).filter(
      s => s.id !== subscriptionId && s.agentId === sub.agentId && s.channel === sub.channel
    );
    if (otherSubs.length === 0) {
      channel.subscribers.delete(sub.agentId);
    }
  }

  return subscriptions.delete(subscriptionId);
}

export function unsubscribeAgent(agentId: string): number {
  let count = 0;
  for (const [id, sub] of Array.from(subscriptions.entries())) {
    if (sub.agentId === agentId) {
      subscriptions.delete(id);
      count++;
    }
  }
  // Remove from all channel subscriber lists
  for (const channel of Array.from(channels.values())) {
    channel.subscribers.delete(agentId);
  }
  return count;
}

// ─── Querying ────────────────────────────────────────────────────────────────

export function query(q: ContextQuery): ContextEntry[] {
  if (!q) return [];
  let results = [...entries];

  if (q.channels && q.channels.length > 0) {
    results = results.filter(e => q.channels!.includes(e.channel));
  }
  if (q.types && q.types.length > 0) {
    results = results.filter(e => q.types!.includes(e.type));
  }
  if (q.fromAgents && q.fromAgents.length > 0) {
    results = results.filter(e => q.fromAgents!.includes(e.agentId));
  }
  if (q.tags && q.tags.length > 0) {
    results = results.filter(e => e.tags.some(t => q.tags!.includes(t)));
  }
  if (q.since) {
    results = results.filter(e => e.timestamp >= q.since!);
  }
  if (q.unreadOnly && q.forAgent) {
    results = results.filter(e => !e.readBy.has(q.forAgent!));
  }

  // Sort newest first
  results.sort((a, b) => b.timestamp - a.timestamp);

  if (q.limit) {
    results = results.slice(0, q.limit);
  }

  return results;
}

/**
 * Mark entries as read by a specific agent.
 */
export function markRead(agentId: string, entryIds: string[]): number {
  let count = 0;
  for (const entry of entries) {
    if (entryIds.includes(entry.id) && !entry.readBy.has(agentId)) {
      entry.readBy.add(agentId);
      count++;
    }
  }
  return count;
}

/**
 * Get unread count for an agent across all subscribed channels.
 */
export function getUnreadCount(agentId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sub of Array.from(subscriptions.values())) {
    if (sub.agentId !== agentId) continue;
    const unread = entries.filter(
      e => e.channel === sub.channel && !e.readBy.has(agentId) && e.agentId !== agentId
    ).length;
    counts[sub.channel] = (counts[sub.channel] || 0) + unread;
  }
  return counts;
}

// ─── Work Coordination (Avoid Duplicate Work) ────────────────────────────────

/**
 * Claim a piece of work so other agents know not to duplicate it.
 */
export function claimWork(agentId: string, taskDescription: string, channel: string, ttlMs: number = 5 * 60 * 1000): AgentWorkClaim | null {
  if (!agentId || !taskDescription || !channel) return null;
  // Check if similar work is already claimed
  const now = Date.now();
  const activeClaims = workClaims.filter(c => c.expiresAt > now);

  const descLower = taskDescription.toLowerCase();
  const duplicate = activeClaims.find(c => {
    const claimLower = c.taskDescription.toLowerCase();
    // Simple overlap check
    const words = descLower.split(/\s+/).filter(w => w.length > 3);
    const matchCount = words.filter(w => claimLower.includes(w)).length;
    return matchCount / Math.max(words.length, 1) > 0.6;
  });

  if (duplicate) return null; // Already claimed

  const claim: AgentWorkClaim = {
    agentId,
    taskDescription,
    channel,
    claimedAt: now,
    expiresAt: now + ttlMs,
  };

  workClaims.push(claim);
  if (workClaims.length > MAX_CLAIMS) {
    workClaims.splice(0, workClaims.length - MAX_CLAIMS);
  }

  // Also publish to the channel
  publish({
    channel,
    agentId,
    agentRole: "worker",
    type: "handoff",
    title: `Work claimed: ${taskDescription.substring(0, 80)}`,
    content: taskDescription,
    tags: ["work-claim"],
  });

  return claim;
}

/**
 * Release a work claim (e.g., when done or giving up).
 */
export function releaseWork(agentId: string, taskDescription: string): boolean {
  const idx = workClaims.findIndex(
    c => c.agentId === agentId && c.taskDescription === taskDescription
  );
  if (idx === -1) return false;
  workClaims.splice(idx, 1);
  return true;
}

/**
 * Get all active work claims.
 */
export function getActiveClaims(): AgentWorkClaim[] {
  const now = Date.now();
  return workClaims.filter(c => c.expiresAt > now);
}

// ─── Context Summary (for injection into agent prompts) ──────────────────────

/**
 * Generate a summary of recent shared context for an agent.
 * This gets injected into the agent's system prompt so it knows
 * what other agents have found/done.
 */
export function getContextSummaryForAgent(agentId: string, maxEntries: number = 10): string {
  const agentSubs = Array.from(subscriptions.values()).filter(s => s.agentId === agentId);
  if (agentSubs.length === 0) return "";

  const subscribedChannels = Array.from(new Set(agentSubs.map(s => s.channel)));
  const recent = query({
    channels: subscribedChannels,
    limit: maxEntries,
  });

  if (recent.length === 0) return "";

  const lines: string[] = ["## Shared Context from Other Agents"];

  for (const entry of recent) {
    const readStatus = entry.readBy.has(agentId) ? "" : " [NEW]";
    const prefix = entry.agentId === agentId ? "(you)" : `[${entry.agentRole}]`;
    lines.push(`- ${prefix} ${entry.type}: ${entry.title}${readStatus}`);
    if (entry.content.length > 200) {
      lines.push(`  ${entry.content.substring(0, 200)}...`);
    } else {
      lines.push(`  ${entry.content}`);
    }
  }

  // Show active work claims
  const claims = getActiveClaims().filter(c => c.agentId !== agentId);
  if (claims.length > 0) {
    lines.push("\n## Work Already Claimed by Others");
    for (const claim of claims) {
      lines.push(`- ${claim.agentId}: ${claim.taskDescription.substring(0, 100)}`);
    }
  }

  return lines.join("\n");
}

// ─── Thread Support ──────────────────────────────────────────────────────────

/**
 * Get a conversation thread starting from a root entry.
 */
export function getThread(rootEntryId: string): ContextEntry[] {
  const thread: ContextEntry[] = [];
  const root = entries.find(e => e.id === rootEntryId);
  if (!root) return thread;

  thread.push(root);

  // Find all replies (direct and nested)
  const visited = new Set<string>([rootEntryId]);
  let frontier = [rootEntryId];

  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    for (const parentId of frontier) {
      const replies = entries.filter(e => e.replyTo === parentId && !visited.has(e.id));
      for (const reply of replies) {
        visited.add(reply.id);
        thread.push(reply);
        nextFrontier.push(reply.id);
      }
    }
    frontier = nextFrontier;
  }

  // Sort by timestamp
  thread.sort((a, b) => a.timestamp - b.timestamp);
  return thread;
}

// ─── Stats & Diagnostics ────────────────────────────────────────────────────

export function getBusStats(): BusStats {
  const entriesByType: Record<string, number> = {};
  const entriesByChannel: Record<string, number> = {};
  const activeAgentSet = new Set<string>();

  for (const entry of entries) {
    entriesByType[entry.type] = (entriesByType[entry.type] || 0) + 1;
    entriesByChannel[entry.channel] = (entriesByChannel[entry.channel] || 0) + 1;
    activeAgentSet.add(entry.agentId);
  }

  return {
    totalEntries: entries.length,
    totalChannels: channels.size,
    totalSubscriptions: subscriptions.size,
    activeAgents: Array.from(activeAgentSet),
    entriesByType,
    entriesByChannel,
    activeClaims: getActiveClaims().length,
  };
}

/**
 * Reset the entire bus. Useful for testing.
 */
export function resetBus(): void {
  entries.length = 0;
  channels.clear();
  subscriptions.clear();
  workClaims.length = 0;
}

// ─── v5.25: Context Bus Persistence ──────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUS_PERSIST_PATH = path.join(__dirname, "../data/context_bus.json");

/**
 * Save the current bus state to disk for cross-session persistence.
 * Only persists entries (channels and subscriptions are ephemeral).
 */
export function persistBus(): void {
  try {
    const dir = path.dirname(BUS_PERSIST_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Only persist the last 500 entries to avoid unbounded growth
    const persistEntries = entries.slice(-500).map(e => ({
      id: e.id,
      type: e.type,
      channel: e.channel,
      agentId: e.agentId,
      content: e.content,
      timestamp: e.timestamp,
      metadata: e.metadata,
      replyTo: e.replyTo,
    }));

    fs.writeFileSync(BUS_PERSIST_PATH, JSON.stringify({ entries: persistEntries, savedAt: Date.now() }, null, 2));
  } catch (err) {
    console.warn("[ContextBus] Persist failed:", (err as Error).message);
  }
}

/**
 * Load previously persisted bus state on startup.
 */
export function loadPersistedBus(): number {
  try {
    if (!fs.existsSync(BUS_PERSIST_PATH)) return 0;
    const raw = fs.readFileSync(BUS_PERSIST_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (data.entries && Array.isArray(data.entries)) {
      // Only load entries from the last 24 hours
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const recent = data.entries.filter((e: any) => e.timestamp > cutoff);
      for (const entry of recent) {
        // v5.35: Restore readBy as Set (JSON serializes Sets as arrays or omits them)
        entry.readBy = new Set(Array.isArray(entry.readBy) ? entry.readBy : []);
        entry.tags = Array.isArray(entry.tags) ? entry.tags : [];
        entries.push(entry as ContextEntry);
      }
      return recent.length;
    }
    return 0;
  } catch (err) {
    console.warn("[ContextBus] Load failed:", (err as Error).message);
    return 0;
  }
}

// Auto-persist every 5 minutes
setInterval(() => {
  if (entries.length > 0) persistBus();
}, 5 * 60 * 1000);

// v5.27: Crash-safe persistence — persist on process exit signals
try {
  process.on("SIGTERM", () => { try { persistBus(); } catch {} });
  process.on("SIGINT", () => { try { persistBus(); } catch {} });
  process.on("beforeExit", () => { try { persistBus(); } catch {} });
} catch { /* non-fatal in test environments */ }

// Load on module init
const loadedCount = loadPersistedBus();
if (loadedCount > 0) {
  console.log(`[ContextBus] Restored ${loadedCount} entries from previous session`);
}

// v5.26: Alias for diagnostics endpoint
export const getContextBusStats = getBusStats;
