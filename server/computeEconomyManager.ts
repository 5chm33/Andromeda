/**
 * Compute Economy Manager — token economy for module compute allocation.
 * Modules earn credits based on capability contribution; a market-clearing
 * mechanism allocates scarce compute to highest-value modules.
 */

export interface ComputeCredit {
  moduleId: string;
  balance: number;
  earned: number;
  spent: number;
  lastUpdated: number;
}

export interface ComputeRequest {
  moduleId: string;
  requestedTokens: number;
  requestedCpuMs: number;
  valuationScore: number;  // how much this module values the compute (0-1)
  bidPrice: number;        // credits willing to spend
}

export interface MarketClearingResult {
  allocations: Map<string, { tokens: number; cpuMs: number }>;
  clearingPrice: number;
  totalDemand: number;
  totalSupply: number;
  utilizationRate: number;
}

export interface EconomyReport {
  totalCreditsInCirculation: number;
  giniCoefficient: number;
  marketEfficiency: number;
  topEarners: Array<{ moduleId: string; balance: number }>;
  inflationRate: number;
}

class ComputeEconomyManager {
  private credits: Map<string, ComputeCredit> = new Map();
  private totalSupplyTokens = 100000;
  private totalSupplyCpuMs = 50000;
  private marketHistory: MarketClearingResult[] = [];
  private epoch = 0;

  earnCredits(moduleId: string, capabilityGain: number): number {
    const earned = Math.max(0, capabilityGain * 1000); // 1000 credits per unit gain
    const credit = this.credits.get(moduleId) ?? {
      moduleId, balance: 100, earned: 0, spent: 0, lastUpdated: Date.now()
    };
    credit.balance += earned;
    credit.earned += earned;
    credit.lastUpdated = Date.now();
    this.credits.set(moduleId, credit);
    return earned;
  }

  spendCredits(moduleId: string, amount: number): boolean {
    const credit = this.credits.get(moduleId);
    if (!credit || credit.balance < amount) return false;
    credit.balance -= amount;
    credit.spent += amount;
    credit.lastUpdated = Date.now();
    return true;
  }

  clearMarket(requests: ComputeRequest[]): MarketClearingResult {
    this.epoch++;
    // Sort by bid price descending (highest bidder gets resources first)
    const sorted = [...requests].sort((a, b) => b.bidPrice - a.bidPrice);

    const allocations = new Map<string, { tokens: number; cpuMs: number }>();
    let remainingTokens = this.totalSupplyTokens;
    let remainingCpu = this.totalSupplyCpuMs;
    let totalDemand = requests.reduce((s, r) => s + r.requestedTokens, 0);

    let clearingPrice = 0;
    for (const req of sorted) {
      if (remainingTokens <= 0 || remainingCpu <= 0) break;
      if (!this.spendCredits(req.moduleId, req.bidPrice)) continue;

      const allocTokens = Math.min(req.requestedTokens, remainingTokens);
      const allocCpu = Math.min(req.requestedCpuMs, remainingCpu);
      allocations.set(req.moduleId, { tokens: allocTokens, cpuMs: allocCpu });
      remainingTokens -= allocTokens;
      remainingCpu -= allocCpu;
      clearingPrice = req.bidPrice;
    }

    const result: MarketClearingResult = {
      allocations,
      clearingPrice,
      totalDemand,
      totalSupply: this.totalSupplyTokens,
      utilizationRate: (this.totalSupplyTokens - remainingTokens) / this.totalSupplyTokens,
    };

    this.marketHistory.push(result);
    if (this.marketHistory.length > 100) this.marketHistory.shift();

    console.log(`[Economy] Market cleared (epoch ${this.epoch}): ${allocations.size} modules allocated, clearing price: ${clearingPrice.toFixed(1)}, utilization: ${(result.utilizationRate * 100).toFixed(1)}%`);
    return result;
  }

  getEconomyReport(): EconomyReport {
    const allCredits = Array.from(this.credits.values());
    const totalCredits = allCredits.reduce((s, c) => s + c.balance, 0);

    // Gini coefficient
    const balances = allCredits.map(c => c.balance).sort((a, b) => a - b);
    const n = balances.length;
    const gini = n > 1
      ? balances.reduce((sum, val, i) => sum + (2 * i - n + 1) * val, 0) / (n * Math.max(totalCredits, 1))
      : 0;

    const recentMarkets = this.marketHistory.slice(-10);
    const marketEfficiency = recentMarkets.length > 0
      ? recentMarkets.reduce((s, m) => s + m.utilizationRate, 0) / recentMarkets.length
      : 0;

    const topEarners = allCredits
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5)
      .map(c => ({ moduleId: c.moduleId, balance: c.balance }));

    // Inflation: average credit creation rate
    const inflationRate = allCredits.length > 0
      ? allCredits.reduce((s, c) => s + c.earned, 0) / Math.max(this.epoch, 1) / Math.max(allCredits.length, 1)
      : 0;

    return {
      totalCreditsInCirculation: totalCredits,
      giniCoefficient: Math.abs(gini),
      marketEfficiency,
      topEarners,
      inflationRate,
    };
  }

  getBalance(moduleId: string): number {
    return this.credits.get(moduleId)?.balance ?? 0;
  }
}

export const globalComputeEconomy = new ComputeEconomyManager();

export function earnCredits(moduleId: string, capabilityGain: number): number {
  return globalComputeEconomy.earnCredits(moduleId, capabilityGain);
}

export function spendCredits(moduleId: string, amount: number): boolean {
  return globalComputeEconomy.spendCredits(moduleId, amount);
}

export function clearMarket(requests: ComputeRequest[]): MarketClearingResult {
  return globalComputeEconomy.clearMarket(requests);
}

export function getEconomyReport(): EconomyReport {
  return globalComputeEconomy.getEconomyReport();
}

export function initComputeEconomyManager(): void {
  console.log("[Economy] Compute Economy Manager initialized.");
  // Seed initial credits for core modules
  const coreModules = ["rsiEngine", "rewardModel", "selfImprove", "llmProvider", "constitutionalConstraints"];
  for (const mod of coreModules) {
    globalComputeEconomy.earnCredits(mod, 0.1); // 100 initial credits each
  }
}
