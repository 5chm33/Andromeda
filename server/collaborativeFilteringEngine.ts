/**
 * collaborativeFilteringEngine.ts — v63.0.0 "The Collaboration Hub"
 * Collaborative filtering for agent recommendations using cosine similarity.
 */

export interface UserRating { userId: string; itemId: string; rating: number; }
export interface Recommendation { itemId: string; predictedRating: number; confidence: number; basedOnUsers: string[]; }

const ratings: UserRating[] = [];

export function addRating(userId: string, itemId: string, rating: number): void {
  const existing = ratings.findIndex(r => r.userId === userId && r.itemId === itemId);
  if (existing >= 0) ratings[existing].rating = rating;
  else ratings.push({ userId, itemId, rating });
}

function cosineSimilarity(u1: string, u2: string): number {
  const u1Ratings = ratings.filter(r => r.userId === u1);
  const commonItems = u1Ratings.filter(r => ratings.some(r2 => r2.userId === u2 && r2.itemId === r.itemId));
  if (commonItems.length === 0) return 0;
  const u2Map = new Map(ratings.filter(r => r.userId === u2).map(r => [r.itemId, r.rating]));
  const dot = commonItems.reduce((s, r) => s + r.rating * (u2Map.get(r.itemId) ?? 0), 0);
  const mag1 = Math.sqrt(commonItems.reduce((s, r) => s + r.rating * r.rating, 0));
  const mag2 = Math.sqrt(commonItems.reduce((s, r) => s + Math.pow(u2Map.get(r.itemId) ?? 0, 2), 0));
  return mag1 > 0 && mag2 > 0 ? dot / (mag1 * mag2) : 0;
}

export function getRecommendations(userId: string, topN = 5): Recommendation[] {
  const userItems = new Set(ratings.filter(r => r.userId === userId).map(r => r.itemId));
  const allUsers = [...new Set(ratings.map(r => r.userId))].filter(u => u !== userId);
  const similarities = allUsers.map(u => ({ userId: u, sim: cosineSimilarity(userId, u) })).filter(s => s.sim > 0);
  const candidates = new Map<string, { weightedSum: number; simSum: number; users: string[] }>();
  for (const { userId: u, sim } of similarities) {
    for (const r of ratings.filter(r2 => r2.userId === u && !userItems.has(r2.itemId))) {
      if (!candidates.has(r.itemId)) candidates.set(r.itemId, { weightedSum: 0, simSum: 0, users: [] });
      const c = candidates.get(r.itemId)!;
      c.weightedSum += sim * r.rating;
      c.simSum += sim;
      c.users.push(u);
    }
  }
  return [...candidates.entries()]
    .map(([itemId, c]) => ({ itemId, predictedRating: c.simSum > 0 ? c.weightedSum / c.simSum : 0, confidence: Math.min(1, c.users.length / 3), basedOnUsers: c.users }))
    .sort((a, b) => b.predictedRating - a.predictedRating)
    .slice(0, topN);
}

export function _resetCollaborativeFilteringEngineForTest(): void { ratings.length = 0; }
