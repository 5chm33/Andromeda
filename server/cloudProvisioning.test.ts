import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock child_process for CLI commands
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execSync: vi.fn((cmd: string) => {
      if (cmd.includes("aws --version")) return "aws-cli/2.0.0";
      if (cmd.includes("flyctl version")) return "flyctl v0.1.0";
      if (cmd.includes("gcloud --version")) return "Google Cloud SDK 400.0.0";
      if (cmd.includes("hcloud version")) return "hcloud v1.0.0";
      if (cmd.includes("aws ec2 run-instances")) return "i-0123456789abcdef0";
      if (cmd.includes("flyctl launch")) return "";
      if (cmd.includes("hcloud server create")) {
        return JSON.stringify({ server: { id: 12345, public_net: { ipv4: { ip: "1.2.3.4" } } } });
      }
      if (cmd.includes("aws ec2 terminate-instances")) return "";
      if (cmd.includes("hcloud server delete")) return "";
      if (cmd.includes("flyctl apps destroy")) return "";
      return "";
    }),
  };
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-cloud-test-"));
  process.env.ANDROMEDA_WORKSPACE = tmpDir;
  fs.mkdirSync(path.join(tmpDir, "server", "data"), { recursive: true });
  // Disable actual provisioning by default
  delete process.env.CLOUD_PROVISIONING_ENABLED;
});

