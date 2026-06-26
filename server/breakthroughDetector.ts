/**
 * Breakthrough Detector — identifies phase transitions and capability jumps.
 * Uses change-point detection (CUSUM) and statistical significance testing.
 */

export interface BreakthroughEvent {
  id: string;
  dimension: string;
  detectedAt: number;
  cycleNumber: number;
  magnitudeMultiplier: number;  // how many sigma above baseline
  isVerified: boolean;
  description: string;
  priorMean: number;
  postMean: number;
}

export interface CUSUMState {
  dimension: string;
  cusum: number;
  baseline: number;
  threshold: number;
  consecutiveAbove: number;
}

export interface BreakthroughReport {
  totalDetected: number;
  verifiedBreakthroughs: number;
  avgMagnitude: number;
  mostRecentBreakthrough: BreakthroughEvent | null;
  dimensionsWithBreakthroughs: string[];
}

class BreakthroughDetectorEngine {
  private events: BreakthroughEvent[] = [];
  private cusumStates: Map<string, CUSUMState> = new Map();
  private history: Map<string, number[]> = new Map();
  private counter = 0;

  updateCUSUM(dimension: string, value: number, cycleNumber: number): BreakthroughEvent | null {
    if (!this.cusumStates.has(dimension)) {
      this.cusumStates.set(dimension, { dimension, cusum: 0, baseline: value, threshold: 5.0, consecutiveAbove: 0 });
    }
    if (!this.history.has(dimension)) this.history.set(dimension, []);

    const hist = this.history.get(dimension)!;
    hist.push(value);
    if (hist.length > 1000) hist.shift();

    const state = this.cusumStates.get(dimension)!;
    // Update baseline using exponential moving average
    state.baseline = state.baseline * 0.99 + value * 0.01;

    // CUSUM: accumulate positive deviations
    const std = this._computeStd(hist.slice(-50));
    const deviation = std > 0 ? (value - state.baseline) / std : 0;
    state.cusum = Math.max(0, state.cusum + deviation - 0.5);

    if (state.cusum > state.threshold) {
      state.consecutiveAbove++;
      if (state.consecutiveAbove >= 3) {
        // Breakthrough detected!
        const priorValues = hist.slice(-20, -3);
        const postValues = hist.slice(-3);
        const priorMean = priorValues.reduce((a, b) => a + b, 0) / Math.max(priorValues.length, 1);
        const postMean = postValues.reduce((a, b) => a + b, 0) / Math.max(postValues.length, 1);

        const event: BreakthroughEvent = {
          id: `breakthrough-${++this.counter}`,
          dimension,
          detectedAt: Date.now(),
          cycleNumber,
          magnitudeMultiplier: state.cusum,
          isVerified: false,
          description: `Phase transition in '${dimension}': ${priorMean.toFixed(6)} → ${postMean.toFixed(6)} (${((postMean / Math.max(priorMean, 1e-10) - 1) * 100).toFixed(1)}% jump)`,
          priorMean,
          postMean,
        };
        this.events.push(event);
        state.cusum = 0; // Reset after detection
        state.consecutiveAbove = 0;
        // [Breakthrough] ${event.description}`);
        return event;
      }
    } else {
      state.consecutiveAbove = 0;
    }
    return null;
  }

  private _computeStd(values: number[]): number {
    if (values.length < 2) return 0.001;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
  }

  verifyBreakthrough(eventId: string, additionalEvidence: number[]): boolean {
    const event = this.events.find(e => e.id === eventId);
    if (!event) return false;
    // Verify: post-breakthrough values consistently above prior mean
    const verified = additionalEvidence.every(v => v > event.priorMean);
    event.isVerified = verified;
    return verified;
  }

  getBreakthroughReport(): BreakthroughReport {
    const verified = this.events.filter(e => e.isVerified);
    const recent = this.events[this.events.length - 1] ?? null;
    const dimensions = [...new Set(this.events.map(e => e.dimension))];
    return {
      totalDetected: this.events.length,
      verifiedBreakthroughs: verified.length,
      avgMagnitude: this.events.length > 0
        ? this.events.reduce((s, e) => s + e.magnitudeMultiplier, 0) / this.events.length
        : 0,
      mostRecentBreakthrough: recent,
      dimensionsWithBreakthroughs: dimensions,
    };
  }

  getEvents(): BreakthroughEvent[] { return [...this.events]; }
}

export const globalBreakthroughDetector = new BreakthroughDetectorEngine();

export function updateCUSUM(dimension: string, value: number, cycleNumber: number): BreakthroughEvent | null {
  return globalBreakthroughDetector.updateCUSUM(dimension, value, cycleNumber);
}
export function verifyBreakthrough(eventId: string, additionalEvidence: number[]): boolean {
  return globalBreakthroughDetector.verifyBreakthrough(eventId, additionalEvidence);
}
export function getBreakthroughReport(): BreakthroughReport {
  return globalBreakthroughDetector.getBreakthroughReport();
}
export function initBreakthroughDetector(): void {
  console.log("[Breakthrough] Breakthrough Detector initialized.");
}
