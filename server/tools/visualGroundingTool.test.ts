import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the registry
const registeredTools = new Map();
vi.mock("./toolRegistry.js", () => ({
  registerTool: vi.fn((tool) => {
    registeredTools.set(tool.name, tool);
  })
}));

// Mock the underlying grounding functions
vi.mock("../visualGrounding.js", () => ({
  annotatedScreenshot: vi.fn(async (url, sessionId) => {
    return {
      annotatedScreenshot: "base64-anno",
      rawScreenshot: "base64-raw",
      elements: [
        { index: 1, tag: "button", text: "Click Me", centerX: 10, centerY: 10 }
      ],
      viewport: { width: 800, height: 600 },
      url: url || "https://example.com",
      title: "Test Page"
    };
  }),
  fullPageScreenshot: vi.fn(async (url, sessionId) => {
    return {
      fullPageScreenshot: "base64-full",
      pageSize: { width: 800, height: 2000 },
      url: url,
      title: "Test Page"
    };
  }),
  clickByIndex: vi.fn(async (index, elements, sessionId) => {
    if (index === 1) return { success: true, url: "https://example.com/clicked" };
    return { success: false, error: "not found" };
  }),
  saveAnnotatedScreenshot: vi.fn(async (url, sessionId) => {
    return {
      filePath: "/tmp/fake.png",
      elements: [{ index: 1 }],
      url: url,
      title: "Test Page"
    };
  })
}));

describe("visualGroundingTool", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    registeredTools.clear();
    
    const { registerVisualGroundingTools } = await import("./visualGroundingTool");
    registerVisualGroundingTools();
  });

  it("should register visual_screenshot tool and execute it", async () => {
    const tool = registeredTools.get("visual_screenshot");
    expect(tool).toBeDefined();
    
    const result = await tool.execute({ url: "https://test.com" });
    
    expect(result.success).toBe(true);
    expect(result.data.screenshot_base64).toBe("base64-anno");
    expect(result.output).toContain("[1] button");
  });

  it("should register visual_full_page tool and execute it", async () => {
    const tool = registeredTools.get("visual_full_page");
    expect(tool).toBeDefined();
    
    const result = await tool.execute({ url: "https://test.com" });
    
    expect(result.success).toBe(true);
    expect(result.data.screenshot_base64).toBe("base64-full");
    expect(result.data.page_size.height).toBe(2000);
  });

  it("should register visual_click_index tool and execute it", async () => {
    const screenshotTool = registeredTools.get("visual_screenshot");
    const clickTool = registeredTools.get("visual_click_index");
    
    // First take a screenshot to populate the cache
    await screenshotTool.execute({ url: "https://test.com", session_id: "test-session" });
    
    // Then click an element
    const result = await clickTool.execute({ index: 1, session_id: "test-session" });
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("Clicked element [1]");
  });

  it("should fail to click if no cache exists", async () => {
    const clickTool = registeredTools.get("visual_click_index");
    
    const result = await clickTool.execute({ index: 1, session_id: "empty-session" });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Call visual_screenshot first");
  });

  it("should register visual_save_screenshot tool and execute it", async () => {
    const tool = registeredTools.get("visual_save_screenshot");
    expect(tool).toBeDefined();
    
    const result = await tool.execute({ url: "https://test.com" });
    
    expect(result.success).toBe(true);
    expect(result.data.file_path).toBe("/tmp/fake.png");
    expect(result.artifacts.length).toBe(1);
  });
});
