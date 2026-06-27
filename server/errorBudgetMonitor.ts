import { createLogger } from "./logger.js";
const log = createLogger("ErrorBudgetMonitor");
/**
 * errorBudgetMonitor.ts — v75.0.0 "Incident Management & SRE"
 * Computes and monitors error budgets derived from SLO targets vs. actual compliance.
 */
export interface ErrorBudgetState {
  budgetId: string;
  sloId: string;
  service: string;
  windowDays: number;
  targetPercent: number;
  consumedPercent: number;
  remainingPercent: number;
  budgetExhausted: boolean;
  burnRate: number;
  updatedAt: number;
}

const budgets = new Map<string, ErrorBudgetState>();
let budgetCounter = 0;

export function initErrorBudget(sloId: string, service: string, targetPercent: number, windowDays: number): ErrorBudgetState {
  const state: ErrorBudgetState = {
    budgetId: `budget-${++budgetCounter}`,
    sloId, service, windowDays, targetPercent,
    consumedPercent: 0, remainingPercent: 100 - targetPercent,
    budgetExhausted: false, burnRate: 0, updatedAt: Date.now(),
  };
  budgets.set(sloId, state);
  return state;
}

export function consumeErrorBudget(sloId: string, actualCompliancePercent: number): ErrorBudgetState | null {
  const state = budgets.get(sloId);
  if (!state) return null;

  const allowedErrorPercent = 100 - state.targetPercent;
  const actualErrorPercent = 100 - actualCompliancePercent;
  const consumed = allowedErrorPercent > 0 ? (actualErrorPercent / allowedErrorPercent) * 100 : 100;

  state.consumedPercent = Math.min(consumed, 100);
  state.remainingPercent = Math.max(100 - consumed, 0);
  state.budgetExhausted = consumed >= 100;
  state.burnRate = consumed / (state.windowDays * 24);
  state.updatedAt = Date.now();

  if (state.budgetExhausted) log.info(`[ErrorBudgetMonitor] Budget EXHAUSTED for SLO ${sloId} (service: ${state.service})`);
  return state;
}

export function getErrorBudget(sloId: string): ErrorBudgetState | undefined { return budgets.get(sloId); }
export function getAllErrorBudgets(): ErrorBudgetState[] { return [...budgets.values()]; }
export function _resetErrorBudgetMonitorForTest(): void { budgets.clear(); budgetCounter = 0; }
