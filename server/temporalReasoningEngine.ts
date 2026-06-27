import fs from "fs";
import path from "path";

const TEMPORAL_GRAPH_DB = path.join(process.cwd(), "data", "temporal_graph.json");
let _nodeCounter = 0;

export interface TemporalNode {
  id: string;
  timestamp: number;
  action: string;
  targetFile: string;
  outcomeMetric: number;
  causalParents: string[]; // IDs of prior nodes that caused this
}

function loadTemporalGraph(): Record<string, TemporalNode> {
  if (fs.existsSync(TEMPORAL_GRAPH_DB)) {
    try {
      return JSON.parse(fs.readFileSync(TEMPORAL_GRAPH_DB, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveTemporalGraph(graph: Record<string, TemporalNode>) {
  const dir = path.dirname(TEMPORAL_GRAPH_DB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TEMPORAL_GRAPH_DB, JSON.stringify(graph, null, 2));
}

/**
 * Records a new event in the temporal causal graph.
 */
export function recordTemporalEvent(action: string, targetFile: string, outcomeMetric: number, causalParents: string[] = []): string {
  const graph = loadTemporalGraph();
  const id = `te_${Date.now()}_${++_nodeCounter}`;
  
  const node: TemporalNode = {
    id,
    timestamp: Date.now(),
    action,
    targetFile,
    outcomeMetric,
    causalParents
  };
  
  graph[id] = node;
  saveTemporalGraph(graph);
  return id;
}

/**
 * Performs counterfactual temporal reasoning ("what if we had done X 3 weeks ago?").
 * Returns the estimated difference in outcome metric.
 */
export function evaluateCounterfactual(targetFile: string, alternativeAction: string): number {
  const graph = loadTemporalGraph();
  const nodes = Object.values(graph).filter(n => n.targetFile === targetFile);
  
  if (nodes.length === 0) return 0.0;
  
  // Find similar historical situations where the alternative action was taken
  const similarNodes = Object.values(graph).filter(n => n.action === alternativeAction);
  
  if (similarNodes.length === 0) return 0.0; // Cannot evaluate without historical data
  
  // Calculate average outcome for the alternative action
  const avgAlternativeOutcome = similarNodes.reduce((sum, n) => sum + n.outcomeMetric, 0) / similarNodes.length;
  
  // Calculate average outcome for the actual actions taken on this file
  const avgActualOutcome = nodes.reduce((sum, n) => sum + n.outcomeMetric, 0) / nodes.length;
  
  // Return the counterfactual delta
  const delta = avgAlternativeOutcome - avgActualOutcome;
  console.log(`[TemporalReasoning] Counterfactual evaluation for ${targetFile}: taking action '${alternativeAction}' would yield estimated delta of ${delta > 0 ? '+' : ''}${delta.toFixed(3)}`);
  
  return delta;
}

/**
 * Detects temporal drift in codebase health.
 * Returns true if the recent trend is significantly worse than the historical baseline.
 */
export function detectTemporalDrift(): boolean {
  const graph = loadTemporalGraph();
  const nodes = Object.values(graph).sort((a, b) => a.timestamp - b.timestamp);
  
  if (nodes.length < 20) return false; // Need sufficient data
  
  const recentNodes = nodes.slice(-10);
  const historicalNodes = nodes.slice(0, -10);
  
  const recentAvg = recentNodes.reduce((sum, n) => sum + n.outcomeMetric, 0) / recentNodes.length;
  const historicalAvg = historicalNodes.reduce((sum, n) => sum + n.outcomeMetric, 0) / historicalNodes.length;
  
  // If recent average is more than 20% worse than historical, drift detected
  if (recentAvg < historicalAvg * 0.8) {
    console.warn(`[TemporalReasoning] Temporal drift detected! Recent avg: ${recentAvg.toFixed(3)}, Historical avg: ${historicalAvg.toFixed(3)}`);
    return true;
  }
  
  return false;
}

/**
 * Resets the temporal graph (for testing purposes only).
 */
export function _resetTemporalGraphForTest(): void {
  if (fs.existsSync(TEMPORAL_GRAPH_DB)) {
    fs.unlinkSync(TEMPORAL_GRAPH_DB);
  }
}
