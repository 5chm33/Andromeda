import { describe, it, expect, vi } from "vitest";

describe("v15 SOTA Enhancements", () => {
  it("proposalRanker > rankProposals deduplicates and ranks", async () => {
    const { rankProposals } = await import("./proposalRanker.js");
    const proposals = [
      { id: "1", title: "Fix A", targetFile: "foo.ts", area: "logic", content: "const x = 1;", safetyScore: 0.9, patternScore: 0.8, rewardScore: 0.9, complexity: 3 },
      { id: "2", title: "Fix A (duplicate)", targetFile: "foo.ts", area: "logic", content: "const x = 1;", safetyScore: 0.9, patternScore: 0.8, rewardScore: 0.9, complexity: 3 },
      { id: "3", title: "Fix B", targetFile: "bar.ts", area: "logic", content: "const y = 2;", safetyScore: 0.5, patternScore: 0.5, rewardScore: 0.5, complexity: 5 },
    ];
    const result = rankProposals(proposals);
    expect(result.ranked.length).toBe(3);
    expect(result.ranked.filter(r => r.isUnique).length).toBe(2);
    expect(result.ranked[0].id).toBe("1");
  });

  it("semanticDiffValidator > validateDiff flags dangerous AST changes", async () => {
    const { validateDiff } = await import("./semanticDiffValidator.js");
    const oldCode = "export function foo() { return 1; }";
    const newCode = "export function foo(x: number) { return x; }";
    const result = validateDiff(oldCode, newCode, "foo.ts");
    expect(result.safe).toBe(false);
    expect(result.breakingChanges.some(i => i.kind === "signature-changed")).toBe(true);
  });
});
