import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

// v5.9: Rate limiting middleware for tRPC endpoints
// Tracks request counts per IP with a sliding 60-second window
const ipRequestCounts = new Map<string, { count: number; resetAt: number }>();
const TRPC_RATE_LIMIT = 120; // 120 requests per minute per IP
const TRPC_WINDOW_MS = 60_000;

const rateLimitMiddleware = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  const ip = ctx.req?.ip || ctx.req?.socket?.remoteAddress || "unknown";

  // Skip rate limiting for localhost
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
    return next();
  }

  const now = Date.now();
  const entry = ipRequestCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    ipRequestCounts.set(ip, { count: 1, resetAt: now + TRPC_WINDOW_MS });
  } else {
    entry.count++;
    if (entry.count > TRPC_RATE_LIMIT) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Rate limit exceeded. Please wait before making more requests.",
      });
    }
  }

  return next();
});

// v5.11: Periodic cleanup of stale rate limit entries (every 60s)
// Moved from inline per-request check to avoid adding latency to user requests
setInterval(() => {
  const now = Date.now();
  Array.from(ipRequestCounts.entries()).forEach(([ip, entry]) => {
    if (now > entry.resetAt) ipRequestCounts.delete(ip);
  });
}, 60_000).unref(); // unref() so this timer doesn't prevent graceful process exit

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

// All procedures go through rate limiting first
export const publicProcedure = t.procedure.use(rateLimitMiddleware);
export const protectedProcedure = t.procedure.use(rateLimitMiddleware).use(requireUser);

export const adminProcedure = t.procedure.use(rateLimitMiddleware).use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
