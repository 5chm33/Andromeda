import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock dependencies
vi.mock("./logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })
}));

vi.mock("./llmProvider.js", () => ({
  getProviderForTier: vi.fn().mockReturnValue("pro-provider"),
  chatCompletion: vi.fn(async (messages) => {
    const content = messages[0].content;
    
    if (content.includes("empty_response")) {
      return { content: "" };
    }
    if (content.includes("invalid_json")) {
      return { content: "This is not json" };
    }
    if (content.includes("markdown_json")) {
      return { content: "```json\n{\"description\": \"test\", \"interactableElements\": [], \"suggestedAction\": \"none\"}\n```" };
    }
    
    return { 
      content: JSON.stringify({
        description: "A test UI",
        interactableElements: [
          { type: "button", label: "Click Me", action: "clicks", estimatedCoordinates: { x: 50, y: 50 } }
        ],
        suggestedAction: "Click the button"
      }) 
    };
  })
}));

describe("nativeVlm", () => {
  let tmpDir: string;
  let originalCwd: string;
  let imgPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-vlm-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    
    imgPath = path.join(tmpDir, "test.png");
    fs.writeFileSync(imgPath, "fake-image-data");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should throw if image does not exist", async () => {
    const { analyzeRawScreenshot } = await import("./nativeVlm");
    
    await expect(analyzeRawScreenshot("missing.png", "query")).rejects.toThrow("Screenshot not found");
  });

  it("should throw if VLM returns empty response", async () => {
    const { analyzeRawScreenshot } = await import("./nativeVlm");
    
    await expect(analyzeRawScreenshot(imgPath, "empty_response")).rejects.toThrow("empty response");
  });

  it("should throw if VLM returns invalid JSON", async () => {
    const { analyzeRawScreenshot } = await import("./nativeVlm");
    
    await expect(analyzeRawScreenshot(imgPath, "invalid_json")).rejects.toThrow("Could not parse JSON");
  });

  it("should parse JSON from markdown blocks", async () => {
    const { analyzeRawScreenshot } = await import("./nativeVlm");
    
    const result = await analyzeRawScreenshot(imgPath, "markdown_json");
    
    expect(result.description).toBe("test");
    expect(result.interactableElements.length).toBe(0);
  });

  it("should successfully analyze a screenshot", async () => {
    const { analyzeRawScreenshot } = await import("./nativeVlm");
    
    const result = await analyzeRawScreenshot(imgPath, "normal query");
    
    expect(result.description).toBe("A test UI");
    expect(result.interactableElements.length).toBe(1);
    expect(result.interactableElements[0].label).toBe("Click Me");
    expect(result.suggestedAction).toBe("Click the button");
  });
});
