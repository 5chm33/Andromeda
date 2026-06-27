/**
 * webhookManager.ts — v67.0.0 "Real-World Integration II"
 * Register, dispatch, and retry webhooks with HMAC signature verification.
 */
import * as crypto from "crypto";

export type WebhookStatus = "pending" | "delivered" | "failed" | "retrying";
export interface WebhookEndpoint { id: string; url: string; events: string[]; secret: string; active: boolean; }
export interface WebhookDelivery { deliveryId: string; endpointId: string; event: string; payload: unknown; status: WebhookStatus; attempts: number; lastAttemptAt?: number; responseCode?: number; }

const endpoints = new Map<string, WebhookEndpoint>();
const deliveries: WebhookDelivery[] = [];
let epCounter = 0, dlCounter = 0;

export function registerWebhook(url: string, events: string[], secret?: string): WebhookEndpoint {
  const endpoint: WebhookEndpoint = { id: `wh-${++epCounter}`, url, events, secret: secret ?? crypto.randomBytes(16).toString("hex"), active: true };
  endpoints.set(endpoint.id, endpoint);
  return endpoint;
}

export function signPayload(payload: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = signPayload(payload, secret);
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); } catch { return false; }
}

export async function dispatchWebhook(event: string, payload: unknown): Promise<WebhookDelivery[]> {
  const matching = [...endpoints.values()].filter(ep => ep.active && (ep.events.includes(event) || ep.events.includes("*")));
  const results: WebhookDelivery[] = [];
  for (const ep of matching) {
    const delivery: WebhookDelivery = { deliveryId: `dl-${++dlCounter}`, endpointId: ep.id, event, payload, status: "pending", attempts: 0 };
    deliveries.push(delivery);
    try {
      const body = JSON.stringify(payload);
      const sig = signPayload(body, ep.secret);
      const res = await fetch(ep.url, { method: "POST", headers: { "Content-Type": "application/json", "X-Andromeda-Signature": sig }, body, signal: AbortSignal.timeout(5000) });
      delivery.status = res.ok ? "delivered" : "failed";
      delivery.responseCode = res.status;
    } catch { delivery.status = "failed"; }
    delivery.attempts++;
    delivery.lastAttemptAt = Date.now();
    results.push(delivery);
  }
  return results;
}

export function getDeliveries(): WebhookDelivery[] { return [...deliveries]; }
export function _resetWebhookManagerForTest(): void { endpoints.clear(); deliveries.length = 0; epCounter = 0; dlCounter = 0; }
