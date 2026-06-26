/**
 * apiAuthManager.ts — v51.0.0
 *
 * Manages API authentication credentials, token refresh cycles,
 * and multi-scheme auth (Bearer, API Key, OAuth2, Basic).
 */

export type AuthScheme = "bearer" | "api-key" | "oauth2" | "basic";

export interface ApiCredential {
  credentialId: string;
  apiId: string;
  scheme: AuthScheme;
  token?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  expiresAt?: number;
  refreshToken?: string;
  headerName?: string;  // for api-key scheme
}

export interface AuthHeader {
  key: string;
  value: string;
}

const credentials = new Map<string, ApiCredential>();
let credCounter = 0;

export function registerCredential(apiId: string, scheme: AuthScheme, data: Partial<ApiCredential>): ApiCredential {
  const cred: ApiCredential = {
    credentialId: `cred-${++credCounter}`,
    apiId,
    scheme,
    ...data,
  };
  credentials.set(apiId, cred);
  return cred;
}

export function getAuthHeader(apiId: string): AuthHeader | null {
  const cred = credentials.get(apiId);
  if (!cred) return null;

  if (isExpired(cred)) {
    console.warn(`[ApiAuthManager] Credential for "${apiId}" is expired.`);
    return null;
  }

  switch (cred.scheme) {
    case "bearer":
      return { key: "Authorization", value: `Bearer ${cred.token ?? ""}` };
    case "api-key":
      return { key: cred.headerName ?? "X-Api-Key", value: cred.apiKey ?? "" };
    case "basic": {
      const encoded = Buffer.from(`${cred.username ?? ""}:${cred.password ?? ""}`).toString("base64");
      return { key: "Authorization", value: `Basic ${encoded}` };
    }
    case "oauth2":
      return { key: "Authorization", value: `Bearer ${cred.token ?? ""}` };
    default:
      return null;
  }
}

export function refreshToken(apiId: string, newToken: string, expiresInSeconds?: number): void {
  const cred = credentials.get(apiId);
  if (!cred) throw new Error(`[ApiAuthManager] No credential found for "${apiId}"`);
  cred.token = newToken;
  cred.expiresAt = expiresInSeconds ? Date.now() + expiresInSeconds * 1000 : undefined;
}

function isExpired(cred: ApiCredential): boolean {
  return cred.expiresAt !== undefined && Date.now() > cred.expiresAt;
}

export function isCredentialValid(apiId: string): boolean {
  const cred = credentials.get(apiId);
  return !!cred && !isExpired(cred);
}

export function revokeCredential(apiId: string): boolean {
  return credentials.delete(apiId);
}

export function _resetAuthManagerForTest(): void {
  credentials.clear();
  credCounter = 0;
}
