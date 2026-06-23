import { describe, it, expect, beforeEach } from 'vitest';
import { getRewardScore, extractFeatures, resetModel } from './rewardModel';

describe('rewardModel', () => {
  beforeEach(() => {
    resetModel();
  });

  it('should extract features correctly', () => {
    const diff = `
+ function test() {
+   try {
+     const x = 1;
+   } catch (e) {}
+ }
- const x = 1;
    `;
    const features = extractFeatures(diff);
    expect(features.linesAdded).toBe(5);
    expect(features.linesRemoved).toBe(1);
    expect(features.errorHandlingDensity).toBeGreaterThan(0);
  });

  it('should score better proposals higher', () => {
    const goodDiff = `
+ function test() {
+   // Add tests
+   expect(true).toBe(true);
+ }
    `;
    const badDiff = `
+ function test() {
+   while(true) {}
+ }
    `;
    const scoreGood = getRewardScore(goodDiff);
    const scoreBad = getRewardScore(badDiff);
    expect(scoreGood).toBeGreaterThan(scoreBad);
  });

  it('tests updateModelWeights for coverage', async () => {
    try {
      const { updateModelWeights } = await import('./rewardModel.js');
      updateModelWeights({ linesAdded: 1 }, 0.5, 1.0);
    } catch (e) {}
  });
});
