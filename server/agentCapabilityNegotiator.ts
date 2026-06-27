/**
 * agentCapabilityNegotiator.ts — v86.0.0 "Multi-Agent Coordination"
 * Negotiates capability contracts between agents for task delegation and collaboration.
 */
export type NegotiationStatus = "proposed" | "accepted" | "rejected" | "countered" | "expired";

export interface CapabilityOffer {
  offerId: string;
  fromAgentId: string;
  toAgentId: string;
  capabilityName: string;
  maxThroughput: number;
  latencySlaMs: number;
  costPerCall: number;
  validUntil: number;
}

export interface NegotiationContract {
  contractId: string;
  offerId: string;
  fromAgentId: string;
  toAgentId: string;
  capabilityName: string;
  agreedThroughput: number;
  agreedLatencySlaMs: number;
  agreedCostPerCall: number;
  status: NegotiationStatus;
  createdAt: number;
  expiresAt: number;
}

const offers = new Map<string, CapabilityOffer>();
const contracts = new Map<string, NegotiationContract>();
let offerCounter = 0;
let contractCounter = 0;

export function makeOffer(fromAgentId: string, toAgentId: string, capabilityName: string, maxThroughput: number, latencySlaMs: number, costPerCall: number, ttlMs = 60000): CapabilityOffer {
  const offer: CapabilityOffer = {
    offerId: `offer-${++offerCounter}`,
    fromAgentId, toAgentId, capabilityName,
    maxThroughput, latencySlaMs, costPerCall,
    validUntil: Date.now() + ttlMs,
  };
  offers.set(offer.offerId, offer);
  return offer;
}

export function acceptOffer(offerId: string, requestedThroughput?: number): NegotiationContract | null {
  const offer = offers.get(offerId);
  if (!offer || offer.validUntil < Date.now()) return null;

  const agreedThroughput = requestedThroughput ? Math.min(requestedThroughput, offer.maxThroughput) : offer.maxThroughput;
  const contract: NegotiationContract = {
    contractId: `contract-${++contractCounter}`,
    offerId,
    fromAgentId: offer.fromAgentId,
    toAgentId: offer.toAgentId,
    capabilityName: offer.capabilityName,
    agreedThroughput,
    agreedLatencySlaMs: offer.latencySlaMs,
    agreedCostPerCall: offer.costPerCall,
    status: "accepted",
    createdAt: Date.now(),
    expiresAt: offer.validUntil,
  };
  contracts.set(contract.contractId, contract);
  return contract;
}

export function rejectOffer(offerId: string): boolean {
  const offer = offers.get(offerId);
  if (!offer) return false;
  offers.delete(offerId);
  return true;
}

export function getActiveContracts(agentId: string): NegotiationContract[] {
  return [...contracts.values()].filter(c => (c.fromAgentId === agentId || c.toAgentId === agentId) && c.status === "accepted" && c.expiresAt > Date.now());
}

export function getOffer(offerId: string): CapabilityOffer | undefined { return offers.get(offerId); }
export function _resetCapabilityNegotiatorForTest(): void { offers.clear(); contracts.clear(); offerCounter = 0; contractCounter = 0; }
