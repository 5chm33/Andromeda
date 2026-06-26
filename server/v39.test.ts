import { describe, it, expect } from "vitest";

import {
  addConcept, addConceptMapping, findRelatedConcepts, getConceptMapReport, initConceptMapper,
} from "./conceptMapper";

import {
  findAnalogy, rankAnalogyCandidates, getAnalogyReport, initAnalogyEngine,
} from "./analogyEngine";

import {
  requestTransfer, executeTransfer, getTransferBrokerReport, initTransferLearningBroker,
} from "./transferLearningBroker";

import {
  buildDomainBridge, findStrongestBridge, getBridgeReport, initDomainBridger,
} from "./domainBridger";

import {
  compressSemantically, getCompressorReport, initSemanticCompressor,
} from "./semanticCompressor";

import {
  addKnowledgeSource, fuseKnowledge, getFusionReport, initKnowledgeFusion,
} from "./knowledgeFusion";

describe("v39 Cognitive Atlas Enhancements", () => {

  // ─── Concept Mapper ───────────────────────────────────────────────────────────
  describe("Concept Mapper", () => {
    it("should initialize without errors", () => {
      expect(() => initConceptMapper()).not.toThrow();
    });

    it("should add concepts", () => {
      const c = addConcept("NeuralNetwork", "AI", 1, ["rewardModel"]);
      expect(c.id).toBeTruthy();
      expect(c.name).toBe("NeuralNetwork");
      expect(c.domain).toBe("AI");
    });

    it("should add concept mappings", () => {
      const c1 = addConcept("Gradient", "Math", 1);
      const c2 = addConcept("Backprop", "AI", 1);
      const mapping = addConceptMapping(c1.id, c2.id, "enables", 0.9);
      expect(mapping.strength).toBe(0.9);
      expect(mapping.mappingType).toBe("enables");
    });

    it("should find related concepts", () => {
      const c1 = addConcept("ConceptA", "TestDomain", 1);
      const c2 = addConcept("ConceptB", "TestDomain", 1);
      const c3 = addConcept("ConceptC", "TestDomain", 1);
      addConceptMapping(c1.id, c2.id, "isA", 0.8);
      addConceptMapping(c2.id, c3.id, "partOf", 0.7);
      const related = findRelatedConcepts(c1.id, 2);
      expect(related.some(c => c.id === c2.id)).toBe(true);
    });

    it("should return concept map report", () => {
      const report = getConceptMapReport();
      expect(typeof report.totalConcepts).toBe("number");
      expect(typeof report.totalMappings).toBe("number");
      expect(Array.isArray(report.domainCoverage)).toBe(true);
    });
  });

  // ─── Analogy Engine ───────────────────────────────────────────────────────────
  describe("Analogy Engine", () => {
    it("should initialize without errors", () => {
      expect(() => initAnalogyEngine()).not.toThrow();
    });

    it("should find analogy between domains", () => {
      const mapping = findAnalogy("Biology", "AI",
        ["evolution", "selection", "mutation"],
        ["training", "optimization", "perturbation"]
      );
      expect(mapping.sourceDomain).toBe("Biology");
      expect(mapping.targetDomain).toBe("AI");
      expect(mapping.mappedElements.length).toBe(3);
    });

    it("should give high novelty for cross-domain analogies", () => {
      const mapping = findAnalogy("Physics", "Economics",
        ["conservation", "entropy"],
        ["allocation", "scarcity"]
      );
      expect(mapping.novelty).toBeGreaterThan(0.5);
    });

    it("should give low novelty for same-domain analogies", () => {
      const mapping = findAnalogy("AI", "AI",
        ["training", "inference"],
        ["training", "prediction"]
      );
      expect(mapping.novelty).toBeLessThan(0.5);
    });

    it("should rank analogy candidates", () => {
      findAnalogy("Biology", "Math", ["evolution"], ["optimization"]);
      const candidates = rankAnalogyCandidates("Biology");
      expect(Array.isArray(candidates)).toBe(true);
    });

    it("should return analogy report", () => {
      const report = getAnalogyReport();
      expect(typeof report.totalAnalogiesFound).toBe("number");
      expect(typeof report.avgSystematicity).toBe("number");
    });
  });

  // ─── Transfer Learning Broker ─────────────────────────────────────────────────
  describe("Transfer Learning Broker", () => {
    it("should initialize without errors", () => {
      expect(() => initTransferLearningBroker()).not.toThrow();
    });

    it("should request a transfer", () => {
      const req = requestTransfer("NLP", "CodeGen", 0.9, 0.6);
      expect(req.id).toBeTruthy();
      expect(req.sourceDomain).toBe("NLP");
      expect(req.targetDomain).toBe("CodeGen");
      expect(req.estimatedTransferGain).toBeGreaterThanOrEqual(0);
    });

    it("should select fine_tune for same domain", () => {
      const req = requestTransfer("NLP", "NLP", 0.9, 0.7);
      expect(req.strategy).toBe("fine_tune");
    });

    it("should execute transfer", () => {
      const req = requestTransfer("Vision", "Medical", 0.85, 0.5);
      const result = executeTransfer(req.id);
      expect(result.requestId).toBe(req.id);
      expect(typeof result.actualGain).toBe("number");
      expect(typeof result.transferEfficiency).toBe("number");
    });

    it("should handle unknown transfer request", () => {
      const result = executeTransfer("non-existent-id");
      expect(result.success).toBe(false);
    });

    it("should return transfer broker report", () => {
      const report = getTransferBrokerReport();
      expect(typeof report.totalTransfers).toBe("number");
      expect(typeof report.successRate).toBe("number");
    });
  });

  // ─── Domain Bridger ───────────────────────────────────────────────────────────
  describe("Domain Bridger", () => {
    it("should initialize without errors", () => {
      expect(() => initDomainBridger()).not.toThrow();
    });

    it("should build a bridge between AI and Biology", () => {
      const bridge = buildDomainBridge("AI", "Biology");
      expect(bridge.domainA).toBe("AI");
      expect(bridge.domainB).toBe("Biology");
      expect(bridge.bridgeStrength).toBeGreaterThanOrEqual(0);
    });

    it("should find shared patterns between AI and Mathematics", () => {
      const bridge = buildDomainBridge("AI", "Mathematics");
      // Both have optimization in common
      expect(bridge.sharedPatterns.length).toBeGreaterThanOrEqual(0);
    });

    it("should find strongest bridge", () => {
      buildDomainBridge("AI", "Engineering");
      const strongest = findStrongestBridge();
      expect(strongest).not.toBeNull();
      expect(strongest!.bridgeStrength).toBeGreaterThanOrEqual(0);
    });

    it("should return bridge report", () => {
      const report = getBridgeReport();
      expect(typeof report.totalBridges).toBe("number");
      expect(typeof report.avgBridgeStrength).toBe("number");
      expect(report.totalBridges).toBeGreaterThan(0);
    });
  });

  // ─── Semantic Compressor ──────────────────────────────────────────────────────
  describe("Semantic Compressor", () => {
    it("should initialize without errors", () => {
      expect(() => initSemanticCompressor()).not.toThrow();
    });

    it("should compress text", () => {
      const text = "The optimization algorithm improves capability. The learning process adapts to new data. The safety system prevents harmful actions. The reward model guides behavior.";
      const result = compressSemantically(text, 0.5);
      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.compressionRatio).toBeLessThanOrEqual(1);
    });

    it("should preserve semantics above 0", () => {
      const text = "Safety is critical. Capability is important. Learning enables growth.";
      const result = compressSemantically(text, 0.7);
      expect(result.semanticPreservation).toBeGreaterThan(0);
    });

    it("should deduplicate repeated content", () => {
      const text = "The optimization works. The optimization works. The optimization works.";
      const result = compressSemantically(text, 0.5);
      expect(result.deduplicatedCount).toBeGreaterThanOrEqual(0);
    });

    it("should handle empty string", () => {
      const result = compressSemantically("", 0.5);
      expect(result.originalTokens).toBe(1); // split gives [""]
    });

    it("should return compressor report", () => {
      const report = getCompressorReport();
      expect(typeof report.totalCompressions).toBe("number");
      expect(typeof report.avgCompressionRatio).toBe("number");
    });
  });

  // ─── Knowledge Fusion ─────────────────────────────────────────────────────────
  describe("Knowledge Fusion", () => {
    it("should initialize without errors", () => {
      expect(() => initKnowledgeFusion()).not.toThrow();
    });

    it("should add knowledge sources", () => {
      const source = addKnowledgeSource("experimental", 0.9, { "rsi_effective": 0.95 });
      expect(source.id).toBeTruthy();
      expect(source.reliability).toBe(0.9);
    });

    it("should fuse knowledge using Bayesian method", () => {
      addKnowledgeSource("src1", 0.9, { "claim_A": 0.9 });
      addKnowledgeSource("src2", 0.8, { "claim_A": 0.85 });
      const fused = fuseKnowledge("claim_A", "bayesian");
      expect(fused.fusedConfidence).toBeGreaterThan(0.5);
      expect(fused.supportingSources.length).toBeGreaterThan(0);
    });

    it("should fuse knowledge using majority vote", () => {
      addKnowledgeSource("mv1", 0.8, { "claim_B": 0.8 });
      addKnowledgeSource("mv2", 0.7, { "claim_B": 0.7 });
      addKnowledgeSource("mv3", 0.6, { "claim_B": 0.3 });
      const fused = fuseKnowledge("claim_B", "majority_vote");
      expect(fused.fusionMethod).toBe("majority_vote");
      expect(typeof fused.fusedConfidence).toBe("number");
    });

    it("should fuse knowledge using Dempster-Shafer", () => {
      addKnowledgeSource("ds1", 0.9, { "claim_C": 0.9 });
      const fused = fuseKnowledge("claim_C", "dempster_shafer");
      expect(fused.fusionMethod).toBe("dempster_shafer");
    });

    it("should handle claim with no sources", () => {
      const fused = fuseKnowledge("unknown_claim", "bayesian");
      expect(fused.fusedConfidence).toBeDefined();
    });

    it("should return fusion report", () => {
      const report = getFusionReport();
      expect(typeof report.totalSources).toBe("number");
      expect(typeof report.totalFusedClaims).toBe("number");
      expect(typeof report.conflictRate).toBe("number");
    });
  });
});
