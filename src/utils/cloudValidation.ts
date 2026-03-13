import { invoke } from "@tauri-apps/api/core";
import { CloudCredentials, CloudPermissionCheck, AwsIdentity, AzureAccount } from "../types";

export interface AwsValidationParams {
  authMode: "profile" | "keys";
  identity: AwsIdentity | null;
  credentials: CloudCredentials;
}

export interface AzureValidationParams {
  authMode: "cli" | "service_principal";
  account: AzureAccount | null;
  credentials: CloudCredentials;
}

export interface CloudValidationResult {
  proceed: boolean;
  error?: string;
  permissionWarning?: boolean;
  permissionCheck?: CloudPermissionCheck;
}

/**
 * Validates AWS credentials and checks permissions.
 * Returns whether to proceed, any error, and permission warning status.
 */
export async function validateAwsCredentials(
  params: AwsValidationParams
): Promise<CloudValidationResult> {
  const { authMode, identity, credentials } = params;

  // Field validation
  if (authMode === "profile") {
    if (!identity) {
      return { proceed: false, error: "Please verify your AWS credentials first" };
    }
  } else {
    if (!credentials.aws_access_key_id?.trim()) {
      return { proceed: false, error: "AWS Access Key ID is required" };
    }
    if (!credentials.aws_secret_access_key?.trim()) {
      return { proceed: false, error: "AWS Secret Access Key is required" };
    }
  }

  // Permission check
  try {
    const permCheck = await invoke<CloudPermissionCheck>("check_aws_permissions", {
      credentials,
    });

    if (!permCheck.has_all_permissions && permCheck.missing_permissions.length > 0) {
      return { proceed: false, permissionWarning: true, permissionCheck: permCheck };
    }

    return { proceed: true, permissionCheck: permCheck };
  } catch (e: unknown) {
    return { proceed: false, error: String(e) || "Credential validation failed" };
  }
}

/**
 * Validates Azure credentials and checks permissions.
 * Returns whether to proceed, any error, and permission warning status.
 */
export async function validateAzureCredentials(
  params: AzureValidationParams
): Promise<CloudValidationResult> {
  const { authMode, account, credentials } = params;

  // Field validation
  if (authMode === "cli") {
    if (!account) {
      return { proceed: false, error: "Please verify your Azure credentials first" };
    }
    if (!credentials.azure_subscription_id) {
      return { proceed: false, error: "Please select an Azure subscription" };
    }
  } else {
    if (!credentials.azure_tenant_id?.trim()) {
      return { proceed: false, error: "Azure Tenant ID is required" };
    }
    if (!credentials.azure_subscription_id?.trim()) {
      return { proceed: false, error: "Azure Subscription ID is required" };
    }
    if (!credentials.azure_client_id?.trim()) {
      return { proceed: false, error: "Azure Client ID is required" };
    }
    if (!credentials.azure_client_secret?.trim()) {
      return { proceed: false, error: "Azure Client Secret is required" };
    }
  }

  // Permission check
  try {
    const permCheck = await invoke<CloudPermissionCheck>("check_azure_permissions", {
      credentials,
    });

    if (!permCheck.has_all_permissions && permCheck.missing_permissions.length > 0) {
      return { proceed: false, permissionWarning: true, permissionCheck: permCheck };
    }

    return { proceed: true, permissionCheck: permCheck };
  } catch (e: unknown) {
    return { proceed: false, error: String(e) || "Credential validation failed" };
  }
}
