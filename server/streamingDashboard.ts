import { EventEmitter } from "events";

export interface DashboardEvent {
  type: "proposal_generated" | "proposal_accepted" | "proposal_rejected" | "system_health" | "model_routed";
  timestamp: number;
  data: any;
}

const dashboardEmitter = new EventEmitter();

/**
 * Emits an event to the streaming dashboard.
 */
export function emitDashboardEvent(type: DashboardEvent["type"], data: any): void {
  const event: DashboardEvent = {
    type,
    timestamp: Date.now(),
    data
  };
  
  dashboardEmitter.emit("event", event);
  // In a real implementation, this would broadcast via WebSocket
  // console.log(`[Dashboard] Emitted ${type} event`);
}

/**
 * Initializes the WebSocket server for the streaming dashboard.
 */
export function initStreamingDashboard(port: number = 8081): void {
  console.log(`[Dashboard] Initializing streaming dashboard on port ${port}...`);
  // Mock WebSocket initialization
  
  dashboardEmitter.on("event", (event: DashboardEvent) => {
    // Mock broadcast
    // console.log(`[Dashboard WebSocket] Broadcasting: ${event.type}`);
  });
}

/**
 * Returns the event emitter for testing or local subscription.
 */
export function getDashboardEmitter(): EventEmitter {
  return dashboardEmitter;
}
