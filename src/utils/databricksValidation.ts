import { invoke } from "@tauri-apps/api/core";
import { CloudCredentials, DatabricksProfile } from "../types";

export interface DatabricksValidationParams {
  credentials: CloudCredentials;
  selectedCloud: string;
  authMode: "profile" | "credentials";
  selectedProfile: string;
  profiles: DatabricksProfile[];
}

export interface DatabricksValidationCommand {
  command: string;
  args: Record<string, any>;
}

export interface DatabricksValidationResult {
  error?: string;
  command?: DatabricksValidationCommand;
}

/**
 * Determines which Tauri command to invoke for Databricks credential validation
 * based on cloud, auth mode, and profile type.
 * 
 * Returns either an error message or the command + args to invoke.
 */
export function getDatabricksValidationCommand(
  params: DatabricksValidationParams
): DatabricksValidationResult {
  const { credentials, selectedCloud, authMode, selectedProfile, profiles } = params;

  // GCP-specific validation paths
  if (selectedCloud === "gcp") {
    if (!credentials.databricks_account_id?.trim()) {
      return { error: "Databricks Account ID is required" };
    }

    // Service Account Key mode
    const isUsingServiceAccountKey = credentials.gcp_use_adc === false;
    if (isUsingServiceAccountKey) {
      if (!credentials.gcp_credentials_json?.trim()) {
        return { error: "GCP service account JSON key not available. Please go back and enter it." };
      }
      return {
        command: {
          command: "validate_gcp_databricks_access_with_key",
          args: {
            accountId: credentials.databricks_account_id,
            saJson: credentials.gcp_credentials_json,
          },
        },
      };
    }

    // ADC mode
    if (!credentials.gcp_oauth_token) {
      return { error: "GCP OAuth token not available. Please go back and verify your GCP credentials." };
    }
    return {
      command: {
        command: "validate_gcp_databricks_access",
        args: {
          accountId: credentials.databricks_account_id,
          oauthToken: credentials.gcp_oauth_token,
          serviceAccountEmail: credentials.gcp_service_account_email,
        },
      },
    };
  }

  // Azure identity mode (account admin flow)
  if (selectedCloud === "azure" && credentials.azure_databricks_use_identity) {
    if (!credentials.databricks_account_id?.trim()) {
      return { error: "Databricks Account ID is required" };
    }
    if (!credentials.azure_account_email) {
      return { error: "Azure account email not available. Please go back and verify your Azure credentials." };
    }
    return {
      command: {
        command: "validate_azure_databricks_identity",
        args: {
          accountId: credentials.databricks_account_id,
          azureAccountEmail: credentials.azure_account_email,
          azureTenantId: credentials.azure_tenant_id || null,
        },
      },
    };
  }

  // AWS/Azure validation flows
  if (authMode === "profile") {
    if (!selectedProfile) {
      return { error: "Please select a Databricks profile" };
    }
    if (!credentials.databricks_account_id?.trim()) {
      return { error: "Databricks Account ID is required. Please select a valid profile." };
    }
  } else {
    if (!credentials.databricks_account_id?.trim()) {
      return { error: "Databricks Account ID is required" };
    }
    if (!credentials.databricks_client_id?.trim()) {
      return { error: "Databricks Client ID is required" };
    }
    if (!credentials.databricks_client_secret?.trim()) {
      return { error: "Databricks Client Secret is required" };
    }
  }

  // Determine if we use SP validation or CLI validation
  const currentProfile = profiles.find(p => p.name === selectedProfile);
  
  if (authMode === "credentials" || 
      (authMode === "profile" && currentProfile?.has_client_credentials)) {
    // Validate via OAuth token exchange (SP credentials)
    return {
      command: {
        command: "validate_databricks_credentials",
        args: {
          accountId: credentials.databricks_account_id,
          clientId: credentials.databricks_client_id || "",
          clientSecret: credentials.databricks_client_secret || "",
          cloud: selectedCloud,
        },
      },
    };
  } else if (authMode === "profile" && selectedProfile) {
    // Validate via Databricks CLI (OAuth/SSO profiles without client credentials)
    return {
      command: {
        command: "validate_databricks_profile",
        args: {
          profileName: selectedProfile,
          cloud: selectedCloud,
        },
      },
    };
  }

  // Fallback for invalid state (shouldn't reach here in normal flow)
  return { error: "Invalid validation state" };
}

/**
 * Validates Databricks credentials by determining the appropriate command
 * and invoking it.
 * 
 * Throws an error if validation fails.
 */
export async function validateDatabricksCredentials(
  params: DatabricksValidationParams
): Promise<void> {
  const result = getDatabricksValidationCommand(params);
  
  if (result.error) {
    throw new Error(result.error);
  }
  
  if (!result.command) {
    throw new Error("No validation command determined");
  }
  
  await invoke(result.command.command, result.command.args);
}
