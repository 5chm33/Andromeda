/**
 * Resource Auctioneer — allocates compute resources via auction mechanisms.
 * Implements Vickrey-Clarke-Groves (VCG) auctions for efficient resource allocation.
 */

export interface ResourceBid {
  bidderId: string;
  resourceType: "cpu" | "memory" | "gpu" | "network";
  quantity: number;
  maxWillingnessToPay: number;
  priority: number;  // 1=highest
  deadline: number;
}

export interface AuctionResult {
  auctionId: string;
  resourceType: string;
  winners: Array<{ bidderId: string; allocatedQuantity: number; pricePaid: number }>;
  totalAllocated: number;
  totalRevenue: number;
  efficiency: number;  // 0-1, social welfare maximized
  timestamp: number;
}

export interface AuctionReport {
  totalAuctions: number;
  avgEfficiency: number;
  totalResourcesAllocated: number;
  mostContested: string;
}

class ResourceAuctioneerEngine {
  private auctions: AuctionResult[] = [];
  private counter = 0;
  private readonly RESOURCE_CAPACITY: Record<string, number> = {
    cpu: 100, memory: 1024, gpu: 8, network: 10000,
  };

  runAuction(resourceType: ResourceBid["resourceType"], bids: ResourceBid[]): AuctionResult {
    const capacity = this.RESOURCE_CAPACITY[resourceType] ?? 100;
    // Sort by willingness to pay (descending) — VCG-style
    const sorted = [...bids].sort((a, b) => b.maxWillingnessToPay - a.maxWillingnessToPay);

    const winners: AuctionResult["winners"] = [];
    let remaining = capacity;
    let totalRevenue = 0;
    let socialWelfare = 0;

    for (let i = 0; i < sorted.length && remaining > 0; i++) {
      const bid = sorted[i]!;
      const allocated = Math.min(bid.quantity, remaining);
      // VCG price = next highest bid (second-price)
      const nextBid = sorted[i + 1]?.maxWillingnessToPay ?? 0;
      const pricePaid = nextBid * (allocated / bid.quantity);
      winners.push({ bidderId: bid.bidderId, allocatedQuantity: allocated, pricePaid });
      totalRevenue += pricePaid;
      socialWelfare += bid.maxWillingnessToPay * (allocated / bid.quantity);
      remaining -= allocated;
    }

    const maxPossibleWelfare = sorted.reduce((s, b) => s + b.maxWillingnessToPay, 0);
    const efficiency = maxPossibleWelfare > 0 ? socialWelfare / maxPossibleWelfare : 1;

    const result: AuctionResult = {
      auctionId: `auction-${++this.counter}`,
      resourceType, winners,
      totalAllocated: capacity - remaining,
      totalRevenue, efficiency,
      timestamp: Date.now(),
    };
    this.auctions.push(result);
    return result;
  }

  getAuctionReport(): AuctionReport {
    const resourceCounts = this.auctions.reduce((acc, a) => {
      acc[a.resourceType] = (acc[a.resourceType] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const mostContested = Object.entries(resourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
    return {
      totalAuctions: this.auctions.length,
      avgEfficiency: this.auctions.length > 0
        ? this.auctions.reduce((s, a) => s + a.efficiency, 0) / this.auctions.length
        : 0,
      totalResourcesAllocated: this.auctions.reduce((s, a) => s + a.totalAllocated, 0),
      mostContested,
    };
  }
}

export const globalResourceAuctioneer = new ResourceAuctioneerEngine();

export function runResourceAuction(resourceType: ResourceBid["resourceType"], bids: ResourceBid[]): AuctionResult {
  return globalResourceAuctioneer.runAuction(resourceType, bids);
}
export function getAuctionReport(): AuctionReport {
  return globalResourceAuctioneer.getAuctionReport();
}
export function initResourceAuctioneer(): void {
  console.log("[ResourceAuctioneer] Resource Auctioneer initialized with VCG mechanism.");
}