afterEach(() => {
  delete process.env.ANDROMEDA_WORKSPACE;
  delete process.env.CLOUD_PROVISIONING_ENABLED;
  delete process.env.ALLOW_CLOUD_DESTROY; // v11.4.0: clean up guard env var
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("cloudProvisioning", () => {
  it("detectAvailableProviders returns array of available providers", async () => {
    const { detectAvailableProviders } = await import("./cloudProvisioning.js");
    const providers = detectAvailableProviders();

    expect(Array.isArray(providers)).toBe(true);
    // With our mocks, all 4 providers should be detected
    expect(providers).toContain("aws");
    expect(providers).toContain("fly");
    expect(providers).toContain("gcp");
    expect(providers).toContain("hetzner");
  });

  it("provisionInstance throws when CLOUD_PROVISIONING_ENABLED is not set", async () => {
    const { provisionInstance } = await import("./cloudProvisioning.js");

    await expect(
      provisionInstance({
        provider: "fly",
        instanceType: "shared-cpu-1x",
        region: "iad",
        purpose: "evolutionary_search",
        lifetimeHours: 2,
      })
    ).rejects.toThrow("Cloud provisioning disabled");
  });

  it("provisionInstance provisions a Fly.io instance when enabled", async () => {
    process.env.CLOUD_PROVISIONING_ENABLED = "true";
    const { provisionInstance, getProvisioningState } = await import("./cloudProvisioning.js");

    const instance = await provisionInstance({
      provider: "fly",
      instanceType: "shared-cpu-1x",
      region: "iad",
      purpose: "evolutionary_search",
      lifetimeHours: 2,
    });

    expect(instance.provider).toBe("fly");
    expect(instance.instanceType).toBe("shared-cpu-1x");
    expect(instance.purpose).toBe("evolutionary_search");
    expect(instance.status).toBe("provisioning");
    expect(instance.terminateAt).toBeGreaterThan(instance.createdAt);

    // Verify saved to state
    const state = getProvisioningState();
    expect(state.instances.some((i) => i.instanceId === instance.instanceId)).toBe(true);
  });

  it("provisionInstance provisions an AWS instance when enabled", async () => {
    process.env.CLOUD_PROVISIONING_ENABLED = "true";
    const { provisionInstance } = await import("./cloudProvisioning.js");

    const instance = await provisionInstance({
      provider: "aws",
      instanceType: "t3.micro",
      region: "us-east-1",
      purpose: "shadow_test",
      lifetimeHours: 1,
    });

    expect(instance.provider).toBe("aws");
    expect(instance.purpose).toBe("shadow_test");
    expect(instance.instanceId).toBe("i-0123456789abcdef0");
  });

  it("provisionInstance provisions a Hetzner instance when enabled", async () => {
    process.env.CLOUD_PROVISIONING_ENABLED = "true";
    const { provisionInstance } = await import("./cloudProvisioning.js");

    const instance = await provisionInstance({
      provider: "hetzner",
      instanceType: "cx11",
      region: "nbg1",
      purpose: "federated_peer",
      lifetimeHours: 4,
    });

    expect(instance.provider).toBe("hetzner");
    expect(instance.instanceId).toBe("12345");
    expect(instance.publicIp).toBe("1.2.3.4");
  });

  it("terminateInstance is blocked without ALLOW_CLOUD_DESTROY=true (v11.4.0 guard)", async () => {
    // The guard must throw before any cloud operation when ALLOW_CLOUD_DESTROY is not set
    delete process.env.ALLOW_CLOUD_DESTROY;
    const { terminateInstance } = await import("./cloudProvisioning.js");
    await expect(terminateInstance("any-instance-id")).rejects.toThrow(
      "ALLOW_CLOUD_DESTROY=true"
    );
  });

  it("terminateInstance marks instance as terminated when ALLOW_CLOUD_DESTROY=true", async () => {
    process.env.CLOUD_PROVISIONING_ENABLED = "true";
    process.env.ALLOW_CLOUD_DESTROY = "true"; // v11.4.0: required for destructive operations
    const { provisionInstance, terminateInstance, getProvisioningState } = await import("./cloudProvisioning.js");

    const instance = await provisionInstance({
      provider: "fly",
      instanceType: "shared-cpu-1x",
      region: "iad",
      purpose: "lora_training",
      lifetimeHours: 1,
    });

    // Manually set status to running so it can be terminated
    const state = getProvisioningState();
    const found = state.instances.find((i) => i.instanceId === instance.instanceId);
    if (found) found.status = "running";
    const stateFile = path.join(tmpDir, "server", "data", "cloudProvisioning.json");
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

    const success = await terminateInstance(instance.instanceId);
    expect(success).toBe(true);

    const updatedState = getProvisioningState();
    const terminated = updatedState.instances.find((i) => i.instanceId === instance.instanceId);
    expect(terminated?.status).toBe("terminated");
  });

  it("autoTerminateExpiredInstances terminates expired running instances", async () => {
    process.env.CLOUD_PROVISIONING_ENABLED = "true";
    process.env.ALLOW_CLOUD_DESTROY = "true"; // v11.4.0: required for destructive operations
    const { autoTerminateExpiredInstances, getProvisioningState } = await import("./cloudProvisioning.js");

    // Manually inject an expired instance into state
    const stateFile = path.join(tmpDir, "server", "data", "cloudProvisioning.json");
    const expiredInstance = {
      instanceId: "expired-instance-001",
      provider: "fly" as const,
      instanceType: "shared-cpu-1x",
      region: "iad",
      status: "running" as const,
      purpose: "evolutionary_search",
      createdAt: Date.now() - 7200_000,
      terminateAt: Date.now() - 3600_000, // Expired 1 hour ago
    };
    fs.writeFileSync(stateFile, JSON.stringify({
      instances: [expiredInstance],
      totalSpendUsd: 0,
      monthlyBudgetUsd: 50,
      lastUpdated: Date.now(),
    }, null, 2));

    const terminated = await autoTerminateExpiredInstances();
    expect(terminated).toContain("expired-instance-001");
  });

  it("getProvisioningState returns correct structure", async () => {
    const { getProvisioningState } = await import("./cloudProvisioning.js");
    const state = getProvisioningState();

    expect(Array.isArray(state.instances)).toBe(true);
    expect(typeof state.totalSpendUsd).toBe("number");
    expect(typeof state.monthlyBudgetUsd).toBe("number");
    expect(typeof state.lastUpdated).toBe("number");
  });
});
