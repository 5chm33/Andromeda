/**
 * adminAuth.ts — v6.25
 *
 * Lightweight API-key middleware for self-modification endpoints.
 *
 * Usage:
 *   app.post("/api/self/apply", requireAdminAuth, handler)
 *
 * Configuration:
 *   Set ANDROMEDA_ADMIN_KEY in .env.local to a strong secret.
 *   If unset, a random key is generated at startup and printed to the console.
 *
 * Clients must send:
 *   Authorization: Bearer <key>
 *   — or —
 *   X-Admin-Key: <key>
 */
import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";

let adminKey: string;

function getAdminKey(): string {
  if (adminKey) return adminKey;
  const envKey = process.env.ANDROMEDA_ADMIN_KEY;
  if (envKey && envKey.length >= 16) {
    adminKey = envKey;
  } else {
    // Generate a random key and print it once so the user can save it
    adminKey = randomBytes(24).toString("hex");
    console.warn("╔══════════════════════════════════════════════════════════════╗");
    console.warn("║  ANDROMEDA ADMIN KEY (auto-generated — save this!)           ║");
    console.warn(`║  ${adminKey}  ║`);
    console.warn("║  Set ANDROMEDA_ADMIN_KEY in .env.local to persist this key.  ║");
    console.warn("╚══════════════════════════════════════════════════════════════╝");
  }
  return adminKey;
}

/**
 * Express middleware that requires a valid admin key.
 * Protects self-modification, RSI enable/disable, and code-apply endpoints.
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const key = getAdminKey();
  const authHeader = req.headers["authorization"];
  const xAdminKey = req.headers["x-admin-key"] as string | undefined;

  // v12.2.1: also accept ?key= query param for EventSource/SSE streams (which cannot send custom headers)
  const queryKey = req.query?.key as string | undefined;
  const provided =
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined) ??
    xAdminKey ??
    queryKey ??
    (req.body as Record<string, unknown>)?.adminKey as string | undefined;

  if (!provided || provided !== key) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Admin key required. Set Authorization: Bearer <key> or X-Admin-Key header.",
      hint: "Check server console for the auto-generated key, or set ANDROMEDA_ADMIN_KEY in .env.local.",
    });
    return;
  }
  next();
}

/**
 * Returns the current admin key (for use in tests or internal callers).
 */
export function getAdminKeyForTest(): string {
  return getAdminKey();
}
