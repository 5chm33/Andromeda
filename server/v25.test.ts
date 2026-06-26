import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// Mocks
vi.mock("fs");
vi.mock("child_process");
vi.mock("./llmProvider.js", () => ({
  simpleChatCompletion: vi.fn().mockResolvedValue(JSON.stringify({
    structuredData: { entities: ["mock"] },
    extractedText: "Mock visual text"
  }))
}));
vi.mock("./causalWorldModel.js", () => ({
  loadCausalDAG: vi.fn().mockReturnValue({
    nodes: {
      "downstream.ts": { probability: 0.1 },
      "target.ts": { probability: 0.9 }
    }
  })
}));
vi.mock("./selfRollback.js", () => ({
  buildDependencyMap: vi.fn().mockReturnValue({
    "downstream.ts": ["target.ts"]
  })
}));
vi.mock("./emergentFineTuner.js", () => ({
  collectTrainingPair: vi.fn()
}));

// Imports
import { extractVisualContext, scanProjectVisuals } from "./multiModalCodeReader.js";
import { detectLanguage, validatePolyglotProposal } from "./polyglotRsi.js";
import { requestHumanReview, resolveReview, getPendingReviewCount } from "./humanInTheLoop.js";
import { simulateCausalIntervention } from "./causalIntervention.js";
import { submitToArxiv } from "./arxivSubmitter.js";
import { evaluatePipelinePlasticity, isStageActive, recordStagePerformance, getPipelineTopology } from "./neuroplasticAdapter.js";
import { ImprovementProposal } from "./selfImprove.js";

describe("v25.0.0 Cognitive Transcendence II", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("MultiModalCodeReader", () => {
    it("should detect and extract visual context from diagrams", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      
      const ctx = await extractVisualContext("mock_diagram.png", "diagram");
      expect(ctx).not.toBeNull();
      expect(ctx?.sourceType).toBe("diagram");
      expect(ctx?.extractedText).toBe("Mock visual text");
    });
  });

  describe("PolyglotRSI", () => {
    it("should correctly detect file languages", () => {
      expect(detectLanguage("script.py")).toBe("python");
      expect(detectLanguage("query.sql")).toBe("sql");
      expect(detectLanguage("deploy.sh")).toBe("shell");
      expect(detectLanguage("app.tsx")).toBe("typescript");
    });

    it("should validate SQL syntax via heuristics", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("SELECT * FROM users;");
      
      const result = validatePolyglotProposal("query.sql");
      expect(result.isValid).toBe(true);
      expect(result.score).toBe(100);
    });

    it("should reject invalid SQL", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("invalid sql without semicolon");
      
      const result = validatePolyglotProposal("query.sql");
      expect(result.isValid).toBe(false);
      expect(result.score).toBe(50);
    });
  });

  describe("HumanInTheLoop", () => {
    it("should track pending reviews and resolve them", async () => {
      const mockProposal = { id: "p1", confidence: 0.8, targetFile: "app.ts", originalContent: "old", proposedContent: "new", rationale: "fix" } as ImprovementProposal;
      
      const reviewPromise = requestHumanReview(mockProposal);
      expect(getPendingReviewCount()).toBe(1);
      
      resolveReview("p1", { approved: true, humanEditedCode: "human code" });
      
      const result = await reviewPromise;
      expect(result.approved).toBe(true);
      expect(result.humanEditedCode).toBe("human code");
      expect(getPendingReviewCount()).toBe(0);
    });
  });

  describe("CausalIntervention", () => {
    it("should simulate interventions and calculate cascading failure risk", () => {
      const mockProposal = { targetFile: "target.ts" } as ImprovementProposal;
      const intervention = simulateCausalIntervention(mockProposal);
      
      expect(intervention.cascadingFailureRisk).toBe(0.9); // 1 - 0.1 probability
      expect(intervention.affectedDownstreamNodes).toContain("downstream.ts");
      // Safety threshold is 0.5 + (0.9 * 0.4) = 0.86. Target probability is 0.9.
      expect(intervention.isSafeToProceed).toBe(true);
    });
  });

  describe("ArxivSubmitter", () => {
    it("should reject papers that are too short", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p && p.toString().includes("submitted_papers.json")) return true;
        return true;
      });
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (p && p.toString().includes("submitted_papers.json")) return "{}";
        return "Short paper. Abstract: yes. [1] Ref.";
      });
      
      const result = await submitToArxiv("paper.md");
      expect(result.success).toBe(false);
      expect(result.feedback).toContain("too short");
    });
  });

  describe("NeuroplasticAdapter", () => {
    it("should suspend stages that always pass and have high cost", () => {
      // Force performance to 100
      recordStagePerformance("adversarial_self_play", true);
      
      // Assume initial state is active
      expect(isStageActive("adversarial_self_play")).toBe(true);
      
      evaluatePipelinePlasticity();
      
      // Should be suspended because costWeight is 8 (>5) and score is 100
      expect(isStageActive("adversarial_self_play")).toBe(false);
    });
  });
});
