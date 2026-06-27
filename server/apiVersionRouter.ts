/**
 * apiVersionRouter.ts — v79.0.0 "API Gateway & Integration"
 * Routes requests to the correct API version handler based on version negotiation.
 */
export type VersionStrategy = "path" | "header" | "query";
export type VersionStatus = "current" | "deprecated" | "sunset";

export interface ApiVersion {
  version: string;
  status: VersionStatus;
  sunsetDate: string | null;
  handlerTag: string;
}

export interface VersionRoutingResult {
  resolvedVersion: string;
  handlerTag: string;
  strategy: VersionStrategy;
  deprecated: boolean;
  sunsetDate: string | null;
}

const versions: ApiVersion[] = [];
let defaultVersion = "v1";

export function registerVersion(version: ApiVersion): void {
  const existing = versions.findIndex(v => v.version === version.version);
  if (existing >= 0) versions[existing] = version;
  else versions.push(version);
  console.log(`[ApiVersionRouter] Registered API version: ${version.version} (${version.status})`);
}

export function setDefaultVersion(version: string): void {
  defaultVersion = version;
}

export function resolveVersion(params: {
  path?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  strategy?: VersionStrategy;
}): VersionRoutingResult | null {
  const strategy = params.strategy ?? "path";
  let requestedVersion: string | null = null;

  if (strategy === "path" && params.path) {
    const match = params.path.match(/\/(v\d+)\//);
    if (match) requestedVersion = match[1];
  } else if (strategy === "header" && params.headers) {
    requestedVersion = params.headers["api-version"] ?? params.headers["x-api-version"] ?? null;
  } else if (strategy === "query" && params.query) {
    requestedVersion = params.query["version"] ?? null;
  }

  const version = requestedVersion
    ? versions.find(v => v.version === requestedVersion)
    : versions.find(v => v.version === defaultVersion);

  if (!version) return null;

  return {
    resolvedVersion: version.version,
    handlerTag: version.handlerTag,
    strategy,
    deprecated: version.status === "deprecated" || version.status === "sunset",
    sunsetDate: version.sunsetDate,
  };
}

export function getVersions(): ApiVersion[] { return [...versions]; }
export function _resetApiVersionRouterForTest(): void { versions.length = 0; defaultVersion = "v1"; }
