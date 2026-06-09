import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("selfModifyHelpers", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-helpers-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    
    // Create basic structure
    fs.mkdirSync(path.join(tmpDir, "server", "tools"), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("getServerDir and getProjectRoot", () => {
    it("should resolve server dir correctly", async () => {
      // In tests, import.meta.url will be inside the server/tools directory
      const { getServerDir, getProjectRoot } = await import("./selfModifyHelpers");
      
      const serverDir = getServerDir();
      const projectRoot = getProjectRoot();
      
      expect(serverDir.endsWith("server")).toBe(true);
      expect(projectRoot.endsWith("andromeda_fresh")).toBe(true);
    });
  });

  describe("isForbidden", () => {
    it("should correctly identify forbidden files", async () => {
      const { isForbidden } = await import("./selfModifyHelpers");
      
      expect(isForbidden("server/tools/selfModifyHelpers.ts")).toBe(true);
      expect(isForbidden("andromeda-constitution.json")).toBe(true);
      expect(isForbidden("./server/recursionGuard.ts")).toBe(true);
      
      // Allow non-forbidden
      expect(isForbidden("server/ai.ts")).toBe(false);
      expect(isForbidden("package.json")).toBe(false);
    });
  });

  describe("resolveServerPath", () => {
    it("should translate src/ prefix to server/", async () => {
      const { resolveServerPath, getProjectRoot } = await import("./selfModifyHelpers");
      const root = getProjectRoot();
      
      const resolved = resolveServerPath("src/ai.ts");
      expect(resolved).toBe(path.join(root, "server", "ai.ts"));
    });

    it("should resolve absolute paths inside project root", async () => {
      const { resolveServerPath, getProjectRoot } = await import("./selfModifyHelpers");
      const root = getProjectRoot();
      
      const absolutePath = path.join(root, "package.json");
      const resolved = resolveServerPath(absolutePath);
      
      expect(resolved).toBe(absolutePath);
    });

    it("should throw if path is outside project root", async () => {
      const { resolveServerPath } = await import("./selfModifyHelpers");
      
      expect(() => resolveServerPath("../../../etc/passwd")).toThrow("outside the project root");
    });
    
    it("should handle bare filenames that exist in server", async () => {
      const { resolveServerPath, getServerDir } = await import("./selfModifyHelpers");
      const serverDir = getServerDir();
      
      // Create a fake file in the actual server dir
      const fakeFile = path.join(serverDir, "test_bare_file.ts");
      fs.writeFileSync(fakeFile, "test");
      
      try {
        const resolved = resolveServerPath("test_bare_file.ts");
        expect(resolved).toBe(fakeFile);
      } finally {
        fs.unlinkSync(fakeFile);
      }
    });
  });
});
