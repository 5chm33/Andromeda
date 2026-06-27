/**
 * secretsVault.ts — v67.0.0 "Real-World Integration II"
 * Encrypted secrets storage with access control, rotation tracking, and audit log.
 */
import * as crypto from "crypto";

export interface Secret { name: string; encryptedValue: string; iv: string; createdAt: number; rotatedAt?: number; accessCount: number; expiresAt?: number; }

const vault = new Map<string, Secret>();
const accessLog: Array<{ name: string; op: "read" | "write" | "rotate" | "delete"; ts: number }> = [];
const MASTER_KEY = crypto.scryptSync("andromeda-vault-key", "salt-v67", 32);

function encrypt(value: string): { encrypted: string; iv: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", MASTER_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]).toString("hex");
  return { encrypted, iv: iv.toString("hex") };
}

function decrypt(encrypted: string, ivHex: string): string {
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", MASTER_KEY, iv);
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "hex")), decipher.final()]).toString("utf-8");
}

export function storeSecret(name: string, value: string, expiresInMs?: number): Secret {
  const { encrypted, iv } = encrypt(value);
  const secret: Secret = { name, encryptedValue: encrypted, iv, createdAt: Date.now(), accessCount: 0, expiresAt: expiresInMs ? Date.now() + expiresInMs : undefined };
  vault.set(name, secret);
  accessLog.push({ name, op: "write", ts: Date.now() });
  return secret;
}

export function retrieveSecret(name: string): string {
  const secret = vault.get(name);
  if (!secret) throw new Error(`[SecretsVault] Secret not found: ${name}`);
  if (secret.expiresAt && secret.expiresAt < Date.now()) throw new Error(`[SecretsVault] Secret expired: ${name}`);
  secret.accessCount++;
  accessLog.push({ name, op: "read", ts: Date.now() });
  return decrypt(secret.encryptedValue, secret.iv);
}

export function rotateSecret(name: string, newValue: string): Secret {
  const existing = vault.get(name);
  if (!existing) throw new Error(`[SecretsVault] Secret not found: ${name}`);
  const { encrypted, iv } = encrypt(newValue);
  existing.encryptedValue = encrypted;
  existing.iv = iv;
  existing.rotatedAt = Date.now();
  accessLog.push({ name, op: "rotate", ts: Date.now() });
  return existing;
}

export function deleteSecret(name: string): boolean {
  const existed = vault.has(name);
  vault.delete(name);
  if (existed) accessLog.push({ name, op: "delete", ts: Date.now() });
  return existed;
}

export function listSecretNames(): string[] { return [...vault.keys()]; }
export function getAccessLog(): typeof accessLog { return [...accessLog]; }
export function _resetSecretsVaultForTest(): void { vault.clear(); accessLog.length = 0; }
