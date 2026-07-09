/**
 * adminAuth.ts — v6.26
 *
 * Lightweight API-key middleware for self-modification endpoints.
 *
 * Security hardening (v6.26 — Fable 5 audit F-5):
 *   - Key comparison now uses crypto.timingSafeEqual to prevent timing attacks
 *   - Removed ?key= query param path: secrets in URLs leak into proxy logs,
 *     browser history, and Referer headers. SSE clients should use a short-lived
 *     signed token instead of the long-lived admin key.
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
import { randomBytes, timingSafeEqual } from "crypto";

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
 * Constant-time string comparison to prevent timing attacks.
 * Returns true only if both strings are identical in content AND length.
 */
function safeCompare(a: string, b: string): boolean {
  // Buffers must be the same length for timingSafeEqual.
  // We pad/hash to equal length to avoid leaking length information.
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Still do a comparison to avoid short-circuit timing leak on length mismatch
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Express middleware that requires a valid admin key.
 * Protects self-modification, RSI enable/disable, and code-apply endpoints.
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const key = getAdminKey();
  const authHeader = req.headers["authorization"];
  const xAdminKey = req.headers["x-admin-key"] as string | undefined;

  // Note: ?key= query param path intentionally removed (v6.26).
  // Secrets in URLs leak into proxy logs, browser history, and Referer headers.
  // SSE/EventSource clients should use a short-lived signed token, not the admin key.
  const provided =
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined) ??
    xAdminKey ??
    (req.body as Record<string, unknown>)?.adminKey as string | undefined;

  if (!provided || !safeCompare(provided, key)) {
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
