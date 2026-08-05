/**
 * federatedRsiNetwork.ts — Federated RSI Network (v10.7.0)
 * HTTP gossip peer network for sharing RSI proposals between instances.
 */
import axios from 'axios';

export interface FederationStatus {
  peers: number;
  activePeers: number;
  proposalsShared: number;
}

const peers = new Set<string>();
let proposalsShared = 0;

export function registerPeer(url: string): void {
  try {
    const parsedUrl = new URL(url);
    peers.add(parsedUrl.origin);
  } catch (e) {
    console.error(`Invalid peer URL: ${url}`);
  }
}

export async function broadcastProposal(proposal: object): Promise<void> {
  if (!peers || peers.size === 0) return;
  const promises = Array.from(peers).map(async (peer) => {
    try {
      await axios.post(`${peer}/api/rsi/federation/proposal`, proposal, { timeout: 5000 });
      proposalsShared++;
    } catch (e) {
      // Peer might be down, ignore
    }
  });
  
  await Promise.allSettled(promises);
}

export async function syncWithPeers(): Promise<object[]> {
  const allProposals: object[] = [];
  
  const promises = Array.from(peers).map(async (peer) => {
    try {
      const response = await axios.get(`${peer}/api/rsi/federation/sync`, { timeout: 5000 });
      if (Array.isArray(response.data)) {
        allProposals.push(...response.data);
      }
    } catch (e) {
      // Peer might be down, ignore
    }
  });
  
  await Promise.allSettled(promises);
  return allProposals;
}

export function getFederationStatus(): FederationStatus {
  return {
    peers: peers.size,
    activePeers: peers.size, // In a real implementation, we'd track health
    proposalsShared
  };
}

export function resetFederation(): void {
  peers.clear();
  proposalsShared = 0;
}
