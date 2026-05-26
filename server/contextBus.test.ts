/**
 * Andromeda v6.12 — Context Bus Tests
 *
 * Tests for the inter-agent communication system:
 *  - Channel CRUD
 *  - Pub/sub messaging
 *  - Query filtering
 *  - Subscription management
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  createChannel,
  listChannels,
  deleteChannel,
  publish,
  subscribe,
  unsubscribe,
  unsubscribeAgent,
  query,
} from "./contextBus.js";

describe("contextBus — Channel Management", () => {
  const testChannel = `test_channel_${Date.now()}`;

  it("createChannel returns a channel object", () => {
    const ch = createChannel(testChannel, "A test channel");
    expect(ch).toHaveProperty("name", testChannel);
    expect(ch).toHaveProperty("description", "A test channel");
  });

  it("listChannels includes created channel", () => {
    const channels = listChannels();
    expect(Array.isArray(channels)).toBe(true);
    const found = channels.find(c => c.name === testChannel);
    expect(found).toBeDefined();
  });

  it("deleteChannel removes the channel", () => {
    const name = `del_test_${Date.now()}`;
    createChannel(name, "to be deleted");
    const result = deleteChannel(name);
    expect(result).toBe(true);
    const channels = listChannels();
    expect(channels.find(c => c.name === name)).toBeUndefined();
  });

  it("deleteChannel returns false for non-existent channel", () => {
    const result = deleteChannel("non_existent_channel_xyz");
    expect(result).toBe(false);
  });
});

describe("contextBus — Pub/Sub", () => {
  const channelName = `pubsub_test_${Date.now()}`;

  it("publish adds an entry to the channel", () => {
    createChannel(channelName, "pubsub test");
    publish({
      channel: channelName,
      agentId: "test-agent",
      type: "observation",
      content: "Test observation",
    });
    const entries = query({ channel: channelName });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].content).toBe("Test observation");
  });

  it("subscribe returns a subscription ID", () => {
    const sub = subscribe({
      channel: channelName,
      agentId: "subscriber-1",
      callback: () => {},
    });
    // subscribe() returns a ContextSubscription object with an id property
    expect(sub).toBeDefined();
    expect(typeof sub.id).toBe("string");
    expect(sub.id.length).toBeGreaterThan(0);
  });

  it("unsubscribe removes a subscription", () => {
    const sub = subscribe({
      channel: channelName,
      agentId: "subscriber-2",
      callback: () => {},
    });
    const result = unsubscribe(sub.id);
    expect(result).toBe(true);
  });

  it("unsubscribe returns false for invalid ID", () => {
    const result = unsubscribe("invalid-sub-id");
    expect(result).toBe(false);
  });

  it("unsubscribeAgent removes all subscriptions for an agent", () => {
    subscribe({ channel: channelName, agentId: "bulk-agent", callback: () => {} });
    subscribe({ channel: channelName, agentId: "bulk-agent", callback: () => {} });
    const count = unsubscribeAgent("bulk-agent");
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

describe("contextBus — Query", () => {
  const channelName = `query_test_${Date.now()}`;

  it("query returns entries filtered by channel", () => {
    createChannel(channelName, "query test");
    publish({ channel: channelName, agentId: "agent-a", type: "decision", content: "Decided X" });
    publish({ channel: channelName, agentId: "agent-b", type: "observation", content: "Observed Y" });

    const results = query({ channel: channelName });
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("query filters by type", () => {
    const results = query({ channels: [channelName], types: ["decision"] });
    for (const entry of results) {
      expect(entry.type).toBe("decision");
    }
  });

  it("query filters by agentId", () => {
    const results = query({ channels: [channelName], fromAgents: ["agent-a"] });
    for (const entry of results) {
      expect(entry.agentId).toBe("agent-a"); // fromAgents filter
    }
  });

  it("query with limit returns at most N entries", () => {
    const results = query({ channels: [channelName], limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });
});
