import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useDeployment, reconstructObjects } from "../../hooks/useDeployment";
import { DeploymentStatus, Template, CloudCredentials, UnityCatalogConfig } from "../../types";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

const template: Template = {
  id: "azure-simple",
  name: "Azure Simple",
  cloud: "azure",
  description: "Simple Azure workspace",
  features: ["vnet"],
  github_url: "https://github.com/OgnjenPantelic/workspace-creator/tree/main/src-tauri/templates/azure-simple",
};

const credentials: CloudCredentials = {
  azure_tenant_id: "tenant-123",
  azure_subscription_id: "sub-456",
};

const ucConfig: UnityCatalogConfig = {
  enabled: false,
  catalog_name: "",
  storage_name: "",
  metastore_id: "",
};

const successStatus: DeploymentStatus = {
  running: false,
  command: "apply",
  output: "Apply complete!",
  success: true,
  can_rollback: true,
};

const failedStatus: DeploymentStatus = {
  running: false,
  command: "apply",
  output: "Error: failed",
  success: false,
  can_rollback: true,
};

const runningStatus: DeploymentStatus = {
  running: true,
  command: "init",
  output: "Initializing...",
  success: null,
  can_rollback: false,
};

describe("useDeployment", () => {
  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------
  describe("initial state", () => {
    it("starts with default values", () => {
      const { result } = renderHook(() => useDeployment());

      expect(result.current.deploymentStatus).toBeNull();
      expect(result.current.deploymentStep).toBe("ready");
      expect(result.current.showDetailedLogs).toBe(false);
      expect(result.current.isRollingBack).toBe(false);
      expect(result.current.templatePath).toBe("");
      expect(result.current.deploymentName).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // State setters
  // ---------------------------------------------------------------------------
  describe("state setters", () => {
    it("setDeploymentStep updates step", () => {
      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.setDeploymentStep("deploying"); });
      expect(result.current.deploymentStep).toBe("deploying");
    });

    it("setShowDetailedLogs updates flag", () => {
      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.setShowDetailedLogs(true); });
      expect(result.current.showDetailedLogs).toBe(true);
    });

    it("setTemplatePath updates path", () => {
      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.setTemplatePath("/tmp/deploy"); });
      expect(result.current.templatePath).toBe("/tmp/deploy");
    });

    it("setDeploymentName updates name", () => {
      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.setDeploymentName("deploy-azure-123"); });
      expect(result.current.deploymentName).toBe("deploy-azure-123");
    });

    it("setIsRollingBack updates flag", () => {
      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.setIsRollingBack(true); });
      expect(result.current.isRollingBack).toBe(true);
    });

    it("setDeploymentStatus updates status", () => {
      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.setDeploymentStatus(successStatus); });
      expect(result.current.deploymentStatus).toEqual(successStatus);
    });

    it("setDeploymentStatus can reset to null", () => {
      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.setDeploymentStatus(successStatus); });
      act(() => { result.current.setDeploymentStatus(null); });
      expect(result.current.deploymentStatus).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // pollDeploymentStatus (uses fake timers — no internal Promises to fight with)
  // ---------------------------------------------------------------------------
  describe("pollDeploymentStatus", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("polls until success and sets step to complete", async () => {
      mockInvoke
        .mockResolvedValueOnce(runningStatus)
        .mockResolvedValueOnce(successStatus);

      const onComplete = vi.fn();
      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.pollDeploymentStatus(onComplete); });

      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(result.current.deploymentStep).toBe("ready");

      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(result.current.deploymentStep).toBe("complete");
      expect(result.current.deploymentStatus).toEqual(successStatus);
      expect(onComplete).toHaveBeenCalledWith(true);
    });

    it("polls until failure and sets step to failed", async () => {
      mockInvoke
        .mockResolvedValueOnce(runningStatus)
        .mockResolvedValueOnce(failedStatus);

      const onComplete = vi.fn();
      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.pollDeploymentStatus(onComplete); });

      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

      expect(result.current.deploymentStep).toBe("failed");
      expect(onComplete).toHaveBeenCalledWith(false);
    });

    it("continues polling on invoke error", async () => {
      mockInvoke
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValueOnce(successStatus);

      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.pollDeploymentStatus(); });

      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(result.current.deploymentStep).toBe("ready");

      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(result.current.deploymentStep).toBe("complete");
    });

    it("works without onComplete callback", async () => {
      mockInvoke.mockResolvedValueOnce(successStatus);

      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.pollDeploymentStatus(); });

      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(result.current.deploymentStep).toBe("complete");
    });
  });

  // ---------------------------------------------------------------------------
  // clearPollInterval
  // ---------------------------------------------------------------------------
  describe("clearPollInterval", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("stops active polling", async () => {
      mockInvoke.mockResolvedValue(runningStatus);

      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.pollDeploymentStatus(); });

      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(mockInvoke).toHaveBeenCalledTimes(1);

      act(() => { result.current.clearPollInterval(); });

      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // startPrepare — uses real timers (waitForCommandComplete creates internal intervals)
  // The polling interval is 1s in production; tests are fast because mocked invoke resolves instantly.
  // ---------------------------------------------------------------------------
  describe("startPrepare", () => {
    it("runs full init+plan flow and ends at review", async () => {
      const initDone: DeploymentStatus = { running: false, command: "init", output: "done", success: true, can_rollback: false };
      const planDone: DeploymentStatus = { running: false, command: "plan", output: "done", success: true, can_rollback: false };

      mockInvoke.mockResolvedValueOnce(undefined); // reset_deployment_status
      mockInvoke.mockResolvedValueOnce("/tmp/deployments/deploy-azure-simple-123"); // save_configuration
      mockInvoke.mockResolvedValueOnce(undefined); // run_terraform_command (init)
      mockInvoke.mockResolvedValueOnce(initDone); // get_deployment_status (init)
      mockInvoke.mockResolvedValueOnce(undefined); // run_terraform_command (plan)
      mockInvoke.mockResolvedValueOnce(planDone); // get_deployment_status (plan)

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startPrepare(template, credentials, { prefix: "test" }, ucConfig);
      });

      expect(result.current.deploymentStep).toBe("review");
      expect(result.current.templatePath).toBe("/tmp/deployments/deploy-azure-simple-123");
      expect(result.current.deploymentName).toMatch(/^test-[a-z0-9]{6}$/);
    }, 15000);

    it("filters empty form values", async () => {
      const done: DeploymentStatus = { running: false, command: "init", output: "done", success: true, can_rollback: false };

      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce("/tmp/path");
      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce(done);
      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce(done);

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startPrepare(
          template, credentials,
          { prefix: "test", empty_val: "", null_val: null, undef_val: undefined },
          ucConfig
        );
      });

      const saveCall = mockInvoke.mock.calls.find(c => c[0] === "save_configuration");
      expect(saveCall).toBeDefined();
      const savedValues = (saveCall![1] as any).values;
      expect(savedValues).toEqual({ prefix: "test" });
    }, 15000);

    it("adds Unity Catalog config when enabled", async () => {
      const done: DeploymentStatus = { running: false, command: "init", output: "done", success: true, can_rollback: false };

      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce("/tmp/path");
      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce(done);
      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce(done);

      const ucEnabled: UnityCatalogConfig = {
        enabled: true,
        catalog_name: "main",
        storage_name: "mystorage",
        metastore_id: "meta-123",
      };

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startPrepare(template, credentials, { prefix: "test" }, ucEnabled);
      });

      const saveCall = mockInvoke.mock.calls.find(c => c[0] === "save_configuration");
      const savedValues = (saveCall![1] as any).values;
      expect(savedValues.create_unity_catalog).toBe("true");
      expect(savedValues.uc_catalog_name).toBe("main");
      expect(savedValues.uc_storage_name).toBe("mystorage");
      expect(savedValues.existing_metastore_id).toBe("meta-123");
    }, 15000);

    it("passes metastore_id even when UC is disabled", async () => {
      const done: DeploymentStatus = { running: false, command: "init", output: "done", success: true, can_rollback: false };

      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce("/tmp/path");
      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce(done);
      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce(done);

      const ucWithMetastore: UnityCatalogConfig = {
        enabled: false, catalog_name: "", storage_name: "", metastore_id: "meta-456",
      };

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startPrepare(template, credentials, {}, ucWithMetastore);
      });

      const saveCall = mockInvoke.mock.calls.find(c => c[0] === "save_configuration");
      const savedValues = (saveCall![1] as any).values;
      expect(savedValues.existing_metastore_id).toBe("meta-456");
      expect(savedValues.create_unity_catalog).toBeUndefined();
    }, 15000);

    it("sets failed step when init fails", async () => {
      const initFailed: DeploymentStatus = { running: false, command: "init", output: "Error", success: false, can_rollback: false };

      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce("/tmp/path");
      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce(initFailed);

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startPrepare(template, credentials, {}, ucConfig);
      });

      expect(result.current.deploymentStep).toBe("failed");
    }, 15000);

    it("sets failed step when plan fails", async () => {
      const initDone: DeploymentStatus = { running: false, command: "init", output: "done", success: true, can_rollback: false };
      const planFailed: DeploymentStatus = { running: false, command: "plan", output: "Error", success: false, can_rollback: false };

      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce("/tmp/path");
      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce(initDone);
      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce(planFailed);

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startPrepare(template, credentials, {}, ucConfig);
      });

      expect(result.current.deploymentStep).toBe("failed");
    }, 15000);

    it("sets failed with error status when save_configuration throws", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockRejectedValueOnce("Permission denied");

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startPrepare(template, credentials, {}, ucConfig);
      });

      expect(result.current.deploymentStep).toBe("failed");
      expect(result.current.deploymentStatus).toEqual({
        running: false,
        command: null,
        output: "Permission denied",
        success: false,
        can_rollback: false,
      });
    });

    it("reuses existing deploymentName for retries", async () => {
      const done: DeploymentStatus = { running: false, command: "init", output: "done", success: true, can_rollback: false };

      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce("/tmp/path");
      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce(done);
      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce(done);

      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.setDeploymentName("existing-deploy"); });

      await act(async () => {
        await result.current.startPrepare(template, credentials, {}, ucConfig);
      });

      const saveCall = mockInvoke.mock.calls.find(c => c[0] === "save_configuration");
      expect((saveCall![1] as any).deploymentName).toBe("existing-deploy");
    }, 15000);
  });

  // ---------------------------------------------------------------------------
  // startApply
  // ---------------------------------------------------------------------------
  describe("startApply", () => {
    it("fails immediately when deploymentName is empty", async () => {
      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startApply();
      });

      expect(result.current.deploymentStep).toBe("failed");
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("runs apply and starts polling", async () => {
      mockInvoke.mockResolvedValueOnce(undefined); // run_terraform_command
      // pollDeploymentStatus will be called — verified via state

      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.setDeploymentName("deploy-test"); });

      await act(async () => {
        await result.current.startApply();
      });

      expect(result.current.deploymentStep).toBe("deploying");
      expect(mockInvoke).toHaveBeenCalledWith("run_terraform_command", {
        deploymentName: "deploy-test",
        command: "apply",
        credentials: {},
      });

      // Clean up polling interval
      act(() => { result.current.clearPollInterval(); });
    });

    it("sets failed on apply invoke error", async () => {
      mockInvoke.mockRejectedValueOnce("Terraform error");

      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.setDeploymentName("deploy-test"); });

      await act(async () => {
        await result.current.startApply();
      });

      expect(result.current.deploymentStep).toBe("failed");
      expect(result.current.deploymentStatus?.output).toBe("Terraform error");
    });
  });

  // ---------------------------------------------------------------------------
  // startRollback — uses real timers since rollback polls internally
  // ---------------------------------------------------------------------------
  describe("startRollback", () => {
    it("rolls back and sets complete on success", async () => {
      const rollbackDone: DeploymentStatus = {
        running: false, command: "destroy", output: "Destroyed", success: true, can_rollback: false,
      };

      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce(rollbackDone);

      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.startRollback("deploy-test", credentials); });

      expect(result.current.isRollingBack).toBe(true);
      expect(result.current.showDetailedLogs).toBe(true);

      await waitFor(() => {
        expect(result.current.deploymentStep).toBe("complete");
      });
      expect(result.current.isRollingBack).toBe(false);
    });

    it("keeps isRollingBack true when keepRollingBackOnSuccess is set", async () => {
      const rollbackDone: DeploymentStatus = {
        running: false, command: "destroy", output: "Destroyed", success: true, can_rollback: false,
      };

      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce(rollbackDone);

      const { result } = renderHook(() => useDeployment());

      act(() => {
        result.current.startRollback("deploy-test", credentials, { keepRollingBackOnSuccess: true });
      });

      await waitFor(() => {
        expect(result.current.deploymentStep).toBe("complete");
      });
      expect(result.current.isRollingBack).toBe(true);
    });

    it("sets failed on rollback failure", async () => {
      const rollbackFailed: DeploymentStatus = {
        running: false, command: "destroy", output: "Error", success: false, can_rollback: false,
      };

      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce(rollbackFailed);

      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.startRollback("deploy-test", credentials); });

      await waitFor(() => {
        expect(result.current.deploymentStep).toBe("failed");
      });
      expect(result.current.isRollingBack).toBe(false);
    });

    it("sets failed when rollback invoke throws", async () => {
      mockInvoke.mockRejectedValueOnce("Rollback error");

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startRollback("deploy-test", credentials);
      });

      expect(result.current.deploymentStep).toBe("failed");
      expect(result.current.isRollingBack).toBe(false);
    });

    it("clears polling and resets on status poll error", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockRejectedValueOnce(new Error("poll error"));

      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.startRollback("deploy-test", credentials); });

      await waitFor(() => {
        expect(result.current.isRollingBack).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // openTemplateFolder
  // ---------------------------------------------------------------------------
  describe("openTemplateFolder", () => {
    it("invokes open_folder with templatePath", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.setTemplatePath("/tmp/deploy"); });

      await act(async () => {
        await result.current.openTemplateFolder();
      });

      expect(mockInvoke).toHaveBeenCalledWith("open_folder", { path: "/tmp/deploy" });
    });

    it("does nothing when templatePath is empty", async () => {
      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.openTemplateFolder();
      });

      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("silently handles open_folder errors", async () => {
      mockInvoke.mockRejectedValueOnce("Cannot open");

      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.setTemplatePath("/tmp/deploy"); });

      await act(async () => {
        await result.current.openTemplateFolder();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // openDeploymentsFolder
  // ---------------------------------------------------------------------------
  describe("openDeploymentsFolder", () => {
    it("gets folder path and opens it", async () => {
      mockInvoke
        .mockResolvedValueOnce("/tmp/deployments")
        .mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.openDeploymentsFolder();
      });

      expect(mockInvoke).toHaveBeenCalledWith("get_deployments_folder");
      expect(mockInvoke).toHaveBeenCalledWith("open_folder", { path: "/tmp/deployments" });
    });

    it("silently handles errors", async () => {
      mockInvoke.mockRejectedValueOnce("Cannot open");

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.openDeploymentsFolder();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // cleanup
  // ---------------------------------------------------------------------------
  describe("cleanup", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("stops polling on cleanup", async () => {
      mockInvoke.mockResolvedValue(runningStatus);

      const { result } = renderHook(() => useDeployment());

      act(() => { result.current.pollDeploymentStatus(); });

      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      const callsBeforeCleanup = mockInvoke.mock.calls.length;

      act(() => { result.current.cleanup(); });

      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(mockInvoke.mock.calls.length).toBe(callsBeforeCleanup);
    });
  });
});

// ---------------------------------------------------------------------------
// reconstructObjects (exported utility)
// ---------------------------------------------------------------------------
describe("reconstructObjects", () => {
  it("passes through plain values unchanged", () => {
    const result = reconstructObjects({
      region: "eastus",
      workspace_name: "test-ws",
    });

    expect(result.region).toBe("eastus");
    expect(result.workspace_name).toBe("test-ws");
  });

  it("reconstructs Azure SRA workspace_vnet from decomposed fields", () => {
    const result = reconstructObjects({
      workspace_vnet__cidr: "10.0.0.0/20",
      workspace_vnet__new_bits: "2",
      other_field: "value",
    });

    expect(result.workspace_vnet).toEqual({
      cidr: "10.0.0.0/20",
      new_bits: "2",
    });
    expect(result.other_field).toBe("value");
    expect(result).not.toHaveProperty("workspace_vnet__cidr");
    expect(result).not.toHaveProperty("workspace_vnet__new_bits");
  });

  it("reconstructs existing_hub_vnet from decomposed fields", () => {
    const result = reconstructObjects({
      "existing_hub_vnet__route_table_id": "/subs/rt-1",
      "existing_hub_vnet__vnet_id": "/subs/vnet-1",
    });

    expect(result.existing_hub_vnet).toEqual({
      route_table_id: "/subs/rt-1",
      vnet_id: "/subs/vnet-1",
    });
  });

  it("reconstructs nested object paths (network_configuration inside existing_workspace_vnet)", () => {
    const result = reconstructObjects({
      "existing_workspace_vnet__nc__vnet_id": "/subs/vnet-1",
      "existing_workspace_vnet__nc__private_subnet": "/subs/private-1",
    });

    expect(result.existing_workspace_vnet).toBeDefined();
    expect(result.existing_workspace_vnet.network_configuration).toBeDefined();
    expect(result.existing_workspace_vnet.network_configuration.virtual_network_id).toBe("/subs/vnet-1");
    expect(result.existing_workspace_vnet.network_configuration.private_subnet_id).toBe("/subs/private-1");
  });

  it("reconstructs list fields from decomposed sub-fields", () => {
    const result = reconstructObjects({
      private_subnets_cidr_1: "10.0.0.0/18",
      private_subnets_cidr_2: "10.0.64.0/18",
    });

    expect(result.private_subnets_cidr).toEqual(["10.0.0.0/18", "10.0.64.0/18"]);
    expect(result).not.toHaveProperty("private_subnets_cidr_1");
    expect(result).not.toHaveProperty("private_subnets_cidr_2");
  });

  it("skips object reconstruction when all sub-fields are empty", () => {
    const result = reconstructObjects({
      workspace_vnet__cidr: "",
      workspace_vnet__new_bits: "",
      region: "eastus",
    });

    expect(result).not.toHaveProperty("workspace_vnet");
    expect(result.region).toBe("eastus");
  });

  it("skips list reconstruction when all sub-fields are empty", () => {
    const result = reconstructObjects({
      private_subnets_cidr_1: "",
      private_subnets_cidr_2: "",
    });

    expect(result).not.toHaveProperty("private_subnets_cidr");
  });

  it("handles mixed decomposed and plain values", () => {
    const result = reconstructObjects({
      workspace_vnet__cidr: "10.0.0.0/20",
      private_subnets_cidr_1: "10.0.0.0/18",
      private_subnets_cidr_2: "10.0.64.0/18",
      region: "westus",
      workspace_name: "my-ws",
    });

    expect(result.workspace_vnet).toEqual({ cidr: "10.0.0.0/20" });
    expect(result.private_subnets_cidr).toEqual(["10.0.0.0/18", "10.0.64.0/18"]);
    expect(result.region).toBe("westus");
    expect(result.workspace_name).toBe("my-ws");
  });
});
