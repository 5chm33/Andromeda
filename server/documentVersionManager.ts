/**
 * documentVersionManager.ts — v82.0.0 "Document Intelligence"
 * Tracks document revisions, diffs, and supports rollback to prior versions.
 */
export interface DocumentVersion {
  versionId: string;
  docId: string;
  versionNumber: number;
  content: string;
  author: string;
  changeMessage: string;
  createdAt: number;
  wordCount: number;
}

export interface DiffResult {
  docId: string;
  fromVersion: number;
  toVersion: number;
  addedLines: number;
  removedLines: number;
  changedWords: number;
}

const versions = new Map<string, DocumentVersion[]>();
let versionCounter = 0;

export function createVersion(docId: string, content: string, author: string, changeMessage: string): DocumentVersion {
  const existing = versions.get(docId) ?? [];
  const version: DocumentVersion = {
    versionId: `ver-${++versionCounter}`,
    docId,
    versionNumber: existing.length + 1,
    content,
    author,
    changeMessage,
    createdAt: Date.now(),
    wordCount: content.split(/\s+/).filter(Boolean).length,
  };
  existing.push(version);
  versions.set(docId, existing);
  return version;
}

export function getVersion(docId: string, versionNumber: number): DocumentVersion | null {
  return versions.get(docId)?.find(v => v.versionNumber === versionNumber) ?? null;
}

export function getLatestVersion(docId: string): DocumentVersion | null {
  const vers = versions.get(docId);
  if (!vers || vers.length === 0) return null;
  return vers[vers.length - 1];
}

export function diffVersions(docId: string, fromVersion: number, toVersion: number): DiffResult | null {
  const from = getVersion(docId, fromVersion);
  const to = getVersion(docId, toVersion);
  if (!from || !to) return null;

  const fromLines = from.content.split("\n");
  const toLines = to.content.split("\n");
  const fromWords = new Set(from.content.split(/\s+/));
  const toWords = new Set(to.content.split(/\s+/));

  const addedLines = toLines.filter(l => !fromLines.includes(l)).length;
  const removedLines = fromLines.filter(l => !toLines.includes(l)).length;
  const changedWords = [...toWords].filter(w => !fromWords.has(w)).length;

  return { docId, fromVersion, toVersion, addedLines, removedLines, changedWords };
}

export function getVersionHistory(docId: string): DocumentVersion[] { return [...(versions.get(docId) ?? [])]; }
export function getVersionCount(docId: string): number { return versions.get(docId)?.length ?? 0; }
export function _resetDocumentVersionManagerForTest(): void { versions.clear(); versionCounter = 0; }
