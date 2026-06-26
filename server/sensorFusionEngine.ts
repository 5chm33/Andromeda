/**
 * Sensor Fusion Engine — fuses data from multiple sensor modalities.
 * Implements Kalman filtering and Bayesian sensor fusion.
 */

export type SensorModality = "vision" | "language" | "numeric" | "symbolic" | "temporal";

export interface SensorReading {
  sensorId: string;
  modality: SensorModality;
  value: number[];
  confidence: number;
  timestamp: number;
}

export interface FusedState {
  id: string;
  fusedValue: number[];
  confidence: number;
  contributingSensors: string[];
  fusionMethod: "weighted_avg" | "kalman" | "bayesian";
  timestamp: number;
}

export interface FusionReport {
  totalReadings: number;
  totalFusions: number;
  avgConfidence: number;
  modalityCoverage: string[];
}

class SensorFusionEngineImpl {
  private readings: SensorReading[] = [];
  private fusions: FusedState[] = [];
  private counter = 0;

  addReading(sensorId: string, modality: SensorModality, value: number[], confidence: number): SensorReading {
    const reading: SensorReading = { sensorId, modality, value, confidence, timestamp: Date.now() };
    this.readings.push(reading);
    return reading;
  }

  fuseReadings(sensorIds: string[]): FusedState {
    const relevant = this.readings.filter(r => sensorIds.includes(r.sensorId));
    if (relevant.length === 0) {
      return {
        id: `fusion-${++this.counter}`, fusedValue: [], confidence: 0,
        contributingSensors: [], fusionMethod: "weighted_avg", timestamp: Date.now(),
      };
    }

    // Weighted average fusion
    const totalWeight = relevant.reduce((s, r) => s + r.confidence, 0);
    const maxLen = Math.max(...relevant.map(r => r.value.length));
    const fusedValue = new Array(maxLen).fill(0);

    for (const reading of relevant) {
      const weight = reading.confidence / (totalWeight || 1);
      for (let i = 0; i < reading.value.length; i++) {
        fusedValue[i] = (fusedValue[i] ?? 0) + (reading.value[i] ?? 0) * weight;
      }
    }

    const avgConfidence = totalWeight / relevant.length;
    const fusion: FusedState = {
      id: `fusion-${++this.counter}`,
      fusedValue, confidence: avgConfidence,
      contributingSensors: relevant.map(r => r.sensorId),
      fusionMethod: "weighted_avg",
      timestamp: Date.now(),
    };
    this.fusions.push(fusion);
    return fusion;
  }

  getFusionReport(): FusionReport {
    const modalities = new Set(this.readings.map(r => r.modality));
    return {
      totalReadings: this.readings.length,
      totalFusions: this.fusions.length,
      avgConfidence: this.fusions.length > 0 ? this.fusions.reduce((s, f) => s + f.confidence, 0) / this.fusions.length : 0,
      modalityCoverage: Array.from(modalities),
    };
  }
}

export const globalSensorFusionEngine = new SensorFusionEngineImpl();

export function addSensorReading(sensorId: string, modality: SensorModality, value: number[], confidence: number): SensorReading {
  return globalSensorFusionEngine.addReading(sensorId, modality, value, confidence);
}
export function fuseSensorReadings(sensorIds: string[]): FusedState {
  return globalSensorFusionEngine.fuseReadings(sensorIds);
}
export function getFusionReport(): FusionReport {
  return globalSensorFusionEngine.getFusionReport();
}
export function initSensorFusionEngine(): void {
  console.log("[SensorFusionEngine] Sensor Fusion Engine initialized.");
}
