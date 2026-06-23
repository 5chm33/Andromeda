import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("generateImage", () => {
  let originalFetch: typeof global.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv = { ...process.env };
    process.env.HF_TOKEN = "test-hf-token";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  it("should throw if prompt is empty", async () => {
    const { generateImage } = await import("./imageGeneration");
    await expect(generateImage({ prompt: "" })).rejects.toThrow("Prompt is required");
  });

  it("should throw if HF_TOKEN is not set", async () => {
    delete process.env.HF_TOKEN;
    const { generateImage } = await import("./imageGeneration");
    await expect(generateImage({ prompt: "test" })).rejects.toThrow("HF_TOKEN");
  });

  it("should call HuggingFace API and return base64 image", async () => {
    const mockArrayBuffer = Buffer.from("fake-image-data").buffer;
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValueOnce(mockArrayBuffer),
    };
    global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);
    
    const { generateImage } = await import("./imageGeneration");
    const result = await generateImage({ prompt: "a cat" });
    
    expect(result.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(result.usedReference).toBe(false);
    expect(result.enhancedPrompt).toBeUndefined();
  });

  it("should throw on HuggingFace API error", async () => {
    const mockResponse = {
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValueOnce("Service unavailable"),
    };
    global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);
    
    const { generateImage } = await import("./imageGeneration");
    await expect(generateImage({ prompt: "a cat" })).rejects.toThrow("Image generation failed");
  });

  it("should use reference image when provided and no API keys set", async () => {
    // Without OPENAI_API_KEY, style extraction returns empty string
    delete process.env.OPENAI_API_KEY;
    
    const mockArrayBuffer = Buffer.from("fake-image-data").buffer;
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValueOnce(mockArrayBuffer),
    };
    global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);
    
    const { generateImage } = await import("./imageGeneration");
    const result = await generateImage({
      prompt: "a dog",
      referenceImageB64: "base64encodedimage",
    });
    
    expect(result.usedReference).toBe(true);
    expect(result.enhancedPrompt).toContain("same visual style as reference image");
  });
});
