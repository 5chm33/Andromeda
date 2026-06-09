import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-lora-test-"));
  process.env.ANDROMEDA_WORKSPACE = tmpDir;
  process.env.FEDERATED_NODE_ID = "test-node-001";
  // Create server/data directory
  fs.mkdirSync(path.join(tmpDir, "server", "data"), { recursive: true });
});

afterEach(() => {
  delete process.env.ANDROMEDA_WORKSPACE;
  delete process.env.FEDERATED_NODE_ID;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("federatedLoraSharing", () => {
  it("packageLocalLoraWeights returns null when weights file does not exist", async () => {
    const { packageLocalLoraWeights } = await import("./federatedLoraSharing.js");
    const result = packageLocalLoraWeights(
      "deepseek-coder-6.7b",
      8,
      100,
      5.2,
      "/nonexistent/weights.bin"
    );
    expect(result).toBeNull();
  });

  it("packageLocalLoraWeights packages weights and saves to state", async () => {
    const { packageLocalLoraWeights, getFederatedLoraState } = await import("./federatedLoraSharing.js");

    // Create a fake weights file
    const weightsPath = path.join(tmpDir, "test-weights.bin");
    const fakeWeights = Buffer.from("fake-lora-weights-data-12345");
    fs.writeFileSync(weightsPath, fakeWeights);

    const pkg = packageLocalLoraWeights("deepseek-coder-6.7b", 8, 100, 5.2, weightsPath);

    expect(pkg).not.toBeNull();
    expect(pkg!.baseModel).toBe("deepseek-coder-6.7b");
    expect(pkg!.rank).toBe(8);
    expect(pkg!.steps).toBe(100);
    expect(pkg!.scoreDelta).toBe(5.2);
    expect(pkg!.sourceNodeId).toBe("test-node-001");
    expect(pkg!.checksum).toHaveLength(64); // SHA-256 hex
    expect(pkg!.sizeBytes).toBe(fakeWeights.length);

    // Verify it was saved to state
    const state = getFederatedLoraState();
    expect(state.packages.some((p) => p.packageId === pkg!.packageId)).toBe(true);
  });

  it("receiveLoraPackage validates checksum and saves to output dir", async () => {
    const { receiveLoraPackage } = await import("./federatedLoraSharing.js");

    const rawBytes = Buffer.from("peer-lora-weights-data");
    const checksum = crypto.createHash("sha256").update(rawBytes).digest("hex");
    const outputDir = path.join(tmpDir, "lora-received");

    const result = receiveLoraPackage(
      {
        packageId: crypto.randomUUID(),
        sourceNodeId: "peer-node-002",
        baseModel: "deepseek-coder-6.7b",
        rank: 8,
        steps: 200,
        scoreDelta: 3.1,
        weightsDelta: rawBytes.toString("base64"),
        checksum,
        sizeBytes: rawBytes.length,
        createdAt: Date.now(),
        mergeCount: 0,
      },
      outputDir
    );

    expect(result.success).toBe(true);
    expect(fs.existsSync(outputDir)).toBe(true);
    const files = fs.readdirSync(outputDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^federated-/);
  });

  it("receiveLoraPackage rejects package with invalid checksum", async () => {
    const { receiveLoraPackage } = await import("./federatedLoraSharing.js");

    const result = receiveLoraPackage(
      {
        packageId: crypto.randomUUID(),
        sourceNodeId: "peer-node-002",
        baseModel: "deepseek-coder-6.7b",
        rank: 8,
        steps: 200,
        scoreDelta: 3.1,
        weightsDelta: Buffer.from("tampered-data").toString("base64"),
        checksum: "0000000000000000000000000000000000000000000000000000000000000000",
        sizeBytes: 13,
        createdAt: Date.now(),
        mergeCount: 0,
      },
      path.join(tmpDir, "lora-bad")
    );

    expect(result.success).toBe(false);
    expect(result.reason).toBe("checksum_mismatch");
  });

  it("shareToolProposal saves proposal to state", async () => {
    const { shareToolProposal, getTopToolProposals } = await import("./federatedLoraSharing.js");

    const proposal = shareToolProposal(
      "myNewTool",
      "A tool that does amazing things",
      { type: "function", name: "myNewTool" },
      7.5
    );

    expect(proposal.toolName).toBe("myNewTool");
    expect(proposal.scoreDelta).toBe(7.5);
    expect(proposal.sourceNodeId).toBe("test-node-001");

    const top = getTopToolProposals(5);
    expect(top.some((p) => p.proposalId === proposal.proposalId)).toBe(true);
  });

  it("computeFederatedAverageScore computes trust-weighted average", async () => {
    const { computeFederatedAverageScore } = await import("./federatedLoraSharing.js");

    // Local score: 80, peer1: 90 (trust 0.8), peer2: 70 (trust 0.5)
    const avg = computeFederatedAverageScore(80, [
      { score: 90, trustScore: 0.8 },
      { score: 70, trustScore: 0.5 },
    ]);

    // Expected: (80*1 + 90*0.8 + 70*0.5) / (1 + 0.8 + 0.5) = (80+72+35)/2.3 = 187/2.3 ≈ 81.3
    expect(avg).toBeCloseTo(81.3, 0);
  });

  it("getAvailableLoraPackages filters out local node packages", async () => {
    const { packageLocalLoraWeights, getAvailableLoraPackages } = await import("./federatedLoraSharing.js");

    // Package local weights
    const weightsPath = path.join(tmpDir, "local-weights.bin");
    fs.writeFileSync(weightsPath, Buffer.from("local-data"));
    packageLocalLoraWeights("model", 4, 50, 2.0, weightsPath);

    // Available packages should not include local node's packages
    const available = getAvailableLoraPackages();
    expect(available.every((p) => p.sourceNodeId !== "test-node-001")).toBe(true);
  });
});
