//! Azure authentication and permission checking commands.

use super::{http_client, is_valid_uuid};
use super::{CloudCredentials, CloudPermissionCheck};
use crate::dependencies;
use serde::{Deserialize, Serialize};

/// Azure subscription descriptor.
#[derive(Debug, Serialize, Deserialize)]
pub struct AzureSubscription {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub tenant_id: String,
}

/// Azure account (signed-in principal) info.
#[derive(Debug, Serialize, Deserialize)]
pub struct AzureAccount {
    pub user: String,
    pub tenant_id: String,
    pub subscription_id: String,
    pub subscription_name: String,
}

/// Azure resource group descriptor.
#[derive(Debug, Clone, serde::Serialize)]
pub struct AzureResourceGroup {
    pub name: String,
    pub location: String,
}

/// Validate Azure subscription ID format (UUID).
fn validate_azure_subscription_id(id: &str) -> bool {
    is_valid_uuid(id)
}

/// Get Azure CLI login status using `az account show`.
#[tauri::command]
pub fn get_azure_account() -> Result<AzureAccount, String> {
    use std::process::Command;

    let az_path = dependencies::find_azure_cli_path()
        .ok_or_else(|| crate::errors::cli_not_found("Azure CLI"))?;

    let output = Command::new(&az_path)
        .args(["account", "show", "--output", "json"])
        .output()
        .map_err(|e| format!("Failed to run Azure CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("az login") || stderr.contains("not logged in") {
            return Err(crate::errors::not_logged_in("Azure"));
        }
        return Err(format!("Azure CLI error: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse response: {}", e))?;

    let user = json["user"]["name"].as_str().unwrap_or("").to_string();

    Ok(AzureAccount {
        user,
        tenant_id: json["tenantId"].as_str().unwrap_or("").to_string(),
        subscription_id: json["id"].as_str().unwrap_or("").to_string(),
        subscription_name: json["name"].as_str().unwrap_or("").to_string(),
    })
}

/// Get list of Azure subscriptions.
#[tauri::command]
pub fn get_azure_subscriptions() -> Result<Vec<AzureSubscription>, String> {
    use std::process::Command;

    let az_path = dependencies::find_azure_cli_path()
        .ok_or_else(|| crate::errors::cli_not_found("Azure CLI"))?;

    let output = Command::new(&az_path)
        .args(["account", "list", "--output", "json"])
        .output()
        .map_err(|e| format!("Failed to run Azure CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Azure CLI error: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: Vec<serde_json::Value> =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse response: {}", e))?;

    let subscriptions: Vec<AzureSubscription> = json
        .iter()
        .map(|sub| AzureSubscription {
            id: sub["id"].as_str().unwrap_or("").to_string(),
            name: sub["name"].as_str().unwrap_or("").to_string(),
            is_default: sub["isDefault"].as_bool().unwrap_or(false),
            tenant_id: sub["tenantId"].as_str().unwrap_or("").to_string(),
        })
        .collect();

    Ok(subscriptions)
}

/// Trigger Azure CLI login.
#[tauri::command]
pub async fn azure_login() -> Result<String, String> {
    use std::process::Command;

    let az_path = dependencies::find_azure_cli_path()
        .ok_or_else(|| crate::errors::cli_not_found("Azure CLI"))?;

    let output = Command::new(&az_path)
        .args(["login"])
        .output()
        .map_err(|e| format!("Failed to run Azure CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Azure login failed: {}", stderr.trim()));
    }

    Ok("Azure login initiated. Complete authentication in your browser.".to_string())
}

/// Set the active Azure subscription.
#[tauri::command]
pub fn set_azure_subscription(subscription_id: String) -> Result<(), String> {
    use std::process::Command;

    if !validate_azure_subscription_id(&subscription_id) {
        return Err("Invalid Azure subscription ID format".to_string());
    }

    let az_path = dependencies::find_azure_cli_path()
        .ok_or_else(|| crate::errors::cli_not_found("Azure CLI"))?;

    let output = Command::new(&az_path)
        .args(["account", "set", "--subscription", &subscription_id])
        .output()
        .map_err(|e| format!("Failed to run Azure CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Failed to set subscription: {}",
            stderr.trim()
        ));
    }

    Ok(())
}

