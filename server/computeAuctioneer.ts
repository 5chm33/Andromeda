/**
 * computeAuctioneer.ts — v46.0.0
 *
 * Runs sealed-bid and Vickrey (second-price) auctions for compute resources
 * among competing sub-agents. Ensures efficient, incentive-compatible allocation.
 */

export type AuctionType = "first-price" | "vickrey";

export interface ComputeBid {
  bidderId: string;
  amount: number;       // compute credits
  resourceUnits: number; // how many units requested
  submittedAt: number;
}

export interface AuctionResult {
  auctionId: string;
  winnerId: string;
  winningBid: number;
  pricePaid: number;    // second price in Vickrey, winning bid in first-price
  resourceUnits: number;
  type: AuctionType;
}

export interface Auction {
  auctionId: string;
  resourceUnits: number;
  type: AuctionType;
  bids: ComputeBid[];
  closedAt?: number;
  result?: AuctionResult;
}

const auctions = new Map<string, Auction>();

export function createAuction(
  auctionId: string,
  resourceUnits: number,
  type: AuctionType = "vickrey"
): Auction {
  const auction: Auction = { auctionId, resourceUnits, type, bids: [] };
  auctions.set(auctionId, auction);
  console.log(`[Auctioneer] Auction ${auctionId} created (${type}, ${resourceUnits} units).`);
  return auction;
}

export function submitBid(auctionId: string, bid: ComputeBid): boolean {
  const auction = auctions.get(auctionId);
  if (!auction || auction.closedAt) return false;
  // One bid per bidder
  const existing = auction.bids.findIndex(b => b.bidderId === bid.bidderId);
  if (existing !== -1) {
    auction.bids[existing] = { ...bid, submittedAt: Date.now() };
  } else {
    auction.bids.push({ ...bid, submittedAt: Date.now() });
  }
  return true;
}

export function closeAuction(auctionId: string): AuctionResult | null {
  const auction = auctions.get(auctionId);
  if (!auction || auction.closedAt || auction.bids.length === 0) return null;

  auction.closedAt = Date.now();

  // Sort bids descending by amount
  const sorted = [...auction.bids].sort((a, b) => b.amount - a.amount);
  const winner = sorted[0];
  const secondPrice = sorted.length > 1 ? sorted[1].amount : winner.amount;

  const result: AuctionResult = {
    auctionId,
    winnerId: winner.bidderId,
    winningBid: winner.amount,
    pricePaid: auction.type === "vickrey" ? secondPrice : winner.amount,
    resourceUnits: Math.min(winner.resourceUnits, auction.resourceUnits),
    type: auction.type,
  };

  auction.result = result;
  console.log(`[Auctioneer] Auction ${auctionId} closed. Winner: ${winner.bidderId} pays ${result.pricePaid} credits.`);
  return result;
}

export function getAuction(auctionId: string): Auction | undefined {
  return auctions.get(auctionId);
}

export function getAuctionResult(auctionId: string): AuctionResult | undefined {
  return auctions.get(auctionId)?.result;
}

export function _resetAuctioneerForTest(): void {
  auctions.clear();
}
