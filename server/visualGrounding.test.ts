import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock playwright
const mockPage = {
  goto: vi.fn(),
  waitForTimeout: vi.fn(),
  screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-screenshot")),
  title: vi.fn().mockResolvedValue("Test Page"),
  url: vi.fn().mockReturnValue("https://example.com"),
  viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 800 }),
  evaluate: vi.fn((fn) => {
    // Return fake elements or page size based on what's expected
    if (fn.toString().includes("scrollWidth")) {
      return { width: 1280, height: 2000 };
    }
    return [
      {
        tag: "button", text: "Click Me", role: "button", ariaLabel: "", placeholder: "", href: "",
        x: 10, y: 10, width: 100, height: 40
      }
    ];
  }),
  mouse: {
    click: vi.fn()
  }
};

const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined)
};

const mockBrowser = {
  isConnected: vi.fn().mockReturnValue(true),
  newContext: vi.fn().mockResolvedValue(mockContext),
  close: vi.fn().mockResolvedValue(undefined)
};

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser)
  }
}));

// Mock canvas
vi.mock("canvas", () => ({
  loadImage: vi.fn().mockResolvedValue({ width: 1280, height: 800 }),
  createCanvas: vi.fn(() => ({
    getContext: vi.fn(() => ({
      drawImage: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn()
    })),
    toBuffer: vi.fn(() => Buffer.from("fake-annotated-screenshot"))
  }))
}));

describe("visualGrounding", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-vg-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    
    // Reset browser connection state for tests
    mockBrowser.isConnected.mockReturnValue(false);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    
    const { closeVisualGroundingBrowser } = await import("./visualGrounding");
    await closeVisualGroundingBrowser();
  });

  it("should capture an annotated screenshot", async () => {
    const { annotatedScreenshot } = await import("./visualGrounding");
    
    const result = await annotatedScreenshot("https://example.com");
    
    expect(result.url).toBe("https://example.com");
    expect(result.title).toBe("Test Page");
    expect(result.elements.length).toBe(1);
    expect(result.elements[0].index).toBe(1);
    expect(result.elements[0].text).toBe("Click Me");
    expect(result.annotatedScreenshot).toBe(Buffer.from("fake-annotated-screenshot").toString("base64"));
  });

  it("should capture a full page screenshot", async () => {
    const { fullPageScreenshot } = await import("./visualGrounding");
    
    const result = await fullPageScreenshot("https://example.com");
    
    expect(result.url).toBe("https://example.com");
    expect(result.title).toBe("Test Page");
    expect(result.pageSize.height).toBe(2000);
    expect(result.fullPageScreenshot).toBe(Buffer.from("fake-screenshot").toString("base64"));
  });

  it("should click an element by index", async () => {
    const { clickByIndex } = await import("./visualGrounding");
    
    const elements = [
      { index: 1, tag: "button", text: "Btn", role: "", ariaLabel: "", placeholder: "", href: "", x: 10, y: 10, width: 100, height: 40, centerX: 60, centerY: 30, isVisible: true, isInteractable: true }
    ];
    
    const result = await clickByIndex(1, elements);
    
    expect(result.success).toBe(true);
    expect(mockPage.mouse.click).toHaveBeenCalledWith(60, 30);
  });

  it("should fail to click an invalid index", async () => {
    const { clickByIndex } = await import("./visualGrounding");
    
    const result = await clickByIndex(99, []);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("should save annotated screenshot to file", async () => {
    const { saveAnnotatedScreenshot } = await import("./visualGrounding");
    
    const result = await saveAnnotatedScreenshot("https://example.com");
    
    expect(result.filePath).toContain("andromeda_screenshot_");
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(result.elements.length).toBe(1);
  });
});
