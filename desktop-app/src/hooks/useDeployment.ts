import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DeploymentStatus, Template, CloudCredentials, UnityCatalogConfig } from "../types";
import { POLLING, OBJECT_FIELD_DECOMPOSITION, LIST_FIELD_DECOMPOSITION } from "../constants";

export type DeploymentStep = "ready" | "initializing" | "planning" | "review" | "deploying" | "complete" | "failed";

/**
 * Reconstructs complex Terraform objects from decomposed sub-field form values.
 * Sub-fields use keys like `workspace_vnet__cidr`; this rebuilds them into
 * `{ workspace_vnet: { cidr: "..." } }` for proper tfvars generation.
 */
export function reconstructObjects(values: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  const usedKeys = new Set<string>();

  for (const [parentName, subFields] of Object.entries(OBJECT_FIELD_DECOMPOSITION)) {
    const obj: Record<string, any> = {};
    let hasAnyValue = false;

    for (const field of subFields) {
      const value = values[field.key];
      if (value !== undefined && value !== "" && value !== null) {
        hasAnyValue = true;
        let current = obj;
        for (let i = 0; i < field.path.length - 1; i++) {
          if (!current[field.path[i]]) current[field.path[i]] = {};
          current = current[field.path[i]];
        }
        current[field.path[field.path.length - 1]] = value;
      }
      usedKeys.add(field.key);
    }

    usedKeys.add(parentName);
    if (hasAnyValue) {
      result[parentName] = obj;
    }
  }

  // Reconstruct list(string) variables from decomposed sub-fields
  for (const [parentName, subFields] of Object.entries(LIST_FIELD_DECOMPOSITION)) {
    const items: string[] = [];
    let hasAnyValue = false;

    const sorted = [...subFields].sort((a, b) => a.index - b.index);
    for (const field of sorted) {
      const value = values[field.key];
      if (value !== undefined && value !== "" && value !== null) {
        hasAnyValue = true;
        items.push(String(value));
      }
      usedKeys.add(field.key);
    }

    usedKeys.add(parentName);
    if (hasAnyValue) {
      result[parentName] = items;
    }
  }

  for (const [key, value] of Object.entries(values)) {
    if (!usedKeys.has(key)) {
      result[key] = value;
    }
  }

  return result;
}

const WORKSPACE_NAME_KEYS = ["prefix", "workspace_name", "databricks_workspace_name", "resource_suffix", "resource_prefix"];

function buildDeploymentName(template: Template, formValues: Record<string, any>): string {
  const workspaceName = WORKSPACE_NAME_KEYS
    .map((key) => formValues[key])
    .find((v) => typeof v === "string" && v.trim() !== "");

  const shortId = Math.random().toString(36).slice(2, 8);

  if (workspaceName) {
    const slug = workspaceName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return slug ? `${slug}-${shortId}` : `deploy-${template.id}-${shortId}`;
  }

  return `deploy-${template.id}-${shortId}`;
}

export interface UseDeploymentReturn {
  // State
  deploymentStatus: DeploymentStatus | null;
  deploymentStep: DeploymentStep;
  showDetailedLogs: boolean;
  isRollingBack: boolean;
  templatePath: string;
  deploymentName: string;

  // Actions
  setDeploymentStep: (step: DeploymentStep) => void;
  setShowDetailedLogs: (show: boolean) => void;
  setTemplatePath: (path: string) => void;
  setDeploymentName: (name: string) => void;
  setIsRollingBack: (rolling: boolean) => void;
  setDeploymentStatus: (status: DeploymentStatus | null) => void;
  startPrepare: (
    template: Template,
    credentials: CloudCredentials,
    formValues: Record<string, any>,
    ucConfig: UnityCatalogConfig
  ) => Promise<void>;
  startApply: () => Promise<void>;
  pollDeploymentStatus: (onComplete?: (success: boolean) => void) => void;
  startRollback: (
    deploymentName: string,
    credentials: CloudCredentials,
    options?: { keepRollingBackOnSuccess?: boolean }
  ) => Promise<void>;
  openTemplateFolder: () => Promise<void>;
  openDeploymentsFolder: () => Promise<void>;
  clearPollInterval: () => void;
  cleanup: () => void;
}

