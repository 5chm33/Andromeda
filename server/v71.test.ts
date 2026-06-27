/**
 * v71.test.ts — Multi-Modal Intelligence
 */
import { describe, it, expect, beforeEach } from "vitest";
import { processImage, filterByConfidence, getVisionHistory, _resetVisionProcessorForTest } from "./visionProcessor";
import { analyzeAudio, detectSpeechSegments, _resetAudioAnalyzerForTest } from "./audioAnalyzer";
import { parseDocument, searchDocuments, _resetDocumentParserForTest } from "./documentParser";
import { analyzeChart, getChartAnalyses, _resetChartUnderstanderForTest } from "./chartUnderstander";
import { generateCaption, getCaptions, _resetImageCaptionerForTest } from "./imageCaptioner";
import { performOCR, searchOCRText, _resetOCREngineForTest } from "./ocrEngine";

beforeEach(() => {
  _resetVisionProcessorForTest();
  _resetAudioAnalyzerForTest();
  _resetDocumentParserForTest();
  _resetChartUnderstanderForTest();
  _resetImageCaptionerForTest();
  _resetOCREngineForTest();
});

describe("visionProcessor", () => {
  it("processes an image and detects objects", () => {
    const result = processImage(1920, 1080, { objects: [{ label: "cat", confidence: 0.95 }, { label: "dog", confidence: 0.6 }], colors: ["#ff0000"], scene: "indoor" });
    expect(result.imageId).toMatch(/^img-/);
    expect(result.objects).toHaveLength(2);
    expect(result.sceneType).toBe("indoor");
  });

  it("filters objects by confidence threshold", () => {
    const result = processImage(640, 480, { objects: [{ label: "car", confidence: 0.9 }, { label: "tree", confidence: 0.4 }] });
    const highConf = filterByConfidence(result, 0.8);
    expect(highConf).toHaveLength(1);
    expect(highConf[0].label).toBe("car");
  });

  it("tracks vision history", () => {
    processImage(100, 100, {});
    processImage(200, 200, {});
    expect(getVisionHistory()).toHaveLength(2);
  });
});

describe("audioAnalyzer", () => {
  it("analyzes speech audio", () => {
    const result = analyzeAudio(5000, 44100, { type: "speech", transcript: "Hello world", language: "en" });
    expect(result.type).toBe("speech");
    expect(result.transcript).toBe("Hello world");
    expect(result.language).toBe("en");
  });

  it("detects speech segments", () => {
    const speech = analyzeAudio(3000, 16000, { type: "speech", transcript: "Test" });
    const music = analyzeAudio(4000, 44100, { type: "music" });
    const segments = detectSpeechSegments([speech, music]);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("speech");
    void music;
  });

  it("assigns default confidence", () => {
    const result = analyzeAudio(1000, 8000, { type: "noise" });
    expect(result.confidence).toBe(0.85);
  });
});

describe("documentParser", () => {
  it("parses markdown document", () => {
    const md = "# My Title\n\nSome content here.\n\n## Section 2\n\nMore content.";
    const doc = parseDocument("markdown", md);
    expect(doc.title).toBe("My Title");
    expect(doc.sections.length).toBeGreaterThanOrEqual(2);
    expect(doc.wordCount).toBeGreaterThan(0);
  });

  it("extracts email entities", () => {
    const doc = parseDocument("text", "Contact us at hello@example.com for more info.");
    expect(doc.entities.some(e => e.type === "email" && e.value === "hello@example.com")).toBe(true);
  });

  it("searches documents by content", () => {
    parseDocument("text", "The quick brown fox jumps");
    parseDocument("text", "A completely different document");
    const results = searchDocuments("fox");
    expect(results).toHaveLength(1);
  });
});

describe("chartUnderstander", () => {
  it("detects upward trend", () => {
    const analysis = analyzeChart("line", "Revenue", "Month", "USD", [{ label: "Revenue", values: [100, 150, 200, 300, 400] }]);
    expect(analysis.insights.some(i => i.description.includes("upward"))).toBe(true);
  });

  it("detects peak values", () => {
    const analysis = analyzeChart("bar", "Spikes", "X", "Y", [{ label: "Data", values: [10, 10, 10, 1000, 10] }]);
    expect(analysis.insights.some(i => i.type === "peak")).toBe(true);
  });

  it("stores chart analyses", () => {
    analyzeChart("pie", "Distribution", "Category", "Count", [{ label: "A", values: [30] }]);
    expect(getChartAnalyses()).toHaveLength(1);
  });
});

describe("imageCaptioner", () => {
  it("generates descriptive caption", () => {
    const cap = generateCaption("img-1", "descriptive", [{ label: "person", confidence: 0.95 }], "outdoor", ["#87CEEB", "#228B22"]);
    expect(cap.text).toContain("person");
    expect(cap.text).toContain("outdoor");
  });

  it("generates accessibility caption", () => {
    const cap = generateCaption("img-2", "accessibility", [{ label: "car", confidence: 0.9 }], "street", ["#808080"]);
    expect(cap.text).toContain("car");
    expect(cap.text).toContain("street");
  });

  it("retrieves captions by imageId", () => {
    generateCaption("img-3", "concise", [], "nature", []);
    generateCaption("img-4", "concise", [], "city", []);
    expect(getCaptions("img-3")).toHaveLength(1);
    expect(getCaptions("img-4")).toHaveLength(1);
  });
});

describe("ocrEngine", () => {
  it("performs OCR and extracts full text", () => {
    const result = performOCR("img-1", [
      { text: "Hello World", confidence: 0.98, x: 10, y: 10, w: 200, h: 30 },
      { text: "Second line", confidence: 0.92, x: 10, y: 50, w: 180, h: 30 }
    ]);
    expect(result.fullText).toContain("Hello World");
    expect(result.fullText).toContain("Second line");
    expect(result.avgConfidence).toBeCloseTo(0.95, 1);
  });

  it("searches OCR results by text", () => {
    performOCR("img-2", [{ text: "Invoice #12345", confidence: 0.95 }]);
    performOCR("img-3", [{ text: "Hello World", confidence: 0.9 }]);
    expect(searchOCRText("Invoice")).toHaveLength(1);
  });

  it("detects languages from regions", () => {
    const result = performOCR("img-4", [
      { text: "Hello", confidence: 0.9, lang: "en" },
      { text: "Bonjour", confidence: 0.88, lang: "fr" }
    ]);
    expect(result.detectedLanguages).toContain("en");
    expect(result.detectedLanguages).toContain("fr");
  });
});
