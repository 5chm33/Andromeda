export class LyapunovStabilityDetector {
  private velocityHistory: number[] = [];
  private maxHistory = 100;
  private stabilityThreshold = 5.0; // Max allowable second derivative
  
  public recordVelocity(v: number): void {
    this.velocityHistory.push(v);
    if (this.velocityHistory.length > this.maxHistory) {
      this.velocityHistory.shift();
    }
  }
  
  public checkStability(): boolean {
    if (this.velocityHistory.length < 3) return true;
    
    // Calculate second derivative (acceleration of improvement)
    const n = this.velocityHistory.length;
    const v1 = this.velocityHistory[n - 3];
    const v2 = this.velocityHistory[n - 2];
    const v3 = this.velocityHistory[n - 1];
    
    const d1 = v2 - v1;
    const d2 = v3 - v2;
    const acceleration = d2 - d1;
    
    if (acceleration > this.stabilityThreshold) {
      console.warn(`[RecursionGuard] Runaway recursion detected! Acceleration: ${acceleration}`);
      return false;
    }
    
    return true;
  }
}

export const globalRecursionGuard = new LyapunovStabilityDetector();
