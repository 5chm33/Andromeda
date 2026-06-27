/**
 * v72.test.ts — Multi-Modal Fusion
 * Comprehensive tests for all 6 v72 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { analyzeVideo, getVideoAnalyses, _resetVideoFrameAnalyzerForTest } from "./videoFrameAnalyzer";
import { recognizeSpeech, getRecognitionHistory, _resetSpeechRecognizerForTest } from "./speechRecognizer";
import { interpretDiagram, findCriticalPath, _resetDiagramInterpreterForTest } from "./diagramInterpreter";
import { fuseModalities, getFusions, _resetMultimodalFusionForTest } from "./multimodalFusion";
import { routeByMimeType, routeByHeuristic, getRoutingHistory, _resetModalityRouterForTest } from "./modalityRouter";
import { indexDocument, retrieveCrossModal, getIndexSize, getIndexedDocuments, getQueryHistory, _resetCrossModalRetrieverForTest } from "./crossModalRetriever";

// ─── videoFrameAnalyzer ───────────────────────────────────────────────────────
describe("videoFrameAnalyzer", () => {
  beforeEach(() => _resetVideoFrameAnalyzerForTest());

  it("analyzes a video and detects keyframes", () => {
    const frames = [
      { timestamp: 0, sceneType: "indoor", objects: ["table", "chair"], motionScore: 0.1 },
      { timestamp: 500, sceneType: "indoor", objects: ["table"], motionScore: 0.2 },
      { timestamp: 1000, sceneType: "outdoor", objects: ["tree", "sky"], motionScore: 0.8 },
      { timestamp: 1500, sceneType: "outdoor", objects: ["road"], motionScore: 0.5 },
    ];
    const result = analyzeVideo(2000, frames);
    expect(result.videoId).toBe("video-1");
    expect(result.totalFrames).toBe(4);
    expect(result.durationMs).toBe(2000);
    expect(result.sceneChanges).toBe(1);
    expect(result.keyframes.length).toBeGreaterThan(0);
    expect(result.dominantScenes).toContain("indoor");
    expect(result.summary).toContain("4 frames");
  });

  it("marks first frame as keyframe always", () => {
    const frames = [{ timestamp: 0, sceneType: "scene1", objects: [], motionScore: 0.1 }];
    const result = analyzeVideo(500, frames);
    expect(result.keyframes[0].isKeyframe).toBe(true);
  });

  it("marks high-motion frames as keyframes", () => {
    const frames = [
      { timestamp: 0, sceneType: "A", objects: [], motionScore: 0.1 },
      { timestamp: 100, sceneType: "A", objects: [], motionScore: 0.9 },
    ];
    const result = analyzeVideo(200, frames);
    const highMotion = result.keyframes.find(f => f.motionScore === 0.9);
    expect(highMotion).toBeDefined();
  });

  it("accumulates analyses", () => {
    analyzeVideo(1000, [{ timestamp: 0, sceneType: "x", objects: [], motionScore: 0 }]);
    analyzeVideo(2000, [{ timestamp: 0, sceneType: "y", objects: [], motionScore: 0 }]);
    expect(getVideoAnalyses().length).toBe(2);
  });

  it("resets state cleanly", () => {
    analyzeVideo(1000, [{ timestamp: 0, sceneType: "x", objects: [], motionScore: 0 }]);
    _resetVideoFrameAnalyzerForTest();
    expect(getVideoAnalyses().length).toBe(0);
  });
});

// ─── speechRecognizer ────────────────────────────────────────────────────────
describe("speechRecognizer", () => {
  beforeEach(() => _resetSpeechRecognizerForTest());

  it("recognizes speech and builds transcript", () => {
    const words = [
      { word: "Hello", startMs: 0, endMs: 300, confidence: 0.95 },
      { word: "world", startMs: 350, endMs: 700, confidence: 0.90 },
    ];
    const result = recognizeSpeech("audio-1", "en-US", words);
    expect(result.recognitionId).toBe("rec-1");
    expect(result.transcript).toBe("Hello world");
    expect(result.language).toBe("en-US");
    expect(result.overallConfidence).toBeCloseTo(0.925);
  });

  it("assigns speaker segments correctly", () => {
    const words = [
      { word: "Hi", startMs: 0, endMs: 200, confidence: 0.9 },
      { word: "there", startMs: 250, endMs: 500, confidence: 0.85 },
      { word: "bye", startMs: 600, endMs: 900, confidence: 0.8 },
    ];
    const speakers = [
      { speakerId: "speaker-A", startMs: 0, endMs: 500 },
      { speakerId: "speaker-B", startMs: 600, endMs: 900 },
    ];
    const result = recognizeSpeech("audio-2", "en-US", words, speakers);
    expect(result.speakers.length).toBe(2);
    expect(result.speakers[0].text).toBe("Hi there");
    expect(result.speakers[1].text).toBe("bye");
  });

  it("handles empty words gracefully", () => {
    const result = recognizeSpeech("audio-3", "en-US", []);
    expect(result.transcript).toBe("");
    expect(result.overallConfidence).toBe(0);
  });

  it("accumulates recognition history", () => {
    recognizeSpeech("a1", "en", [{ word: "x", startMs: 0, endMs: 100, confidence: 0.9 }]);
    recognizeSpeech("a2", "fr", [{ word: "y", startMs: 0, endMs: 100, confidence: 0.8 }]);
    expect(getRecognitionHistory().length).toBe(2);
  });

  it("resets cleanly", () => {
    recognizeSpeech("a1", "en", [{ word: "x", startMs: 0, endMs: 100, confidence: 0.9 }]);
    _resetSpeechRecognizerForTest();
    expect(getRecognitionHistory().length).toBe(0);
  });
});

// ─── diagramInterpreter ──────────────────────────────────────────────────────
describe("diagramInterpreter", () => {
  beforeEach(() => _resetDiagramInterpreterForTest());

  it("interprets a simple flowchart", () => {
    const nodes = [
      { nodeId: "n1", label: "Start", type: "start" },
      { nodeId: "n2", label: "Process", type: "process" },
      { nodeId: "n3", label: "End", type: "end" },
    ];
    const edges = [{ from: "n1", to: "n2" }, { from: "n2", to: "n3" }];
    const result = interpretDiagram("flowchart", nodes, edges);
    expect(result.diagramId).toBe("diag-1");
    expect(result.diagramType).toBe("flowchart");
    expect(result.complexity).toBe("simple");
    expect(result.description).toContain("3 nodes");
  });

  it("classifies moderate complexity correctly", () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({ nodeId: `n${i}`, label: `Node ${i}`, type: "process" }));
    const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i].nodeId, to: n.nodeId }));
    const result = interpretDiagram("graph", nodes, edges);
    expect(result.complexity).toBe("moderate");
  });

  it("classifies complex diagrams correctly", () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({ nodeId: `n${i}`, label: `N${i}`, type: "x" }));
    const result = interpretDiagram("uml", nodes, []);
    expect(result.complexity).toBe("complex");
  });

  it("finds critical path in a linear graph", () => {
    const nodes = [
      { nodeId: "a", label: "A", type: "x" },
      { nodeId: "b", label: "B", type: "x" },
      { nodeId: "c", label: "C", type: "x" },
    ];
    const edges = [{ from: "a", to: "b" }, { from: "b", to: "c" }];
    const interp = interpretDiagram("flowchart", nodes, edges);
    const path = findCriticalPath(interp);
    expect(path).toEqual(["A", "B", "C"]);
  });

  it("returns empty path for empty diagram", () => {
    const interp = interpretDiagram("unknown", [], []);
    expect(findCriticalPath(interp)).toEqual([]);
  });
});

// ─── multimodalFusion ────────────────────────────────────────────────────────
describe("multimodalFusion", () => {
  beforeEach(() => _resetMultimodalFusionForTest());

  it("fuses multiple modality signals", () => {
    const signals = [
      { modality: "vision" as const, content: "cat image", confidence: 0.9, timestamp: 1000 },
      { modality: "text" as const, content: "a cat", confidence: 0.85, timestamp: 1001 },
      { modality: "audio" as const, content: "meow", confidence: 0.7, timestamp: 1002 },
    ];
    const result = fuseModalities(signals);
    expect(result.fusionId).toBe("fusion-1");
    expect(result.dominantModality).toBe("vision");
    expect(result.overallConfidence).toBeCloseTo(0.8167, 2);
    expect(result.unifiedDescription).toContain("3 signals");
  });

  it("throws on empty signals", () => {
    expect(() => fuseModalities([])).toThrow("[MultimodalFusion] No signals to fuse");
  });

  it("selects highest confidence as dominant", () => {
    const signals = [
      { modality: "text" as const, content: "hello", confidence: 0.5, timestamp: 0 },
      { modality: "video" as const, content: "clip", confidence: 0.99, timestamp: 0 },
    ];
    const result = fuseModalities(signals);
    expect(result.dominantModality).toBe("video");
  });

  it("accumulates fusions", () => {
    fuseModalities([{ modality: "text" as const, content: "x", confidence: 0.8, timestamp: 0 }]);
    fuseModalities([{ modality: "audio" as const, content: "y", confidence: 0.7, timestamp: 0 }]);
    expect(getFusions().length).toBe(2);
  });

  it("resets cleanly", () => {
    fuseModalities([{ modality: "text" as const, content: "x", confidence: 0.8, timestamp: 0 }]);
    _resetMultimodalFusionForTest();
    expect(getFusions().length).toBe(0);
  });
});

// ─── modalityRouter ──────────────────────────────────────────────────────────
describe("modalityRouter", () => {
  beforeEach(() => _resetModalityRouterForTest());

  it("routes image MIME types to vision processor", () => {
    const route = routeByMimeType("image/jpeg");
    expect(route.modality).toBe("vision");
    expect(route.processor).toBe("visionProcessor");
    expect(route.confidence).toBe(1.0);
  });

  it("routes audio MIME types to speech recognizer", () => {
    const route = routeByMimeType("audio/mp3");
    expect(route.modality).toBe("audio");
    expect(route.processor).toBe("speechRecognizer");
  });

  it("routes video MIME types to video analyzer", () => {
    const route = routeByMimeType("video/mp4");
    expect(route.modality).toBe("video");
    expect(route.processor).toBe("videoFrameAnalyzer");
  });

  it("defaults unknown MIME types to text", () => {
    const route = routeByMimeType("application/octet-stream");
    expect(route.modality).toBe("text");
    expect(route.confidence).toBeLessThan(1.0);
  });

  it("routes image URLs by heuristic", () => {
    const route = routeByHeuristic("https://example.com/photo.jpg");
    expect(route.modality).toBe("vision");
  });

  it("routes Mermaid diagrams by heuristic", () => {
    const route = routeByHeuristic("graph TD\n  A --> B");
    expect(route.modality).toBe("diagram");
    expect(route.processor).toBe("diagramInterpreter");
  });

  it("routes audio URLs by heuristic", () => {
    const route = routeByHeuristic("https://example.com/clip.mp3");
    expect(route.modality).toBe("audio");
  });

  it("accumulates routing history", () => {
    routeByMimeType("image/png");
    routeByMimeType("audio/wav");
    expect(getRoutingHistory().length).toBe(2);
  });
});

// ─── crossModalRetriever ─────────────────────────────────────────────────────
describe("crossModalRetriever", () => {
  beforeEach(() => _resetCrossModalRetrieverForTest());

  it("indexes documents and retrieves by cosine similarity", () => {
    indexDocument("text", "The cat sat on the mat", [1, 0, 0, 0]);
    indexDocument("vision", "Image of a cat", [0.9, 0.1, 0, 0]);
    indexDocument("audio", "Sound of a dog", [0, 0, 1, 0]);

    const query = retrieveCrossModal("cat query", [1, 0, 0, 0], ["text", "vision", "audio"], 3);
    expect(query.queryId).toBe("query-1");
    expect(query.results.length).toBe(3);
    expect(query.results[0].rank).toBe(1);
    expect(query.results[0].doc.modality).toBe("text");
    expect(query.results[0].score).toBeCloseTo(1.0);
  });

  it("filters by target modalities", () => {
    indexDocument("text", "text doc", [1, 0]);
    indexDocument("vision", "vision doc", [0, 1]);
    indexDocument("audio", "audio doc", [0.5, 0.5]);

    const query = retrieveCrossModal("query", [1, 0], ["vision"], 5);
    expect(query.results.every(r => r.doc.modality === "vision")).toBe(true);
  });

  it("respects topK limit", () => {
    for (let i = 0; i < 10; i++) indexDocument("text", `doc ${i}`, [Math.random(), Math.random()]);
    const query = retrieveCrossModal("q", [1, 0], ["text"], 3);
    expect(query.results.length).toBe(3);
  });

  it("returns results sorted by score descending", () => {
    indexDocument("text", "perfect match", [1, 0]);
    indexDocument("text", "partial match", [0.5, 0.5]);
    indexDocument("text", "no match", [0, 1]);

    const query = retrieveCrossModal("q", [1, 0], ["text"], 3);
    const scores = query.results.map(r => r.score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
  });

  it("handles zero-vector embeddings gracefully", () => {
    indexDocument("text", "doc", [0, 0]);
    const query = retrieveCrossModal("q", [0, 0], ["text"], 1);
    expect(query.results[0].score).toBe(0);
  });

  it("tracks index size and query history", () => {
    indexDocument("text", "a", [1, 0]);
    indexDocument("vision", "b", [0, 1]);
    expect(getIndexSize()).toBe(2);
    retrieveCrossModal("q1", [1, 0], [], 5);
    retrieveCrossModal("q2", [0, 1], [], 5);
    expect(getQueryHistory().length).toBe(2);
  });

  it("returns all modalities when targetModalities is empty", () => {
    indexDocument("text", "t", [1, 0]);
    indexDocument("audio", "a", [0, 1]);
    const query = retrieveCrossModal("q", [1, 0], [], 10);
    const modalities = new Set(query.results.map(r => r.doc.modality));
    expect(modalities.has("text")).toBe(true);
    expect(modalities.has("audio")).toBe(true);
  });

  it("resets cleanly", () => {
    indexDocument("text", "x", [1, 0]);
    _resetCrossModalRetrieverForTest();
    expect(getIndexSize()).toBe(0);
    expect(getIndexedDocuments().length).toBe(0);
    expect(getQueryHistory().length).toBe(0);
  });
});
