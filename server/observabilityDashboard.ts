/**
 * observabilityDashboard.ts — v70.0.0 "Observability Stack"
 * Unified observability dashboard aggregating metrics, logs, traces, and alerts.
 */
export interface DashboardPanel { panelId: string; title: string; type: "metric" | "log" | "trace" | "alert"; data: unknown; updatedAt: number; }
export interface Dashboard { dashboardId: string; name: string; panels: DashboardPanel[]; createdAt: number; }

const dashboards = new Map<string, Dashboard>();
let dashCounter = 0;
let panelCounter = 0;

export function createDashboard(name: string): Dashboard {
  const d: Dashboard = { dashboardId: `dash-${++dashCounter}`, name, panels: [], createdAt: Date.now() };
  dashboards.set(d.dashboardId, d);
  return d;
}

export function addPanel(dashboardId: string, title: string, type: DashboardPanel["type"], data: unknown): DashboardPanel {
  const d = dashboards.get(dashboardId);
  if (!d) throw new Error(`[ObservabilityDashboard] Dashboard not found: ${dashboardId}`);
  const panel: DashboardPanel = { panelId: `panel-${++panelCounter}`, title, type, data, updatedAt: Date.now() };
  d.panels.push(panel);
  return panel;
}

export function updatePanel(dashboardId: string, panelId: string, data: unknown): void {
  const d = dashboards.get(dashboardId);
  const panel = d?.panels.find(p => p.panelId === panelId);
  if (!panel) throw new Error(`[ObservabilityDashboard] Panel not found: ${panelId}`);
  panel.data = data;
  panel.updatedAt = Date.now();
}

export function getDashboard(dashboardId: string): Dashboard | undefined { return dashboards.get(dashboardId); }
export function listDashboards(): Dashboard[] { return [...dashboards.values()]; }
export function _resetObservabilityDashboardForTest(): void { dashboards.clear(); dashCounter = 0; panelCounter = 0; }
