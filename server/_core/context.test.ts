import { describe, it, expect, vi } from "vitest";

// Mock sdk
const mockAuthenticateRequest = vi.fn();
vi.mock("./sdk", () => ({
  sdk: {
    authenticateRequest: mockAuthenticateRequest,
  },
}));

describe("createContext", () => {
  it("should return user when authenticated", async () => {
    const { createContext } = await import("./context");
    const mockUser = { id: "user-1", email: "test@test.com" };
    mockAuthenticateRequest.mockResolvedValueOnce(mockUser);
    
    const req = {} as any;
    const res = {} as any;
    const ctx = await createContext({ req, res });
    
    expect(ctx.user).toEqual(mockUser);
    expect(ctx.req).toBe(req);
    expect(ctx.res).toBe(res);
  });

  it("should return null user when authentication fails", async () => {
    const { createContext } = await import("./context");
    mockAuthenticateRequest.mockRejectedValueOnce(new Error("Unauthorized"));
    
    const req = {} as any;
    const res = {} as any;
    const ctx = await createContext({ req, res });
    
    expect(ctx.user).toBeNull();
  });
});
