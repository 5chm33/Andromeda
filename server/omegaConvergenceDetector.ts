import { runSrilCycle } from "./srilEngine";

export class OmegaConvergenceDetector {
  private capabilityHistory: number[] = [];
  private ceilingThreshold = 0.0001; // Less than 0.01% improvement over 100 cycles
  
  public recordCapabilityScore(score: number): void {
    this.capabilityHistory.push(score);
    if (this.capabilityHistory.length > 100) {
      this.capabilityHistory.shift();
    }
  }
  
  public async checkConvergence(): Promise<boolean> {
    if (this.capabilityHistory.length < 100) return false;
    
    const start = this.capabilityHistory[0];
    const end = this.capabilityHistory[99];
    const improvement = (end - start) / start;
    
    if (improvement < this.ceilingThreshold) {
      console.log(`[Omega] Capability ceiling detected. Improvement: ${improvement * 100}%`);
      console.log(`[Omega] Bootstrapping next-generation architecture via SRIL...`);
      await runSrilCycle();
      return true;
    }
    
    return false;
  }
}

export const globalOmegaDetector = new OmegaConvergenceDetector();
