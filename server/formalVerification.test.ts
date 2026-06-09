import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-fv-test-"));
  process.env.ANDROMEDA_WORKSPACE = tmpDir;
});

afterEach(() => {
  delete process.env.ANDROMEDA_WORKSPACE;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("formalVerification", () => {
  it("verifies initSafety and writes TLA+ spec to disk", async () => {
    const { verifyModule } = await import("./formalVerification.js");
    const result = await verifyModule("initSafety");

    expect(result.moduleName).toBe("initSafety");
    expect(result.passed).toBe(true);
    expect(result.specPath).toContain("InitSafety.tla");
    expect(fs.existsSync(result.specPath)).toBe(true);

    const spec = fs.readFileSync(result.specPath, "utf8");
    expect(spec).toContain("MODULE InitSafety");
    expect(spec).toContain("SafetyInvariant");
    expect(spec).toContain("crashCount >= 3");
  });

  it("verifies fsWatcher and writes TLA+ spec to disk", async () => {
    const { verifyModule } = await import("./formalVerification.js");
    const result = await verifyModule("fsWatcher");

    expect(result.moduleName).toBe("fsWatcher");
    expect(result.passed).toBe(true);
    expect(result.specPath).toContain("FsWatcher.tla");
    expect(fs.existsSync(result.specPath)).toBe(true);

    const spec = fs.readFileSync(result.specPath, "utf8");
    expect(spec).toContain("MODULE FsWatcher");
    expect(spec).toContain("BoundedQueue");
    expect(spec).toContain("MaxQueueSize");
  });

  it("creates the specs directory if it does not exist", async () => {
    const { verifyModule } = await import("./formalVerification.js");
    const specsDir = path.join(tmpDir, "server", "specs");
    expect(fs.existsSync(specsDir)).toBe(false);

    await verifyModule("initSafety");

    expect(fs.existsSync(specsDir)).toBe(true);
  });

  it("generates a TLC config file alongside the spec", async () => {
    const { verifyModule } = await import("./formalVerification.js");
    await verifyModule("fsWatcher");

    const cfgPath = path.join(tmpDir, "server", "specs", "FsWatcher.cfg");
    expect(fs.existsSync(cfgPath)).toBe(true);
    const cfg = fs.readFileSync(cfgPath, "utf8");
    expect(cfg).toContain("MaxQueueSize");
    expect(cfg).toContain("BoundedQueue");
  });
});
