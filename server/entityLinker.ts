/**
 * entityLinker.ts — v85.0.0 "Knowledge Graph & Reasoning"
 * Links named entities in text to knowledge graph nodes using string matching and disambiguation.
 */
export interface EntityMention {
  text: string;
  startOffset: number;
  endOffset: number;
  entityType: string;
  linkedNodeId: string | null;
  confidence: number;
  candidates: Array<{ nodeId: string; label: string; score: number }>;
}

export interface LinkingResult {
  inputText: string;
  mentions: EntityMention[];
  linkedCount: number;
  ambiguousCount: number;
}

export interface KnowledgeEntity {
  nodeId: string;
  label: string;
  aliases: string[];
  type: string;
  popularity: number;
}

const entityRegistry = new Map<string, KnowledgeEntity>();
let entityCounter = 0;

export function registerEntity(label: string, aliases: string[], type: string, popularity = 1): KnowledgeEntity {
  const entity: KnowledgeEntity = { nodeId: `ent-${++entityCounter}`, label, aliases, type, popularity };
  entityRegistry.set(entity.nodeId, entity);
  return entity;
}

function normalizeText(text: string): string { return text.toLowerCase().trim().replace(/[^a-z0-9\s]/g, ""); }

function findCandidates(mention: string): Array<{ nodeId: string; label: string; score: number }> {
  const normalized = normalizeText(mention);
  const candidates: Array<{ nodeId: string; label: string; score: number }> = [];

  for (const entity of entityRegistry.values()) {
    const allLabels = [entity.label, ...entity.aliases];
    for (const label of allLabels) {
      const normLabel = normalizeText(label);
      if (normLabel === normalized) {
        candidates.push({ nodeId: entity.nodeId, label: entity.label, score: 1.0 * entity.popularity });
      } else if (normLabel.includes(normalized) || normalized.includes(normLabel)) {
        const overlap = Math.min(normalized.length, normLabel.length) / Math.max(normalized.length, normLabel.length);
        candidates.push({ nodeId: entity.nodeId, label: entity.label, score: overlap * entity.popularity });
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}

export function linkEntities(text: string, entityMentions: Array<{ text: string; start: number; end: number; type: string }>): LinkingResult {
  const mentions: EntityMention[] = [];
  let linkedCount = 0;
  let ambiguousCount = 0;

  for (const mention of entityMentions) {
    const candidates = findCandidates(mention.text);
    const topCandidate = candidates[0];
    const isAmbiguous = candidates.length > 1 && candidates[1].score > topCandidate?.score * 0.8;

    mentions.push({
      text: mention.text,
      startOffset: mention.start,
      endOffset: mention.end,
      entityType: mention.type,
      linkedNodeId: topCandidate?.nodeId ?? null,
      confidence: topCandidate?.score ?? 0,
      candidates,
    });

    if (topCandidate) linkedCount++;
    if (isAmbiguous) ambiguousCount++;
  }

  return { inputText: text, mentions, linkedCount, ambiguousCount };
}

export function getEntity(nodeId: string): KnowledgeEntity | undefined { return entityRegistry.get(nodeId); }
export function getEntityCount(): number { return entityRegistry.size; }
export function _resetEntityLinkerForTest(): void { entityRegistry.clear(); entityCounter = 0; }