/// List Azure resource groups using `az group list`.
#[tauri::command]
pub fn get_azure_resource_groups() -> Result<Vec<AzureResourceGroup>, String> {
    use std::process::Command;

    let az_path = dependencies::find_azure_cli_path()
        .ok_or_else(|| crate::errors::cli_not_found("Azure CLI"))?;

    let output = Command::new(&az_path)
        .args(["group", "list", "--output", "json"])
        .output()
        .map_err(|e| format!("Failed to run Azure CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Failed to list resource groups: {}",
            stderr.trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse resource groups: {}", e))?;

    let groups: Vec<AzureResourceGroup> = json
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|rg| AzureResourceGroup {
            name: rg["name"].as_str().unwrap_or("").to_string(),
            location: rg["location"].as_str().unwrap_or("").to_string(),
        })
        .collect();

    Ok(groups)
}

/// List Azure resource groups using Service Principal credentials via Azure ARM REST API.
#[tauri::command]
pub async fn get_azure_resource_groups_sp(
    credentials: CloudCredentials,
) -> Result<Vec<AzureResourceGroup>, String> {
    let tenant_id = credentials
        .azure_tenant_id
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or("Azure Tenant ID is required")?;

    let client_id = credentials
        .azure_client_id
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or("Azure Client ID is required")?;

    let client_secret = credentials
        .azure_client_secret
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or("Azure Client Secret is required")?;

    let subscription_id = credentials
        .azure_subscription_id
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or("Azure Subscription ID is required")?;

    let http_client = http_client()?;

    // Step 1: Get Azure AD token
    let token_url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        tenant_id
    );

    let token_response = http_client
        .post(&token_url)
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("scope", "https://management.azure.com/.default"),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to get Azure AD token: {}", e))?;

    if !token_response.status().is_success() {
        let status = token_response.status();
        let error_text = token_response.text().await.unwrap_or_default();
        return Err(format!(
            "Azure AD authentication failed ({}): {}",
            status, error_text
        ));
    }

    let token_json: serde_json::Value = token_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Azure AD token response: {}", e))?;

    let access_token = token_json["access_token"]
        .as_str()
        .ok_or("No access token in Azure AD response")?;

    // Step 2: List resource groups via ARM API
    let rg_url = format!(
        "https://management.azure.com/subscriptions/{}/resourcegroups?api-version=2021-04-01",
        subscription_id
    );

    let rg_response = http_client
        .get(&rg_url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to list resource groups: {}", e))?;

    if !rg_response.status().is_success() {
        let status = rg_response.status();
        let error_text = rg_response.text().await.unwrap_or_default();
        return Err(format!(
            "Failed to list resource groups ({}): {}",
            status, error_text
        ));
    }

    let rg_json: serde_json::Value = rg_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse resource groups response: {}", e))?;

    let groups: Vec<AzureResourceGroup> = rg_json["value"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|rg| AzureResourceGroup {
            name: rg["name"].as_str().unwrap_or("").to_string(),
            location: rg["location"].as_str().unwrap_or("").to_string(),
        })
        .collect();

    Ok(groups)
}

/// Azure Virtual Network descriptor.
#[derive(Debug, Clone, serde::Serialize)]
pub struct AzureVnet {
    pub name: String,
    pub resource_group: String,
    pub location: String,
    pub address_prefixes: Vec<String>,
}

/// List Azure VNets in the current subscription using `az network vnet list`.
#[tauri::command]
pub fn get_azure_vnets() -> Result<Vec<AzureVnet>, String> {
    use std::process::Command;

    let az_path = dependencies::find_azure_cli_path()
        .ok_or_else(|| crate::errors::cli_not_found("Azure CLI"))?;

    let output = Command::new(&az_path)
        .args(["network", "vnet", "list", "--output", "json"])
        .output()
        .map_err(|e| format!("Failed to run Azure CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to list VNets: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse VNets: {}", e))?;

    let vnets: Vec<AzureVnet> = json
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|v| AzureVnet {
            name: v["name"].as_str().unwrap_or("").to_string(),
            resource_group: v["resourceGroup"].as_str().unwrap_or("").to_string(),
            location: v["location"].as_str().unwrap_or("").to_string(),
            address_prefixes: v["addressSpace"]["addressPrefixes"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|p| p.as_str().map(|s| s.to_string()))
                .collect(),
        })
        .collect();

    Ok(vnets)
}

