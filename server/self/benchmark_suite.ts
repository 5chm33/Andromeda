/**
 * Benchmark Suite
 * 
 * Tracks response latency, code quality, and error rates over time.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface BenchmarkMetric {
  name: string;
  category: 'latency' | 'quality' | 'error_rate' | 'throughput';
  value: number;
  unit: string;
  threshold?: number;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface BenchmarkRegression {
  metric: string;
  previousValue: number;
  currentValue: number;
  changePercent: number;
  severity: 'warning' | 'critical';
  recommendation: string;
}

export interface BenchmarkRun {
  timestamp: string;
  durationMs: number;
  metrics: BenchmarkMetric[];
  regressions: BenchmarkRegression[];
  summary: {
    total: number;
    passed: number;
    warnings: number;
    regressions: number;
  };
}

const REGRESSION_THRESHOLD_PERCENT = 15.0; // 15% degradation is a warning
const CRITICAL_REGRESSION_PERCENT = 30.0; // 30% degradation is critical

export async function runBenchmarks(workspaceRoot: string = process.cwd()): Promise<BenchmarkRun> {
  const startTime = Date.now();
  const metrics: BenchmarkMetric[] = [];
  
  // Measure Latency
  metrics.push(...await measureLatencyBenchmarks(workspaceRoot));
  
  // Measure Quality
  metrics.push(...await measureQualityBenchmarks(workspaceRoot));
  
  // Measure Error Rates
  metrics.push(...await measureErrorRateBenchmarks(workspaceRoot));
  
  // Analyze regressions against history
  const history = loadHistory(workspaceRoot);
  const regressions: BenchmarkRegression[] = [];
  
  if (history.length > 0) {
    const previous = history[history.length - 1];
    for (const metric of metrics) {
      const prevMetric = previous.metrics.find(m => m.name === metric.name);
      if (prevMetric && prevMetric.value > 0) {
        const isHigherBetter = metric.name === 'lines_of_code' || metric.name === 'typescript_source_files';
        
        let changePercent = ((metric.value - prevMetric.value) / prevMetric.value) * 100;
        
        // If higher is better, invert the sign for regression detection
        if (isHigherBetter) changePercent = -changePercent;
        
        if (changePercent >= CRITICAL_REGRESSION_PERCENT) {
          regressions.push({
            metric: metric.name,
            previousValue: prevMetric.value,
            currentValue: metric.value,
            changePercent,
            severity: 'critical',
            recommendation: `Critical regression in ${metric.name}: ${changePercent.toFixed(1)}% change.`,
          });
        } else if (changePercent >= REGRESSION_THRESHOLD_PERCENT) {
          regressions.push({
            metric: metric.name,
            previousValue: prevMetric.value,
            currentValue: metric.value,
            changePercent,
            severity: 'warning',
            recommendation: `Significant change in ${metric.name}: ${changePercent.toFixed(1)}%.`,
          });
        }
      }
    }
  }

  const run: BenchmarkRun = {
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    metrics,
    regressions,
    summary: {
      total: metrics.length,
      passed: metrics.filter(m => !m.threshold || m.value <= m.threshold).length,
      warnings: metrics.filter(m => m.threshold && m.value > m.threshold).length,
      regressions: regressions.length,
    },
  };

  saveHistory(workspaceRoot, run);
  return run;
}

async function measureLatencyBenchmarks(workspaceRoot: string): Promise<BenchmarkMetric[]> {
  const metrics: BenchmarkMetric[] = [];

  const tsStart = Date.now();
  try {
    execSync('npx tsc --noEmit --pretty false 2>&1', { cwd: workspaceRoot, timeout: 60000 });
    metrics.push({
      name: 'typescript_compilation_time',
      category: 'latency',
      value: Date.now() - tsStart,
      unit: 'ms',
      threshold: 30000,
      timestamp: new Date().toISOString(),
    });
  } catch {
    metrics.push({
      name: 'typescript_compilation_time',
      category: 'latency',
      value: -1,
      unit: 'ms',
      threshold: 30000,
      timestamp: new Date().toISOString(),
    });
  }

  return metrics;
}

async function measureQualityBenchmarks(workspaceRoot: string): Promise<BenchmarkMetric[]> {
  const metrics: BenchmarkMetric[] = [];
  try {
    const loc = parseInt(
      execSync('find . -name "*.ts" -not -path "*/node_modules/*" -type f -exec cat {} + 2>/dev/null | wc -l', {
        cwd: workspaceRoot,
        timeout: 10000,
      }).toString().trim()
    );
    metrics.push({
      name: 'lines_of_code',
      category: 'quality',
      value: loc,
      unit: 'lines',
      timestamp: new Date().toISOString(),
    });
  } catch { }
  return metrics;
}

async function measureErrorRateBenchmarks(workspaceRoot: string): Promise<BenchmarkMetric[]> {
  const metrics: BenchmarkMetric[] = [];
  try {
    execSync('npx tsc --noEmit --pretty false 2>&1', { cwd: workspaceRoot, timeout: 60000 });
    metrics.push({
      name: 'typescript_errors',
      category: 'error_rate',
      value: 0,
      unit: 'errors',
      threshold: 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    const output = error.stdout?.toString() || '';
    const errorCount = (output.match(/error TS\\d+/g) || []).length;
    metrics.push({
      name: 'typescript_errors',
      category: 'error_rate',
      value: errorCount,
      unit: 'errors',
      threshold: 0,
      timestamp: new Date().toISOString(),
    });
  }
  return metrics;
}

function loadHistory(workspaceRoot: string): BenchmarkRun[] {
  const historyPath = join(workspaceRoot, '.benchmark_history.json');
  if (existsSync(historyPath)) {
    try {
      return JSON.parse(readFileSync(historyPath, 'utf-8'));
    } catch { return []; }
  }
  return [];
}

function saveHistory(workspaceRoot: string, run: BenchmarkRun): void {
  const historyPath = join(workspaceRoot, '.benchmark_history.json');
  const history = loadHistory(workspaceRoot);
  history.push(run);
  if (history.length > 30) history.shift(); // Keep last 30 runs
  writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');
}
