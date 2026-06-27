import { createLogger } from "./logger.js";
const log = createLogger("BudgetAlertEngine");
/**
 * budgetAlertEngine.ts — v78.0.0 "Cost Management & FinOps"
 * Monitors spend against budgets and fires threshold alerts at configurable percentages.
 */
export type AlertSeverity = "info" | "warning" | "critical";

export interface Budget {
  budgetId: string;
  name: string;
  scope: string;
  limitUsd: number;
  thresholds: Array<{ percent: number; severity: AlertSeverity }>;
  createdAt: number;
}

export interface BudgetAlert {
  alertId: string;
  budgetId: string;
  budgetName: string;
  severity: AlertSeverity;
  currentSpendUsd: number;
  limitUsd: number;
  percentUsed: number;
  message: string;
  firedAt: number;
}

const budgets = new Map<string, Budget>();
const alerts: BudgetAlert[] = [];
let budgetCounter = 0;
let alertCounter = 0;

export function createBudget(name: string, scope: string, limitUsd: number, thresholds: Array<{ percent: number; severity: AlertSeverity }> = [{ percent: 80, severity: "warning" }, { percent: 100, severity: "critical" }]): Budget {
  const budget: Budget = {
    budgetId: `budget-${++budgetCounter}`,
    name, scope, limitUsd, thresholds,
    createdAt: Date.now(),
  };
  budgets.set(budget.budgetId, budget);
  return budget;
}

export function checkBudget(budgetId: string, currentSpendUsd: number): BudgetAlert[] {
  const budget = budgets.get(budgetId);
  if (!budget) return [];

  const percentUsed = (currentSpendUsd / budget.limitUsd) * 100;
  const newAlerts: BudgetAlert[] = [];

  for (const threshold of budget.thresholds) {
    if (percentUsed >= threshold.percent) {
      const alert: BudgetAlert = {
        alertId: `alert-${++alertCounter}`,
        budgetId, budgetName: budget.name,
        severity: threshold.severity,
        currentSpendUsd, limitUsd: budget.limitUsd,
        percentUsed,
        message: `Budget "${budget.name}" is at ${percentUsed.toFixed(1)}% ($${currentSpendUsd.toFixed(2)} / $${budget.limitUsd})`,
        firedAt: Date.now(),
      };
      alerts.push(alert);
      newAlerts.push(alert);
      log.info(`[BudgetAlertEngine] ${threshold.severity.toUpperCase()}: ${alert.message}`);
    }
  }

  return newAlerts;
}

export function getBudget(budgetId: string): Budget | undefined { return budgets.get(budgetId); }
export function getAllAlerts(): BudgetAlert[] { return [...alerts]; }
export function _resetBudgetAlertEngineForTest(): void { budgets.clear(); alerts.length = 0; budgetCounter = 0; alertCounter = 0; }
