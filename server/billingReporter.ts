/**
 * billingReporter.ts — v78.0.0 "Cost Management & FinOps"
 * Generates structured billing reports for teams, projects, and time periods.
 */
export interface LineItem {
  description: string;
  service: string;
  quantity: number;
  unitCostUsd: number;
  totalUsd: number;
  tags: Record<string, string>;
}

export interface BillingReport {
  reportId: string;
  recipientId: string;
  recipientType: "team" | "project" | "account";
  periodLabel: string;
  lineItems: LineItem[];
  subtotalUsd: number;
  taxUsd: number;
  totalUsd: number;
  currency: string;
  generatedAt: number;
}

const reports: BillingReport[] = [];
let reportCounter = 0;

export function generateBillingReport(params: {
  recipientId: string;
  recipientType: "team" | "project" | "account";
  periodLabel: string;
  lineItems: Omit<LineItem, "totalUsd">[];
  taxRatePercent?: number;
  currency?: string;
}): BillingReport {
  const items: LineItem[] = params.lineItems.map(item => ({
    ...item,
    totalUsd: item.quantity * item.unitCostUsd,
  }));

  const subtotal = items.reduce((sum, i) => sum + i.totalUsd, 0);
  const taxRate = params.taxRatePercent ?? 0;
  const tax = subtotal * (taxRate / 100);

  const report: BillingReport = {
    reportId: `billing-${++reportCounter}`,
    recipientId: params.recipientId,
    recipientType: params.recipientType,
    periodLabel: params.periodLabel,
    lineItems: items,
    subtotalUsd: subtotal,
    taxUsd: tax,
    totalUsd: subtotal + tax,
    currency: params.currency ?? "USD",
    generatedAt: Date.now(),
  };

  reports.push(report);
  console.log(`[BillingReporter] Generated billing report for ${params.recipientId} (${params.periodLabel}): $${report.totalUsd.toFixed(2)}`);
  return report;
}

export function getBillingReports(): BillingReport[] { return [...reports]; }
export function getBillingReportsForRecipient(recipientId: string): BillingReport[] { return reports.filter(r => r.recipientId === recipientId); }
export function _resetBillingReporterForTest(): void { reports.length = 0; reportCounter = 0; }
