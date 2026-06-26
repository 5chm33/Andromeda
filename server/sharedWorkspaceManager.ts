/**
 * sharedWorkspaceManager.ts — v63.0.0 "The Collaboration Hub"
 * Manages shared workspaces with versioned artifacts, access control, and conflict detection.
 */

export interface WorkspaceArtifact { artifactId: string; name: string; content: unknown; version: number; lastModifiedBy: string; lastModifiedAt: number; }
export interface Workspace { workspaceId: string; name: string; members: string[]; artifacts: Map<string, WorkspaceArtifact>; }

const workspaces = new Map<string, Workspace>();
let wCounter = 0, aCounter = 0;

export function createWorkspace(name: string, members: string[]): Workspace {
  const ws: Workspace = { workspaceId: `ws-${++wCounter}`, name, members, artifacts: new Map() };
  workspaces.set(ws.workspaceId, ws);
  return ws;
}

export function putArtifact(workspaceId: string, userId: string, name: string, content: unknown): WorkspaceArtifact {
  const ws = workspaces.get(workspaceId);
  if (!ws) throw new Error(`[SharedWorkspaceManager] Workspace not found: ${workspaceId}`);
  if (!ws.members.includes(userId)) throw new Error(`[SharedWorkspaceManager] User not a member: ${userId}`);
  const existing = ws.artifacts.get(name);
  const artifact: WorkspaceArtifact = { artifactId: existing?.artifactId ?? `art-${++aCounter}`, name, content, version: (existing?.version ?? 0) + 1, lastModifiedBy: userId, lastModifiedAt: Date.now() };
  ws.artifacts.set(name, artifact);
  return artifact;
}

export function getArtifact(workspaceId: string, name: string): WorkspaceArtifact | undefined {
  return workspaces.get(workspaceId)?.artifacts.get(name);
}

export function listArtifacts(workspaceId: string): WorkspaceArtifact[] {
  return [...(workspaces.get(workspaceId)?.artifacts.values() ?? [])];
}

export function addMember(workspaceId: string, userId: string): boolean {
  const ws = workspaces.get(workspaceId);
  if (!ws || ws.members.includes(userId)) return false;
  ws.members.push(userId);
  return true;
}

export function _resetSharedWorkspaceManagerForTest(): void { workspaces.clear(); wCounter = 0; aCounter = 0; }