/// List Azure VNets using Service Principal credentials via Azure ARM REST API.
#[tauri::command]
pub async fn get_azure_vnets_sp(
    credentials: CloudCredentials,
) -> Result<Vec<AzureVnet>, String> {
    let tenant_id = credentials
        .azure_tenant_id
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or("Azure Tenant ID is required")?;

    let client_id = credentials
        .azure_client_id
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or("Azure Client ID is required")?;

    let client_secret = credentials
        .azure_client_secret
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or("Azure Client Secret is required")?;

    let subscription_id = credentials
        .azure_subscription_id
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or("Azure Subscription ID is required")?;

    let http_client = http_client()?;

    let token_url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        tenant_id
    );

    let token_response = http_client
        .post(&token_url)
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("scope", "https://management.azure.com/.default"),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to get Azure AD token: {}", e))?;

    if !token_response.status().is_success() {
        let status = token_response.status();
        let error_text = token_response.text().await.unwrap_or_default();
        return Err(format!(
            "Azure AD authentication failed ({}): {}",
            status, error_text
        ));
    }

    let token_json: serde_json::Value = token_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Azure AD token response: {}", e))?;

    let access_token = token_json["access_token"]
        .as_str()
        .ok_or("No access token in Azure AD response")?;

    let vnet_url = format!(
        "https://management.azure.com/subscriptions/{}/providers/Microsoft.Network/virtualNetworks?api-version=2023-05-01",
        subscription_id
    );

    let vnet_response = http_client
        .get(&vnet_url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to list VNets: {}", e))?;

    if !vnet_response.status().is_success() {
        let status = vnet_response.status();
        let error_text = vnet_response.text().await.unwrap_or_default();
        return Err(format!(
            "Failed to list VNets ({}): {}",
            status, error_text
        ));
    }

    let vnet_json: serde_json::Value = vnet_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse VNets response: {}", e))?;

    let vnets: Vec<AzureVnet> = vnet_json["value"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|v| {
            let id_str = v["id"].as_str().unwrap_or("");
            let rg = id_str
                .split("/resourceGroups/")
                .nth(1)
                .and_then(|s| s.split('/').next())
                .unwrap_or("")
                .to_string();

            AzureVnet {
                name: v["name"].as_str().unwrap_or("").to_string(),
                resource_group: rg,
                location: v["location"].as_str().unwrap_or("").to_string(),
                address_prefixes: v["properties"]["addressSpace"]["addressPrefixes"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|p| p.as_str().map(|s| s.to_string()))
                    .collect(),
            }
        })
        .collect();

    Ok(vnets)
}

