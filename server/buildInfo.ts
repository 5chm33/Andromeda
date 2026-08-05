/**
 * buildInfo.ts — Single source of truth for Andromeda version identity.
 *
 * All runtime files that need to report a version MUST import from here.
 * The version is read from package.json at module load time so there is
 * exactly one place to update it.
 *
 * Elicit P2/P5: "One release version, one generated build-info module, and
 * CI-generated README/evaluation content should be mandatory."
 */

import { createRequire } from "module";
import * as path from "path";

const _require = createRequire(import.meta.url);

// Read version from package.json at the repo root
const pkg = _require(path.join(process.cwd(), "package.json")) as {
  version: string;
  name: string;
  description?: string;
};

export const ANDROMEDA_VERSION = pkg.version;
export const ANDROMEDA_NAME = pkg.name;

/**
 * Returns a structured build-info object for API responses, logs, and
 * evaluation cards. Includes the git commit hash when available.
 */
export function getBuildInfo(): {
  version: string;
  name: string;
  commitHash: string;
  buildTimestamp: string;
} {
  let commitHash = "unknown";
  try {
    // Read HEAD ref directly — avoids spawning a child process
    const { readFileSync } = _require("fs") as typeof import("fs");
    const headPath = path.join(process.cwd(), ".git", "HEAD");
    const head = readFileSync(headPath, "utf-8").trim();
    if (head.startsWith("ref: ")) {
      const refPath = path.join(process.cwd(), ".git", head.slice(5));
      commitHash = readFileSync(refPath, "utf-8").trim().slice(0, 8);
    } else {
      commitHash = head.slice(0, 8);
    }
  } catch {
    // Not in a git repo or .git not present (e.g. Docker image without .git)
  }

  return {
    version: ANDROMEDA_VERSION,
    name: ANDROMEDA_NAME,
    commitHash,
    buildTimestamp: new Date().toISOString(),
  };
}
