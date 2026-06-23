/**
 * crossDomainAdapter.test.ts — Unit tests for Phase 3 cross-domain adapter
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerArtifact,
  getCrossDomainStats,
  getDomainAdapters,
  listArtifacts,
  getArtifact,
  initCrossDomainAdapter,
} from "./crossDomainAdapter.js";

describe("crossDomainAdapter", () => {
  beforeEach(() => {
    initCrossDomainAdapter();
  });

  describe("getDomainAdapters", () => {
    it("returns all 5 domain adapters", () => {
      const adapters = getDomainAdapters();
      expect(adapters.length).toBe(5);
    });

    it("includes legal domain", () => {
      const adapters = getDomainAdapters();
      expect(adapters.some(a => a.domain === "legal")).toBe(true);
    });

    it("includes scientific domain", () => {
      const adapters = getDomainAdapters();
      expect(adapters.some(a => a.domain === "scientific")).toBe(true);
    });

    it("includes logistics domain", () => {
      const adapters = getDomainAdapters();
      expect(adapters.some(a => a.domain === "logistics")).toBe(true);
    });

    it("includes writing domain", () => {
      const adapters = getDomainAdapters();
      expect(adapters.some(a => a.domain === "writing")).toBe(true);
    });

    it("includes data_pipeline domain", () => {
      const adapters = getDomainAdapters();
      expect(adapters.some(a => a.domain === "data_pipeline")).toBe(true);
    });

    it("each adapter has evaluation dimensions", () => {
      const adapters = getDomainAdapters();
      for (const adapter of adapters) {
        expect(adapter.evaluationDimensions.length).toBeGreaterThan(0);
      }
    });
  });

  describe("registerArtifact", () => {
    it("registers a legal artifact", () => {
      const artifact = registerArtifact("legal", "Service Agreement", "This agreement governs...", {});
      expect(artifact.id).toBeTruthy();
      expect(artifact.domain).toBe("legal");
      expect(artifact.name).toBe("Service Agreement");
      expect(artifact.version).toBe(1);
    });

    it("registers a writing artifact", () => {
      const artifact = registerArtifact("writing", "API Documentation", "# API Reference\n...", {});
      expect(artifact.domain).toBe("writing");
    });

    it("assigns a unique ID to each artifact", () => {
      const a1 = registerArtifact("legal", "Contract 1", "content 1");
      const a2 = registerArtifact("legal", "Contract 2", "content 2");
      expect(a1.id).not.toBe(a2.id);
    });

    it("stores metadata", () => {
      const artifact = registerArtifact("scientific", "Protocol A", "content", { version: "2.0", author: "Dr. Smith" });
      expect(artifact.metadata).toEqual({ version: "2.0", author: "Dr. Smith" });
    });
  });

  describe("getArtifact", () => {
    it("retrieves a registered artifact by ID", () => {
      const registered = registerArtifact("logistics", "Route Config", "config content");
      const retrieved = getArtifact(registered.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(registered.id);
    });

    it("returns undefined for unknown ID", () => {
      const result = getArtifact("nonexistent-id");
      expect(result).toBeUndefined();
    });
  });

  describe("listArtifacts", () => {
    it("lists all artifacts when no domain filter", () => {
      registerArtifact("legal", "Contract", "content");
      registerArtifact("writing", "Doc", "content");
      const all = listArtifacts();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it("filters by domain", () => {
      registerArtifact("data_pipeline", "ETL Config", "config");
      const dataPipeline = listArtifacts("data_pipeline");
      expect(dataPipeline.every(a => a.domain === "data_pipeline")).toBe(true);
    });
  });

  describe("getCrossDomainStats", () => {
    it("returns valid stats structure", () => {
      const stats = getCrossDomainStats();
      expect(typeof stats.totalArtifacts).toBe("number");
      expect(typeof stats.totalProposals).toBe("number");
      expect(typeof stats.approvedProposals).toBe("number");
      expect(typeof stats.approvalRate).toBe("number");
      expect(typeof stats.byDomain).toBe("object");
      expect(Array.isArray(stats.supportedDomains)).toBe(true);
    });

    it("lists all supported domains", () => {
      const stats = getCrossDomainStats();
      const domainNames = stats.supportedDomains.map(d => d.domain);
      expect(domainNames).toContain("legal");
      expect(domainNames).toContain("scientific");
      expect(domainNames).toContain("logistics");
      expect(domainNames).toContain("writing");
      expect(domainNames).toContain("data_pipeline");
    });
  });
});
