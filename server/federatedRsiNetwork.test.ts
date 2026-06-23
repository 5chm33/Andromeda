/**
 * federatedRsiNetwork.test.ts — Andromeda v11.17.0 Audit 9
 * Real function-level tests for federatedRsiNetwork.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: { ok: true } }),
    get: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

import {
  registerPeer,
  getFederationStatus,
  resetFederation,
} from './federatedRsiNetwork.js';

describe('federatedRsiNetwork', () => {
  beforeEach(() => {
    resetFederation();
  });

  it('module loads without errors', async () => {
    await expect(import('./federatedRsiNetwork.js')).resolves.toBeDefined();
  });

  it('resetFederation clears all state', () => {
    registerPeer('http://peer1:3000');
    resetFederation();
    const status = getFederationStatus();
    expect(status.peers).toBe(0);
    expect(status.proposalsShared).toBe(0);
  });

  it('registerPeer adds a peer', () => {
    registerPeer('http://peer-a:3000');
    const status = getFederationStatus();
    expect(status.peers).toBeGreaterThanOrEqual(1);
  });

  it('registerPeer deduplicates peers', () => {
    registerPeer('http://peer-dup:3000');
    registerPeer('http://peer-dup:3000');
    const status = getFederationStatus();
    // Should only have 1 unique peer
    expect(status.peers).toBe(1);
  });

  it('getFederationStatus returns valid shape', () => {
    const status = getFederationStatus();
    expect(typeof status.peers).toBe('number');
    expect(typeof status.proposalsShared).toBe('number');
    expect(status.peers).toBeGreaterThanOrEqual(0);
  });

  it('getFederationStatus reflects registered peers', () => {
    registerPeer('http://peer-x:3001');
    registerPeer('http://peer-y:3002');
    const status = getFederationStatus();
    expect(status.peers).toBe(2);
  });

  it('broadcastProposal does not throw with no peers', async () => {
    const { broadcastProposal } = await import('./federatedRsiNetwork.js');
    await expect(broadcastProposal({ id: 'test', targetFile: 'x.ts' })).resolves.not.toThrow();
  });
});
