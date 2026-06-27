/**
 * apiGateway.ts — v79.0.0 "API Gateway & Integration"
 * Routes incoming API requests to registered upstream services with middleware support.
 */
export interface UpstreamService {
  serviceId: string;
  name: string;
  baseUrl: string;
  pathPrefix: string;
  timeout: number;
  active: boolean;
}

export interface GatewayRequest {
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  timestamp: number;
}

export interface GatewayResponse {
  requestId: string;
  serviceId: string;
  statusCode: number;
  body: unknown;
  latencyMs: number;
  timestamp: number;
}

const services = new Map<string, UpstreamService>();
const requestLog: GatewayRequest[] = [];
const responseLog: GatewayResponse[] = [];
let reqCounter = 0;

export function registerService(service: UpstreamService): void {
  services.set(service.serviceId, service);
  console.log(`[ApiGateway] Registered service: ${service.name} (${service.pathPrefix})`);
}

export function routeRequest(method: string, path: string, headers: Record<string, string> = {}, body: unknown = null): { matched: boolean; serviceId: string | null; request: GatewayRequest } {
  const request: GatewayRequest = {
    requestId: `req-${++reqCounter}`,
    method, path, headers, body,
    timestamp: Date.now(),
  };
  requestLog.push(request);

  const service = [...services.values()].find(s => s.active && path.startsWith(s.pathPrefix));
  return { matched: !!service, serviceId: service?.serviceId ?? null, request };
}

export function recordResponse(requestId: string, serviceId: string, statusCode: number, body: unknown, latencyMs: number): GatewayResponse {
  const response: GatewayResponse = { requestId, serviceId, statusCode, body, latencyMs, timestamp: Date.now() };
  responseLog.push(response);
  return response;
}

export function getService(serviceId: string): UpstreamService | undefined { return services.get(serviceId); }
export function getAllServices(): UpstreamService[] { return [...services.values()]; }
export function getRequestLog(): GatewayRequest[] { return [...requestLog]; }
export function getResponseLog(): GatewayResponse[] { return [...responseLog]; }
export function _resetApiGatewayForTest(): void { services.clear(); requestLog.length = 0; responseLog.length = 0; reqCounter = 0; }
