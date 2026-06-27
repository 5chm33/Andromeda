/**
 * dataCatalog.ts — v69.0.0 "Data Pipeline"
 * Centralized data catalog with schema registry, discovery, and metadata management.
 */
export interface DataAsset { assetId: string; name: string; type: "table" | "stream" | "file" | "api"; schema: Record<string, string>; owner: string; tags: string[]; description: string; recordCount?: number; lastUpdated: number; }

const catalog = new Map<string, DataAsset>();
let assetCounter = 0;

export function registerDataAsset(name: string, type: DataAsset["type"], schema: Record<string, string>, owner: string, tags: string[] = [], description = ""): DataAsset {
  const asset: DataAsset = { assetId: `asset-${++assetCounter}`, name, type, schema, owner, tags, description, lastUpdated: Date.now() };
  catalog.set(asset.assetId, asset);
  return asset;
}

export function searchCatalog(query: string): DataAsset[] {
  const q = query.toLowerCase();
  return [...catalog.values()].filter(a => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.tags.some(t => t.toLowerCase().includes(q)));
}

export function getAsset(assetId: string): DataAsset | undefined { return catalog.get(assetId); }
export function listAssets(): DataAsset[] { return [...catalog.values()]; }
export function updateAssetMetadata(assetId: string, updates: Partial<Pick<DataAsset, "tags" | "description" | "recordCount">>): DataAsset {
  const asset = catalog.get(assetId);
  if (!asset) throw new Error(`[DataCatalog] Asset not found: ${assetId}`);
  Object.assign(asset, updates, { lastUpdated: Date.now() });
  return asset;
}
export function _resetDataCatalogForTest(): void { catalog.clear(); assetCounter = 0; }
