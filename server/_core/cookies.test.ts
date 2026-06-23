import { describe, it, expect } from "vitest";
import { getSessionCookieOptions } from "./cookies";

function makeReq(opts: { protocol?: string; headers?: Record<string, string> }) {
  return {
    protocol: opts.protocol ?? "http",
    headers: opts.headers ?? {},
  } as any;
}

describe("getSessionCookieOptions", () => {
  it("should return secure=false and sameSite=lax for plain HTTP", () => {
    const req = makeReq({ protocol: "http" });
    const opts = getSessionCookieOptions(req);
    expect(opts.secure).toBe(false);
    expect(opts.sameSite).toBe("lax");
    expect(opts.httpOnly).toBe(true);
    expect(opts.path).toBe("/");
  });

  it("should return secure=true and sameSite=none for HTTPS", () => {
    const req = makeReq({ protocol: "https" });
    const opts = getSessionCookieOptions(req);
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe("none");
  });

  it("should detect HTTPS via x-forwarded-proto header", () => {
    const req = makeReq({ protocol: "http", headers: { "x-forwarded-proto": "https" } });
    const opts = getSessionCookieOptions(req);
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe("none");
  });

  it("should detect HTTPS in comma-separated x-forwarded-proto", () => {
    const req = makeReq({ protocol: "http", headers: { "x-forwarded-proto": "http, https" } });
    const opts = getSessionCookieOptions(req);
    expect(opts.secure).toBe(true);
  });

  it("should not detect HTTPS when x-forwarded-proto is http only", () => {
    const req = makeReq({ protocol: "http", headers: { "x-forwarded-proto": "http" } });
    const opts = getSessionCookieOptions(req);
    expect(opts.secure).toBe(false);
  });
});