export function useDeployment(): UseDeploymentReturn {
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus | null>(null);
  const [deploymentStep, setDeploymentStep] = useState<DeploymentStep>("ready");
  const [showDetailedLogs, setShowDetailedLogs] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [templatePath, setTemplatePath] = useState<string>("");
  const [deploymentName, setDeploymentName] = useState<string>("");

  // Refs to track current state in async callbacks
  const deploymentStepRef = useRef<DeploymentStep>("ready");
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waitIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  // Reset isMountedRef on mount (needed for React StrictMode remount cycles)
  useEffect(() => {
    isMountedRef.current = true;
  }, []);

  // Keep refs in sync with state
  useEffect(() => {
    deploymentStepRef.current = deploymentStep;
  }, [deploymentStep]);

  const clearPollInterval = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const pollDeploymentStatus = useCallback(
    (onComplete?: (success: boolean) => void) => {
      clearPollInterval();

      pollIntervalRef.current = setInterval(async () => {
        try {
          const status = await invoke<DeploymentStatus>("get_deployment_status");

          if (!isMountedRef.current) return;

          setDeploymentStatus(status);

          if (!status.running && status.success !== null) {
            clearPollInterval();
            if (status.success) {
              setDeploymentStep("complete");
            } else {
              setDeploymentStep("failed");
            }
            onComplete?.(status.success);
          }
        } catch (e) {
          console.debug("Deployment status poll failed, retrying:", e);
        }
      }, POLLING.STATUS_INTERVAL);
    },
    [clearPollInterval]
  );

  const clearWaitInterval = useCallback(() => {
    if (waitIntervalRef.current) {
      clearInterval(waitIntervalRef.current);
      waitIntervalRef.current = null;
    }
  }, []);

  // Polls get_deployment_status until status.running is false, then resolves with success/failure.
  // Used after init and plan to wait for backend completion before proceeding.
  const waitForCommandComplete = useCallback(async (): Promise<boolean> => {
    clearWaitInterval();
    return new Promise((resolve) => {
      const checkStatus = async () => {
        try {
          const status = await invoke<DeploymentStatus>("get_deployment_status");
          
          if (!isMountedRef.current) {
            return { done: true, success: false };
          }
          
          setDeploymentStatus(status);
          
          if (!status.running) {
            return { done: true, success: status.success ?? false };
          }
          return { done: false, success: false };
        } catch {
          return { done: false, success: false };
        }
      };

      const interval = setInterval(async () => {
        const result = await checkStatus();
        if (result.done) {
          clearInterval(interval);
          waitIntervalRef.current = null;
          resolve(result.success);
        }
      }, POLLING.STATUS_INTERVAL);
      waitIntervalRef.current = interval;
    });
  }, [clearWaitInterval]);

  // Refs to store credentials for startApply
  const credentialsRef = useRef<CloudCredentials>({});

  // startPrepare: Called when "Create Workspace" is clicked
  // Runs init + plan, then stops at review for user confirmation
  const startPrepare = useCallback(
    async (
      template: Template,
      credentials: CloudCredentials,
      formValues: Record<string, any>,
      ucConfig: UnityCatalogConfig
    ) => {
      // Reset deployment status in both frontend and backend to start fresh
      setDeploymentStatus(null);
      try {
        await invoke("reset_deployment_status");
      } catch {
        // Ignore if reset fails - it's just a safety measure
      }
      setDeploymentStep("initializing");

      // Store credentials for later use in startApply
      credentialsRef.current = credentials;

      // Build variables from form values: filter empties, then reconstruct complex objects
      const rawValues: Record<string, any> = {};
      for (const [key, value] of Object.entries(formValues)) {
        if (value !== undefined && value !== null && value !== "") {
          rawValues[key] = value;
        }
      }
      const values = reconstructObjects(rawValues);

      // Always pass existing metastore ID if detected (regardless of UC catalog enabled)
      if (ucConfig.metastore_id) {
        if (template.id === "azure-sra") {
          values["databricks_metastore_id"] = ucConfig.metastore_id;
        } else {
          values["existing_metastore_id"] = ucConfig.metastore_id;
        }
      }

      // Add Unity Catalog configuration if enabled
      if (ucConfig.enabled) {
        if (template.id === "azure-sra") {
          if (ucConfig.catalog_name) {
            values["uc_catalog_name"] = ucConfig.catalog_name;
          }
          if (ucConfig.storage_name) {
            values["uc_storage_name"] = ucConfig.storage_name;
          }
        } else if (template.id === "aws-sra") {
          if (ucConfig.catalog_name) {
            values["uc_catalog_name"] = ucConfig.catalog_name;
          }
        } else {
          values["create_unity_catalog"] = "true";
          if (ucConfig.catalog_name) {
            values["uc_catalog_name"] = ucConfig.catalog_name;
          }
          if (ucConfig.storage_name) {
            values["uc_storage_name"] = ucConfig.storage_name;
          }
        }
      }

      // AWS SRA: set metastore_exists based on UC screen auto-detection
      if (template.id === "aws-sra") {
        values["metastore_exists"] = !!ucConfig.metastore_id;
      }

      // Reuse existing deployment if available (for retry), otherwise create new
      const targetDeploymentName = deploymentName || buildDeploymentName(template, formValues);

      try {
        // Step 1: Save configuration (copies template, generates tfvars)
        const deploymentPath = await invoke<string>("save_configuration", {
          templateId: template.id,
          deploymentName: targetDeploymentName,
          values,
          credentials,
        });

        setDeploymentName(targetDeploymentName);
        setTemplatePath(deploymentPath);

        // Step 2: Run terraform init
        await invoke("run_terraform_command", {
          deploymentName: targetDeploymentName,
          command: "init",
          credentials,
        });

        // Wait for init to complete
        const initSuccess = await waitForCommandComplete();
        if (!initSuccess) {
          setDeploymentStep("failed");
          return;
        }

        // Step 3: Run terraform plan
        setDeploymentStep("planning");
        await invoke("run_terraform_command", {
          deploymentName: targetDeploymentName,
          command: "plan",
          credentials,
        });

        // Wait for plan to complete
        const planSuccess = await waitForCommandComplete();
        if (!planSuccess) {
          setDeploymentStep("failed");
          return;
        }

        // Step 4: Show review screen - wait for user to click "Confirm & Deploy"
        setDeploymentStep("review");
      } catch (e: unknown) {
        setDeploymentStatus({
          running: false,
          command: null,
          output: String(e),
          success: false,
          can_rollback: false,
        });
        setDeploymentStep("failed");
      }
    },
    [deploymentName, waitForCommandComplete]
  );

  // startApply: Called when "Confirm & Deploy" is clicked on review screen
  // Runs apply and polls until complete
  const startApply = useCallback(async () => {
    if (!deploymentName) {
      setDeploymentStep("failed");
      return;
    }

    try {
      setDeploymentStep("deploying");

      // Run terraform apply
      await invoke("run_terraform_command", {
        deploymentName,
        command: "apply",
        credentials: credentialsRef.current,
      });

      // Poll for deployment status until complete
      pollDeploymentStatus();
    } catch (e: unknown) {
      setDeploymentStatus({
        running: false,
        command: null,
        output: String(e),
        success: false,
        can_rollback: false,
      });
      setDeploymentStep("failed");
    }
  }, [deploymentName, pollDeploymentStatus]);

  const startRollback = useCallback(async (
    rollbackDeploymentName: string,
    rollbackCredentials: CloudCredentials,
    options?: { keepRollingBackOnSuccess?: boolean }
  ) => {
    setIsRollingBack(true);
    setShowDetailedLogs(true);
    clearPollInterval();

    try {
      await invoke("rollback_deployment", {
        deploymentName: rollbackDeploymentName,
        credentials: rollbackCredentials,
      });

      // Poll for rollback completion
      pollIntervalRef.current = setInterval(async () => {
        try {
          const status = await invoke<DeploymentStatus>("get_deployment_status");

          if (!isMountedRef.current) return;

          setDeploymentStatus(status);

          if (!status.running && status.success !== null) {
            clearPollInterval();
            if (status.success) {
              // Keep isRollingBack=true if requested so completion screen shows "Cleanup Complete"
              if (!options?.keepRollingBackOnSuccess) {
                setIsRollingBack(false);
              }
              setDeploymentStep("complete");
            } else {
              setIsRollingBack(false);
              setDeploymentStep("failed");
            }
          }
        } catch {
          clearPollInterval();
          if (isMountedRef.current) {
            setIsRollingBack(false);
          }
        }
      }, POLLING.ROLLBACK_INTERVAL);
    } catch {
      setIsRollingBack(false);
      setDeploymentStep("failed");
    }
  }, [clearPollInterval]);

  const openTemplateFolder = useCallback(async () => {
    if (templatePath) {
      try {
        await invoke("open_folder", { path: templatePath });
      } catch {
        // Silently fail if folder can't be opened
      }
    }
  }, [templatePath]);

  const openDeploymentsFolder = useCallback(async () => {
    try {
      const path = await invoke<string>("get_deployments_folder");
      await invoke("open_folder", { path });
    } catch {
      // Silently fail if folder can't be opened
    }
  }, []);

  const cleanup = useCallback(() => {
    isMountedRef.current = false;
    clearPollInterval();
    clearWaitInterval();
  }, [clearPollInterval, clearWaitInterval]);

  return {
    deploymentStatus,
    deploymentStep,
    showDetailedLogs,
    isRollingBack,
    templatePath,
    deploymentName,
    setDeploymentStep,
    setShowDetailedLogs,
    setTemplatePath,
    setDeploymentName,
    setIsRollingBack,
    setDeploymentStatus,
    startPrepare,
    startApply,
    pollDeploymentStatus,
    startRollback,
    openTemplateFolder,
    openDeploymentsFolder,
    clearPollInterval,
    cleanup,
  };
}