/// Check Azure RBAC permissions by verifying role assignments.
#[tauri::command]
pub async fn check_azure_permissions(
    credentials: CloudCredentials,
) -> Result<CloudPermissionCheck, String> {
    let required_roles = vec![
        "Contributor".to_string(),
        "User Access Administrator".to_string(),
    ];

    let alternative_roles = vec![
        "Network Contributor".to_string(),
        "Storage Account Contributor".to_string(),
        "User Access Administrator".to_string(),
    ];

    let az_cli = match dependencies::find_azure_cli_path() {
        Some(path) => path,
        None => {
            return Ok(CloudPermissionCheck {
                has_all_permissions: true,
                checked_permissions: vec![],
                missing_permissions: vec![],
                message: "Azure CLI not installed. Permission check skipped.".to_string(),
                is_warning: true,
            });
        }
    };

    let subscription_id = credentials
        .azure_subscription_id
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or("Azure subscription ID is required for permission check")?;

    // Get current signed-in principal info
    let mut account_cmd = std::process::Command::new(&az_cli);
    account_cmd.args(["account", "show", "--output", "json"]);

    let account_output = account_cmd
        .output()
        .map_err(|e| format!("Failed to get Azure account: {}", e))?;

    if !account_output.status.success() {
        let stderr = String::from_utf8_lossy(&account_output.stderr);
        return Err(format!(
            "Azure authentication failed: {}",
            stderr.trim()
        ));
    }

    let assignee = if let Some(client_id) = &credentials.azure_client_id {
        if !client_id.is_empty() {
            client_id.clone()
        } else {
            let account_json: serde_json::Value =
                serde_json::from_slice(&account_output.stdout).unwrap_or_default();
            account_json["user"]["name"]
                .as_str()
                .unwrap_or("")
                .to_string()
        }
    } else {
        let account_json: serde_json::Value =
            serde_json::from_slice(&account_output.stdout).unwrap_or_default();
        account_json["user"]["name"]
            .as_str()
            .unwrap_or("")
            .to_string()
    };

    if assignee.is_empty() {
        return Ok(CloudPermissionCheck {
            has_all_permissions: true,
            checked_permissions: vec![],
            missing_permissions: vec![],
            message: "Unable to determine Azure principal. Permission check skipped.".to_string(),
            is_warning: true,
        });
    }

    // List role assignments for the principal
    let mut role_cmd = std::process::Command::new(&az_cli);
    role_cmd.args([
        "role",
        "assignment",
        "list",
        "--assignee",
        &assignee,
        "--subscription",
        subscription_id,
        "--query",
        "[].roleDefinitionName",
        "--output",
        "json",
    ]);

    let role_output = role_cmd
        .output()
        .map_err(|e| format!("Failed to list role assignments: {}", e))?;

    if !role_output.status.success() {
        let stderr = String::from_utf8_lossy(&role_output.stderr);

        if stderr.contains("AuthorizationFailed")
            || stderr.contains("does not have authorization")
        {
            return Ok(CloudPermissionCheck {
                has_all_permissions: true,
                checked_permissions: vec![],
                missing_permissions: vec![],
                message: "Unable to check role assignments (insufficient permissions). Proceeding without verification.".to_string(),
                is_warning: true,
            });
        }

        return Ok(CloudPermissionCheck {
            has_all_permissions: true,
            checked_permissions: vec![],
            missing_permissions: vec![],
            message: format!(
                "Permission check failed: {}. Proceeding without verification.",
                stderr.trim()
            ),
            is_warning: true,
        });
    }

    let assigned_roles: Vec<String> =
        serde_json::from_slice(&role_output.stdout).unwrap_or_default();

    let has_primary_roles = required_roles
        .iter()
        .all(|r| assigned_roles.iter().any(|a| a.eq_ignore_ascii_case(r)));

    let has_alternative_roles = alternative_roles
        .iter()
        .all(|r| assigned_roles.iter().any(|a| a.eq_ignore_ascii_case(r)));

    let has_owner = assigned_roles
        .iter()
        .any(|r| r.eq_ignore_ascii_case("Owner"));

    let has_all = has_owner || has_primary_roles || has_alternative_roles;

    let checked_permissions: Vec<String> = required_roles.clone();

    let missing_permissions: Vec<String> = if has_all {
        vec![]
    } else {
        required_roles
            .iter()
            .filter(|r| !assigned_roles.iter().any(|a| a.eq_ignore_ascii_case(r)))
            .cloned()
            .collect()
    };

    let message = if has_all {
        if has_owner {
            "Owner role verified - all permissions available.".to_string()
        } else {
            "Required Azure roles verified.".to_string()
        }
    } else {
        format!(
            "Missing role(s): {}. This might be a false positive if you have custom roles or inherited permissions.",
            missing_permissions.join(", ")
        )
    };

    Ok(CloudPermissionCheck {
        has_all_permissions: has_all,
        checked_permissions,
        missing_permissions,
        message,
        is_warning: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── validate_azure_subscription_id ──────────────────────────────────

    #[test]
    fn valid_subscription_id() {
        assert!(validate_azure_subscription_id("550e8400-e29b-41d4-a716-446655440000"));
    }

    #[test]
    fn invalid_subscription_id_wrong_format() {
        assert!(!validate_azure_subscription_id("not-a-uuid"));
    }

    #[test]
    fn invalid_subscription_id_empty() {
        assert!(!validate_azure_subscription_id(""));
    }

    #[test]
    fn invalid_subscription_id_no_dashes() {
        assert!(!validate_azure_subscription_id("550e8400e29b41d4a716446655440000"));
    }
}
