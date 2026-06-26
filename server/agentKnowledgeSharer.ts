/**
 * agentKnowledgeSharer.ts — v50.0.0
 *
 * Enables agents to share, request, and receive knowledge artifacts
 * across the sub-agent economy with versioning and access control.
 */

export interface KnowledgeArtifact {
  artifactId: string;
  ownerId: string;
  topic: string;
  content: unknown;
  version: number;
  accessLevel: "private" | "shared" | "public";
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeRequest {
  requestId: string;
  requesterId: string;
  topic: string;
  fulfilled: boolean;
  artifactId?: string;
}

const artifacts = new Map<string, KnowledgeArtifact>();
const requests: KnowledgeRequest[] = [];
let artifactCounter = 0;
let requestCounter = 0;

export function publishArtifact(
  ownerId: string,
  topic: string,
  content: unknown,
  accessLevel: KnowledgeArtifact["accessLevel"] = "shared",
  tags: string[] = []
): KnowledgeArtifact {
  const existing = Array.from(artifacts.values()).find(a => a.ownerId === ownerId && a.topic === topic);
  if (existing) {
    existing.content = content;
    existing.version++;
    existing.updatedAt = Date.now();
    return existing;
  }

  const artifact: KnowledgeArtifact = {
    artifactId: `ka-${++artifactCounter}`,
    ownerId,
    topic,
    content,
    version: 1,
    accessLevel,
    tags,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  artifacts.set(artifact.artifactId, artifact);
  return artifact;
}

export function requestKnowledge(requesterId: string, topic: string): KnowledgeRequest {
  const req: KnowledgeRequest = {
    requestId: `kr-${++requestCounter}`,
    requesterId,
    topic,
    fulfilled: false,
  };

  // Try to fulfill immediately
  const match = Array.from(artifacts.values()).find(a =>
    a.topic === topic &&
    (a.accessLevel === "public" || a.accessLevel === "shared" || a.ownerId === requesterId)
  );

  if (match) {
    req.fulfilled = true;
    req.artifactId = match.artifactId;
  }

  requests.push(req);
  return req;
}

export function searchArtifacts(query: string, requesterId: string): KnowledgeArtifact[] {
  const lower = query.toLowerCase();
  return Array.from(artifacts.values()).filter(a =>
    (a.accessLevel !== "private" || a.ownerId === requesterId) &&
    (a.topic.toLowerCase().includes(lower) || a.tags.some(t => t.toLowerCase().includes(lower)))
  );
}

export function getArtifact(artifactId: string, requesterId: string): KnowledgeArtifact | null {
  const artifact = artifacts.get(artifactId);
  if (!artifact) return null;
  if (artifact.accessLevel === "private" && artifact.ownerId !== requesterId) return null;
  return artifact;
}

export function _resetKnowledgeSharerForTest(): void {
  artifacts.clear();
  requests.length = 0;
  artifactCounter = 0;
  requestCounter = 0;
}
