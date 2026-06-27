/**
 * sbomGenerator.ts — v76.0.0 "Supply Chain & Dependency Management"
 * Generates a Software Bill of Materials (SBOM) in CycloneDX-compatible JSON format.
 */
export interface SbomComponent {
  type: "library" | "framework" | "application" | "container" | "device";
  name: string;
  version: string;
  purl: string;
  licenses: string[];
  hashes: Array<{ algorithm: string; value: string }>;
  supplier: string | null;
}

export interface Sbom {
  sbomId: string;
  specVersion: string;
  version: number;
  serialNumber: string;
  metadata: {
    timestamp: string;
    component: { name: string; version: string };
  };
  components: SbomComponent[];
  generatedAt: number;
}

const sbomHistory: Sbom[] = [];
let sbomCounter = 0;

function generatePurl(ecosystem: string, name: string, version: string): string {
  return `pkg:${ecosystem}/${name}@${version}`;
}

function generateSerialNumber(): string {
  const chars = "abcdef0123456789";
  return "urn:uuid:" + [8, 4, 4, 4, 12].map(len => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("")).join("-");
}

export function generateSbom(projectName: string, projectVersion: string, components: Array<{ name: string; version: string; ecosystem: string; licenses: string[]; supplier?: string }>): Sbom {
  const sbomComponents: SbomComponent[] = components.map(c => ({
    type: "library",
    name: c.name,
    version: c.version,
    purl: generatePurl(c.ecosystem, c.name, c.version),
    licenses: c.licenses,
    hashes: [],
    supplier: c.supplier ?? null,
  }));

  const sbom: Sbom = {
    sbomId: `sbom-${++sbomCounter}`,
    specVersion: "1.4",
    version: 1,
    serialNumber: generateSerialNumber(),
    metadata: {
      timestamp: new Date().toISOString(),
      component: { name: projectName, version: projectVersion },
    },
    components: sbomComponents,
    generatedAt: Date.now(),
  };

  sbomHistory.push(sbom);
  console.log(`[SbomGenerator] Generated SBOM for ${projectName}@${projectVersion}: ${sbomComponents.length} components`);
  return sbom;
}

export function getSbomHistory(): Sbom[] { return [...sbomHistory]; }
export function _resetSbomGeneratorForTest(): void { sbomHistory.length = 0; sbomCounter = 0; }
