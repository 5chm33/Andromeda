import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { validateBody } from "./validate";

describe("validateBody", () => {
  it("should call next() and update req.body on success", () => {
    const schema = z.object({ name: z.string() });
    const middleware = validateBody(schema);
    
    const req = { body: { name: "test", extra: "ignore" } } as any;
    const res = {} as any;
    const next = vi.fn();
    
    middleware(req, res, next);
    
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ name: "test" });
  });

  it("should return 400 on failure", () => {
    const schema = z.object({ name: z.string() });
    const middleware = validateBody(schema);
    
    const req = { body: { age: 10 } } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    } as any;
    const next = vi.fn();
    
    middleware(req, res, next);
    
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: "Validation failed"
    }));
  });
});
