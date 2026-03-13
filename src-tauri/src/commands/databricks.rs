//! Databricks authentication and Unity Catalog permission commands.

use super::debug_log;
use super::{databricks_accounts_host, http_client, is_valid_uuid};
#[cfg(debug_assertions)]
use super::mask_sensitive_id;
use super::{CloudCredentials, MetastoreInfo, UCPermissionCheck};
use crate::dependencies;
use serde::Serialize;
use std::fs;
use std::process::Stdio;

/// Azure AD resource ID for Databricks - used to obtain tokens for account-level APIs
const DATABRICKS_AZURE_RESOURCE_ID: &str = "2ff814a6-3304-4ab8-85cb-cd0e6f879c1d";

const MSG_NO_METASTORE: &str = "No metastore found in region. A new one will be created.";
const MSG_METASTORE_UNAVAILABLE: &str =
    "Metastore detection unavailable. Any existing metastore will be auto-detected during deployment.";

/// Fetch Azure AD access token for Databricks resource.
/// If token retrieval fails due to missing consent/interaction, trigger interactive login and retry.
fn get_azure_databricks_token_with_fallback(
    az_cli_path: &std::path::Path,
    azure_tenant_id: Option<&str>,
) -> Result<String, String> {
    let mut token_args = vec![
        "account".to_string(),
        "get-access-token".to_string(),
        "--resource".to_string(),
        DATABRICKS_AZURE_RESOURCE_ID.to_string(),
        "--query".to_string(),
        "accessToken".to_string(),
        "-o".to_string(),
        "tsv".to_string(),
    ];
    if let Some(tid) = azure_tenant_id.filter(|t| !t.is_empty()) {
        token_args.push("--tenant".to_string());
        token_args.push(tid.to_string());
    }

    let token_output = super::silent_cmd(az_cli_path)
        .args(&token_args)
        .output()
        .map_err(|e| format!("Failed to get Azure AD token: {}", e))?;

    if token_output.status.success() {
        let token = String::from_utf8_lossy(&token_output.stdout).trim().to_string();
        if token.is_empty() {
            return Err("Azure AD token response was empty.".to_string());
        }
        return Ok(token);
    }

    let stderr = String::from_utf8_lossy(&token_output.stderr).to_lowercase();
    let needs_interactive_login = stderr.contains("interaction_required")
        || stderr.contains("consent_required")
        || stderr.contains("aadsts65001")
        || stderr.contains("please run 'az login'")
        || stderr.contains("reauthenticate");

    if !needs_interactive_login {
        return Err(format!(
            "Failed to authenticate with Azure AD: {}",
            String::from_utf8_lossy(&token_output.stderr).trim()
        ));
    }

    let mut login_args = vec!["login".to_string()];
    if let Some(tid) = azure_tenant_id.filter(|t| !t.is_empty()) {
        login_args.push("--tenant".to_string());
        login_args.push(tid.to_string());
    }
    login_args.push("--scope".to_string());
    login_args.push(format!("{}/.default", DATABRICKS_AZURE_RESOURCE_ID));

    let mut child = super::silent_cmd(az_cli_path)
        .args(&login_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run interactive Azure login: {}", e))?;

    super::acquire_login_slot(child.id()).map_err(|e| {
        let _ = child.kill();
        e
    })?;

    let timeout = std::time::Duration::from_secs(300);
    let start = std::time::Instant::now();

    let login_result: Result<(), String> = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|e| format!("Failed to read output: {}", e))?;
                if !status.success() {
                    let was_cancelled =
                        super::lock_or_recover(&super::CLI_LOGIN_PROCESS).is_none();
                    if was_cancelled {
                        break Err("LOGIN_CANCELLED".to_string());
                    }
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let stderr_str = stderr.trim();
                    if stderr_str.is_empty()
                        || stderr_str.contains("Killed")
                        || stderr_str.contains("terminated")
                    {
                        break Err("LOGIN_CANCELLED".to_string());
                    }
                    break Err(format!("Interactive Azure login failed: {}", stderr_str));
                }
                break Ok(());
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    break Err(
                        "Azure consent login timed out after 5 minutes. Please try again."
                            .to_string(),
                    );
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            Err(e) => break Err(format!("Error waiting for Azure CLI: {}", e)),
        }
    };

    super::release_login_slot();

    login_result?;

    let retry_output = super::silent_cmd(az_cli_path)
        .args(&token_args)
        .output()
        .map_err(|e| format!("Failed to get Azure AD token after login: {}", e))?;

    if !retry_output.status.success() {
        return Err(format!(
            "Failed to authenticate with Azure AD after interactive login: {}",
            String::from_utf8_lossy(&retry_output.stderr).trim()
        ));
    }

    let token = String::from_utf8_lossy(&retry_output.stdout).trim().to_string();
    if token.is_empty() {
        return Err("Azure AD token response was empty after interactive login.".to_string());
    }
    Ok(token)
}

/// List Databricks CLI profiles for a given cloud.
#[tauri::command]
pub fn get_databricks_profiles(cloud: String) -> Vec<dependencies::DatabricksProfile> {
    dependencies::get_databricks_profiles_for_cloud(&cloud)
}

/// Run interactive `databricks auth login` for a given cloud/account.
#[tauri::command]
pub async fn databricks_cli_login(cloud: String, account_id: String) -> Result<String, String> {
    let cli_path = dependencies::find_databricks_cli_path()
        .ok_or_else(|| crate::errors::cli_not_found("Databricks CLI"))?;

    let host = format!("https://{}", databricks_accounts_host(&cloud));

    let profile_name = format!("deployer-{}", &account_id[..8.min(account_id.len())]);

    // Clear the token cache to force re-authentication
    if let Some(home) = dirs::home_dir() {
        let token_cache_path = home.join(".databricks").join("token-cache.json");
        if token_cache_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&token_cache_path) {
                if let Ok(mut cache) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(obj) = cache.as_object_mut() {
                        let keys_to_remove: Vec<String> = obj
                            .keys()
                            .filter(|k| k.contains(&account_id) || k.contains(&host))
                            .cloned()
                            .collect();

                        for key in keys_to_remove {
                            obj.remove(&key);
                        }

                        if let Ok(new_content) = serde_json::to_string_pretty(&cache) {
                            let _ = std::fs::write(&token_cache_path, new_content);
                        }
                    }
                }
            }
        }
    }

    let mut child = super::silent_cmd(&cli_path)
        .args([
            "auth",
            "login",
            "--host",
            &host,
            "--account-id",
            &account_id,
            "--profile",
            &profile_name,
        ])
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to run Databricks CLI: {}", e))?;

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for Databricks CLI: {}", e))?;

    if status.success() {
        Ok(format!(
            "Login successful! Profile '{}' created/updated.",
            profile_name
        ))
    } else {
        let profiles = dependencies::get_databricks_profiles_for_cloud(&cloud);
        if profiles.iter().any(|p| p.name == profile_name) {
            Ok(format!("Profile '{}' is ready.", profile_name))
        } else {
            Err("Login failed or was cancelled. Please try again.".to_string())
        }
    }
}

/// Read credentials from a specific Databricks CLI profile.
#[tauri::command]
pub fn get_databricks_profile_credentials(
    profile_name: String,
) -> Result<std::collections::HashMap<String, String>, String> {
    let config_path = dependencies::get_databricks_config_path()
        .ok_or_else(|| "Databricks config file not found".to_string())?;

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    let mut in_target_profile = false;
    let mut credentials: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    for line in content.lines() {
        let line = line.trim();

        if line.starts_with('[') && line.ends_with(']') {
            let section_name = &line[1..line.len() - 1];
            in_target_profile = section_name == profile_name;
            continue;
        }

        if in_target_profile {
            if let Some(eq_pos) = line.find('=') {
                let key = line[..eq_pos].trim().to_string();
                let value = line[eq_pos + 1..].trim().to_string();
                credentials.insert(key, value);
            }
        }
    }

    if credentials.is_empty() {
        Err(format!(
            "Profile '{}' not found or has no credentials",
            profile_name
        ))
    } else {
        Ok(credentials)
    }
}

/// Create a Databricks CLI profile with service principal credentials.
#[tauri::command]
pub fn create_databricks_sp_profile(
    cloud: String,
    account_id: String,
    client_id: String,
    client_secret: String,
) -> Result<String, String> {
    let host = format!("https://{}", databricks_accounts_host(&cloud));

    let profile_name = format!("deployer-sp-{}", &account_id[..8.min(account_id.len())]);

    let config_path = match dependencies::get_databricks_config_path() {
        Some(p) => p,
        None => dirs::home_dir()
            .map(|h| h.join(".databrickscfg"))
            .ok_or_else(|| "Could not determine home directory".to_string())?,
    };

    let existing_content = fs::read_to_string(&config_path).unwrap_or_default();

    let new_profile_section = format!(
        "[{}]\nhost = {}\naccount_id = {}\nclient_id = {}\nclient_secret = {}\n",
        profile_name, host, account_id, client_id, client_secret
    );

    let mut new_content = String::new();
    let mut in_target_profile = false;
    let mut profile_replaced = false;
    let mut skip_until_next_section = false;

    for line in existing_content.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let section_name = &trimmed[1..trimmed.len() - 1];

            if in_target_profile {
                in_target_profile = false;
                skip_until_next_section = false;
            }

            if section_name == profile_name {
                in_target_profile = true;
                skip_until_next_section = true;
                profile_replaced = true;
                new_content.push_str(&new_profile_section);
                new_content.push('\n');
                continue;
            }
        }

        if !skip_until_next_section {
            new_content.push_str(line);
            new_content.push('\n');
        }
    }

    if !profile_replaced {
        if !new_content.is_empty() && !new_content.ends_with("\n\n") {
            new_content.push('\n');
        }
        new_content.push_str(&new_profile_section);
    }

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    fs::write(&config_path, new_content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    Ok(profile_name)
}

/// Validate Databricks service principal credentials via OAuth token exchange.
#[tauri::command]
pub async fn validate_databricks_credentials(
    account_id: String,
    client_id: String,
    client_secret: String,
    cloud: String,
) -> Result<String, String> {
    let accounts_host = databricks_accounts_host(&cloud);

    let token_url = format!(
        "https://{}/oidc/accounts/{}/v1/token",
        accounts_host, account_id
    );

    let client = http_client()?;

    let token_response = client
        .post(&token_url)
        .form(&[
            ("grant_type", "client_credentials"),
            ("scope", "all-apis"),
        ])
        .basic_auth(&client_id, Some(&client_secret))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Databricks: {}", e))?;

    if !token_response.status().is_success() {
        let status = token_response.status();
        let error_text = token_response.text().await.unwrap_or_default();
        return Err(format!(
            "Authentication failed ({}): Invalid credentials or account ID. {}",
            status, error_text
        ));
    }

    let token_json: serde_json::Value = token_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    let access_token = token_json["access_token"]
        .as_str()
        .ok_or("No access token in response")?;

    // Use SCIM API to list users — only account admins can do this
    let users_url = format!(
        "https://{}/api/2.0/accounts/{}/scim/v2/Users?count=1",
        accounts_host, account_id
    );

    let users_response = client
        .get(&users_url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to verify account access: {}", e))?;

    if !users_response.status().is_success() {
        let status = users_response.status();
        if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(
                "Service principal does not have account admin privileges. \
                Please grant 'Account admin' role in Databricks Account Console → \
                User Management → Service Principals → [Your SP] → Roles."
                    .to_string(),
            );
        }
        return Err(format!(
            "Cannot verify account access ({}). Check your Account ID and service principal permissions.",
            status
        ));
    }

    let users_json: serde_json::Value = users_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if users_json.get("totalResults").is_some() || users_json.get("Resources").is_some() {
        return Ok("Credentials validated - Account Admin access confirmed".to_string());
    }

    Ok("Credentials validated successfully".to_string())
}

/// Validate a Databricks CLI profile (for OAuth/SSO profiles without client credentials).
/// Uses the Databricks CLI to list users, which requires account admin access.
#[tauri::command]
pub async fn validate_databricks_profile(
    profile_name: String,
    cloud: String,
) -> Result<String, String> {
    let cli_path = dependencies::find_databricks_cli_path()
        .ok_or_else(|| crate::errors::cli_not_found("Databricks CLI"))?;

    let accounts_host = databricks_accounts_host(&cloud);

    // Use the CLI to list users (requires account admin access)
    let output = super::silent_cmd(&cli_path)
        .args([
            "account", "users", "list",
            "--profile", &profile_name,
            "--output", "json",
        ])
        .output()
        .map_err(|e| format!("Failed to run Databricks CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr_trimmed = stderr.trim();

        if stderr_trimmed.contains("unauthorized") || stderr_trimmed.contains("401") {
            return Err(format!(
                "Profile '{}' is not authorized. Please re-authenticate:\n\
                databricks auth login --host https://{} --profile {}",
                profile_name, accounts_host, profile_name
            ));
        }
        if stderr_trimmed.contains("403") || stderr_trimmed.contains("forbidden") {
            return Err(format!(
                "Profile '{}' does not have account admin privileges.\n\n\
                Please grant the 'Account admin' role in Databricks Account Console → User Management.",
                profile_name
            ));
        }

        return Err(format!(
            "Failed to validate profile '{}': {}",
            profile_name, stderr_trimmed
        ));
    }

    Ok(format!("Profile '{}' validated - Account Admin access confirmed", profile_name))
}

// ─── Unity Catalog ──────────────────────────────────────────────────────────

/// Normalize a region string for case-/punctuation-insensitive comparison.
fn normalize_region(s: &str) -> String {
    s.to_lowercase().replace(' ', "").replace('-', "")
}

/// Find the first metastore in a JSON array whose region matches (normalized).
fn find_metastore_for_region<'a>(
    metastores: Option<&'a Vec<serde_json::Value>>,
    region: &str,
) -> Option<&'a serde_json::Value> {
    let region_normalized = normalize_region(region);
    metastores?.iter().find(|m| {
        let mr = m["region"].as_str().unwrap_or("");
        normalize_region(mr) == region_normalized
    })
}

/// Generate a message about metastore ownership for permission guidance.
fn get_metastore_owner_info(metastore_owner: &str, credentials: &CloudCredentials) -> String {
    let is_user = metastore_owner.contains('@');
    let is_uuid = is_valid_uuid(metastore_owner);

    // Determine the current user/SP identity based on active authentication method
    // Priority: GCP service account (JSON or email) > Azure user > Databricks SP > Databricks profile
    let current_identity = if let Some(gcp_creds_json) = credentials.gcp_credentials_json.as_ref().filter(|s| !s.is_empty()) {
        // GCP service account authentication (credentials mode - extract from JSON)
        if let Ok(sa_data) = serde_json::from_str::<serde_json::Value>(gcp_creds_json) {
            if let Some(email) = sa_data["client_email"].as_str() {
                format!("Service account '{}'", email)
            } else {
                // JSON parsing succeeded but no client_email, continue to next check
                if let Some(sa_email) = credentials.gcp_service_account_email.as_ref().filter(|s| !s.is_empty()) {
                    format!("Service account '{}'", sa_email)
                } else if let Some(email) = credentials.azure_account_email.as_ref().filter(|s| !s.is_empty()) {
                    format!("User '{}'", email)
                } else if let Some(client_id) = credentials.databricks_client_id.as_ref().filter(|s| !s.is_empty()) {
                    format!("Service principal '{}'", client_id)
                } else if let Some(profile) = credentials.databricks_profile.as_ref().filter(|s| !s.is_empty()) {
                    format!("Profile '{}'", profile)
                } else {
                    "Your Databricks user or service principal".to_string()
                }
            }
        } else {
            // JSON parsing failed, continue to other checks
            if let Some(sa_email) = credentials.gcp_service_account_email.as_ref().filter(|s| !s.is_empty()) {
                format!("Service account '{}'", sa_email)
            } else if let Some(email) = credentials.azure_account_email.as_ref().filter(|s| !s.is_empty()) {
                format!("User '{}'", email)
            } else if let Some(client_id) = credentials.databricks_client_id.as_ref().filter(|s| !s.is_empty()) {
                format!("Service principal '{}'", client_id)
            } else if let Some(profile) = credentials.databricks_profile.as_ref().filter(|s| !s.is_empty()) {
                format!("Profile '{}'", profile)
            } else {
                "Your Databricks user or service principal".to_string()
            }
        }
    } else if let Some(sa_email) = credentials.gcp_service_account_email.as_ref().filter(|s| !s.is_empty()) {
        // GCP service account authentication (impersonation mode)
        format!("Service account '{}'", sa_email)
    } else if let Some(email) = credentials.azure_account_email.as_ref().filter(|s| !s.is_empty()) {
        // Azure user identity
        format!("User '{}'", email)
    } else if let Some(client_id) = credentials.databricks_client_id.as_ref().filter(|s| !s.is_empty()) {
        // Databricks service principal (used by AWS/Azure/GCP)
        format!("Service principal '{}'", client_id)
    } else if let Some(profile) = credentials.databricks_profile.as_ref().filter(|s| !s.is_empty()) {
        // Databricks CLI profile
        format!("Profile '{}'", profile)
    } else {
        "Your Databricks user or service principal".to_string()
    };

    if is_user {
        format!(
            "Metastore owned by user '{}'. {} should have the required permissions granted on this metastore.",
            metastore_owner, current_identity
        )
    } else if is_uuid {
        format!(
            "Metastore owned by service principal '{}'. {} should have the required permissions granted on this metastore.",
            metastore_owner, current_identity
        )
    } else {
        format!(
            "Metastore owned by group '{}'. {} should have the required permissions granted on this metastore.",
            metastore_owner, current_identity
        )
    }
}

/// Check Unity Catalog permissions (metastore presence and grants).
#[tauri::command]
pub async fn check_uc_permissions(
    credentials: CloudCredentials,
    region: String,
) -> Result<UCPermissionCheck, String> {
    let cloud = credentials.cloud.as_deref().unwrap_or_else(|| {
        if credentials.azure_tenant_id.is_some() {
            "azure"
        } else if credentials.gcp_project_id.is_some() {
            "gcp"
        } else {
            "aws"
        }
    });

    let account_id = credentials
        .databricks_account_id
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or("Databricks account ID is required")?;

    let auth_type = credentials
        .databricks_auth_type
        .as_deref()
        .unwrap_or("credentials");

    debug_log!("[check_uc_permissions] ENTER: cloud={}, auth_type={}, region={}", cloud, auth_type, region);

    // Azure Identity mode: use Azure CLI to get token and call Databricks API directly
    if cloud == "azure" && credentials.azure_databricks_use_identity == Some(true) {
        debug_log!("[check_uc_permissions] Using Azure identity mode");
        
        let az_cli_path = match dependencies::find_azure_cli_path() {
            Some(path) => path,
            None => {
                return Ok(UCPermissionCheck {
                    metastore: MetastoreInfo {
                        exists: false,
                        metastore_id: None,
                        metastore_name: None,
                        region: Some(region),
                    },
                    has_create_catalog: true,
                    has_create_external_location: true,
                    has_create_storage_credential: true,
                    can_create_catalog: true,
                    message: "Azure CLI not installed. Metastore detection unavailable.".to_string(),
                });
            }
        };
        
        // Get Azure AD token for Databricks (runs in a blocking thread to avoid
        // tying up the Tokio worker if interactive consent login is triggered).
        debug_log!("[check_uc_permissions] running: az account get-access-token ...");
        let az_path_owned = az_cli_path.to_path_buf();
        let tenant_id_owned = credentials.azure_tenant_id.clone();
        let token_result = tokio::task::spawn_blocking(move || {
            get_azure_databricks_token_with_fallback(
                &az_path_owned,
                tenant_id_owned.as_deref(),
            )
        })
        .await
        .map_err(|e| format!("Token task panicked: {}", e))?;

        let azure_token = match token_result {
            Ok(token) => {
                debug_log!("[check_uc_permissions] az token acquisition succeeded");
                token
            }
            Err(e) => {
                debug_log!("[check_uc_permissions] az token acquisition failed: {}", e);
                return Ok(UCPermissionCheck {
                    metastore: MetastoreInfo {
                        exists: false,
                        metastore_id: None,
                        metastore_name: None,
                        region: Some(region),
                    },
                    has_create_catalog: true,
                    has_create_external_location: true,
                    has_create_storage_credential: true,
                    can_create_catalog: true,
                    message: MSG_METASTORE_UNAVAILABLE.to_string(),
                });
            }
        };
        
        // Use the Azure AD token directly for metastores API (no token exchange needed)
        let client = http_client()?;
            
        let metastores_url = format!(
            "https://accounts.azuredatabricks.net/api/2.0/accounts/{}/metastores",
            account_id
        );
        
        debug_log!(
            "[check_uc_permissions] Calling metastores API for account: {}",
            mask_sensitive_id(account_id)
        );
        
        debug_log!("[check_uc_permissions] sending metastores GET to {}", metastores_url);
        let metastores_response = client
            .get(&metastores_url)
            .bearer_auth(&azure_token)
            .send()
            .await;
        debug_log!("[check_uc_permissions] metastores response received, ok={}", metastores_response.is_ok());
        
        if let Ok(metastores_resp) = metastores_response {
            if metastores_resp.status().is_success() {
                if let Ok(metastores_json) = metastores_resp.json::<serde_json::Value>().await {
                    let metastores = metastores_json["metastores"].as_array();
                    debug_log!(
                        "[check_uc_permissions] Metastores API success: found {} metastore(s)",
                        metastores.map(|arr| arr.len()).unwrap_or(0)
                    );

                    if let Some(metastore) = find_metastore_for_region(metastores, &region) {
                        let metastore_id = metastore["metastore_id"].as_str().unwrap_or("");
                        let metastore_name = metastore["name"].as_str().unwrap_or("");
                        let metastore_owner = metastore["owner"].as_str().unwrap_or("");
                        
                        let message = get_metastore_owner_info(metastore_owner, &credentials);
                        
                        return Ok(UCPermissionCheck {
                            metastore: MetastoreInfo {
                                exists: true,
                                metastore_id: Some(metastore_id.to_string()),
                                metastore_name: Some(metastore_name.to_string()),
                                region: Some(region),
                            },
                            has_create_catalog: false,
                            has_create_external_location: false,
                            has_create_storage_credential: false,
                            can_create_catalog: false,
                            message,
                        });
                    } else {
                        return Ok(UCPermissionCheck {
                            metastore: MetastoreInfo {
                                exists: false,
                                metastore_id: None,
                                metastore_name: None,
                                region: Some(region),
                            },
                            has_create_catalog: true,
                            has_create_external_location: true,
                            has_create_storage_credential: true,
                            can_create_catalog: true,
                            message: MSG_NO_METASTORE.to_string(),
                        });
                    }
                }
            }
        }
        
        // Fallback if any step fails
        debug_log!("[check_uc_permissions] Azure identity path: falling back (some step failed)");
        return Ok(UCPermissionCheck {
            metastore: MetastoreInfo {
                exists: false,
                metastore_id: None,
                metastore_name: None,
                region: Some(region),
            },
            has_create_catalog: true,
            has_create_external_location: true,
            has_create_storage_credential: true,
            can_create_catalog: true,
            message: MSG_METASTORE_UNAVAILABLE.to_string(),
        });
    }

    // For AWS/Azure with profile auth, use Databricks CLI to list metastores
    debug_log!("[check_uc_permissions] checking profile path: auth_type={}, cloud={}", auth_type, cloud);
    if auth_type == "profile" && cloud != "gcp" {
        let profile_name = credentials
            .databricks_profile
            .as_deref()
            .unwrap_or("DEFAULT");

        let cli_path = dependencies::find_databricks_cli_path();
        debug_log!("[check_uc_permissions] profile={}, cli found={}", profile_name, cli_path.is_some());

        if let Some(cli) = cli_path {
            debug_log!("[check_uc_permissions] running: databricks account metastores list -p {}", profile_name);
            let output = super::silent_cmd(&cli)
                .args([
                    "account",
                    "metastores",
                    "list",
                    "--output",
                    "json",
                    "-p",
                    profile_name,
                ])
                .output();
            debug_log!("[check_uc_permissions] CLI command finished, success={}", output.as_ref().map(|o| o.status.success()).unwrap_or(false));

            if let Ok(out) = output {
                if out.status.success() {
                    let stdout = String::from_utf8_lossy(&out.stdout);

                    if let Ok(metastores_json) =
                        serde_json::from_str::<serde_json::Value>(&stdout)
                    {
                        if let Some(arr) = metastores_json.as_array() {
                            if let Some(metastore) = find_metastore_for_region(Some(arr), &region) {
                                let metastore_id =
                                    metastore["metastore_id"].as_str().unwrap_or("");
                                let metastore_name = metastore["name"].as_str().unwrap_or("");
                                let metastore_owner = metastore["owner"].as_str().unwrap_or("");

                                let message = get_metastore_owner_info(metastore_owner, &credentials);

                                return Ok(UCPermissionCheck {
                                    metastore: MetastoreInfo {
                                        exists: true,
                                        metastore_id: Some(metastore_id.to_string()),
                                        metastore_name: Some(metastore_name.to_string()),
                                        region: Some(region),
                                    },
                                    has_create_catalog: false,
                                    has_create_external_location: false,
                                    has_create_storage_credential: false,
                                    can_create_catalog: false,
                                    message,
                                });
                            }
                        }
                    }
                }
            }
        }

        return Ok(UCPermissionCheck {
            metastore: MetastoreInfo {
                exists: false,
                metastore_id: None,
                metastore_name: None,
                region: Some(region),
            },
            has_create_catalog: true,
            has_create_external_location: true,
            has_create_storage_credential: true,
            can_create_catalog: true,
            message: MSG_NO_METASTORE.to_string(),
        });
    }

    // For GCP, generate an ID token and call the Databricks Account Metastores API
    debug_log!("[check_uc_permissions] checking GCP path: cloud={}", cloud);
    if cloud == "gcp" {
        let mut id_token: Option<String> = None;

        // Method 1: Use service account JSON credentials
        if let Some(sa_json) = credentials
            .gcp_credentials_json
            .as_ref()
            .filter(|s| !s.is_empty())
        {
            if let Ok(sa_creds) = serde_json::from_str::<serde_json::Value>(sa_json) {
                let client_email = sa_creds["client_email"].as_str();
                let private_key = sa_creds["private_key"].as_str();

                if let (Some(email), Some(key)) = (client_email, private_key) {
                    use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};

                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs();

                    #[derive(Serialize)]
                    struct IdTokenClaims {
                        iss: String,
                        sub: String,
                        aud: String,
                        target_audience: String,
                        iat: u64,
                        exp: u64,
                    }

                    let claims = IdTokenClaims {
                        iss: email.to_string(),
                        sub: email.to_string(),
                        aud: "https://oauth2.googleapis.com/token".to_string(),
                        target_audience: "https://accounts.gcp.databricks.com".to_string(),
                        iat: now,
                        exp: now + 3600,
                    };

                    let header = Header::new(Algorithm::RS256);

                    if let Ok(encoding_key) = EncodingKey::from_rsa_pem(key.as_bytes()) {
                        if let Ok(assertion) = encode(&header, &claims, &encoding_key) {
                            let client = http_client()?;
                            let token_response = client
                                .post("https://oauth2.googleapis.com/token")
                                .form(&[
                                    (
                                        "grant_type",
                                        "urn:ietf:params:oauth:grant-type:jwt-bearer",
                                    ),
                                    ("assertion", &assertion),
                                ])
                                .send()
                                .await;

                            if let Ok(resp) = token_response {
                                if resp.status().is_success() {
                                    if let Ok(token_json) =
                                        resp.json::<serde_json::Value>().await
                                    {
                                        id_token = token_json["id_token"]
                                            .as_str()
                                            .map(|s| s.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Method 2: Use IAM Credentials API with OAuth token
        if id_token.is_none() {
            debug_log!("[check_uc_permissions] Method 2: Trying IAM Credentials API");
            debug_log!(
                "[check_uc_permissions] gcp_oauth_token present: {}",
                credentials
                    .gcp_oauth_token
                    .as_ref()
                    .map(|s| !s.is_empty())
                    .unwrap_or(false)
            );
            debug_log!(
                "[check_uc_permissions] gcp_service_account_email: {:?}",
                credentials.gcp_service_account_email
            );

            if let Some(oauth_token) =
                credentials.gcp_oauth_token.as_ref().filter(|s| !s.is_empty())
            {
                if let Some(sa_email) = credentials
                    .gcp_service_account_email
                    .as_ref()
                    .filter(|s| !s.is_empty())
                {
                    let client = http_client()?;

                    let generate_token_url = format!(
                        "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{}:generateIdToken",
                        sa_email
                    );

                    debug_log!(
                        "[check_uc_permissions] Calling IAM generateIdToken for SA: {}",
                        mask_sensitive_id(sa_email)
                    );

                    let token_response = client
                        .post(&generate_token_url)
                        .bearer_auth(oauth_token)
                        .json(&serde_json::json!({
                            "audience": "https://accounts.gcp.databricks.com",
                            "includeEmail": true
                        }))
                        .send()
                        .await;

                    if let Ok(resp) = token_response {
                        let status = resp.status();
                        debug_log!(
                            "[check_uc_permissions] IAM API response status: {}",
                            status
                        );
                        if status.is_success() {
                            if let Ok(token_json) = resp.json::<serde_json::Value>().await {
                                id_token =
                                    token_json["token"].as_str().map(|s| s.to_string());
                                debug_log!(
                                    "[check_uc_permissions] Got ID token via IAM API: {}",
                                    id_token.is_some()
                                );
                            }
                        } else {
                            let _error_body = resp.text().await.unwrap_or_default();
                            debug_log!(
                                "[check_uc_permissions] IAM API error: {}",
                                _error_body
                            );
                        }
                    } else if let Err(_e) = token_response {
                        debug_log!(
                            "[check_uc_permissions] IAM API request failed: {}",
                            _e
                        );
                    }
                }
            }
        }

        // Method 3: Fall back to gcloud CLI
        if id_token.is_none() {
            debug_log!("[check_uc_permissions] Method 3: Trying gcloud CLI");
            if let Some(sa_email) = credentials
                .gcp_service_account_email
                .as_ref()
                .filter(|s| !s.is_empty())
            {
                if let Some(gcloud_cli) = dependencies::find_gcloud_cli_path() {
                    let mut id_token_cmd = super::silent_cmd(&gcloud_cli);
                    id_token_cmd.args([
                        "auth",
                        "print-identity-token",
                        "--impersonate-service-account",
                        sa_email,
                        "--audiences",
                        "https://accounts.gcp.databricks.com",
                        "--include-email",
                    ]);

                    if let Ok(output) = id_token_cmd.output() {
                        if output.status.success() {
                            let token =
                                String::from_utf8_lossy(&output.stdout).trim().to_string();
                            if !token.is_empty() {
                                id_token = Some(token);
                                debug_log!(
                                    "[check_uc_permissions] Got ID token via gcloud CLI"
                                );
                            }
                        } else {
                            let _stderr = String::from_utf8_lossy(&output.stderr);
                            debug_log!(
                                "[check_uc_permissions] gcloud CLI failed: {}",
                                _stderr
                            );
                        }
                    }
                }
            }
        }

        debug_log!(
            "[check_uc_permissions] Final id_token present: {}",
            id_token.is_some()
        );

        // If we got an ID token, call the Databricks Metastores API
        if let Some(token) = id_token {
            let client = http_client()?;
            let metastores_url = format!(
                "https://accounts.gcp.databricks.com/api/2.0/accounts/{}/metastores",
                account_id
            );

            debug_log!(
                "[check_uc_permissions] Calling Databricks Metastores API for account: {}",
                mask_sensitive_id(account_id)
            );

            let metastores_response = client.get(&metastores_url).bearer_auth(&token).send().await;

            if let Ok(resp) = metastores_response {
                let status = resp.status();
                debug_log!("[check_uc_permissions] Databricks API status: {}", status);

                if status.is_success() {
                    if let Ok(metastores_json) = resp.json::<serde_json::Value>().await {
                        let metastores = metastores_json["metastores"].as_array();
                        debug_log!(
                            "[check_uc_permissions] Metastores API success: found {} metastore(s)",
                            metastores.map(|arr| arr.len()).unwrap_or(0)
                        );
                        
                        debug_log!(
                            "[check_uc_permissions] Looking for region: {} (normalized: {})",
                            region,
                            normalize_region(&region)
                        );

                        if let Some(metastore) = find_metastore_for_region(metastores, &region) {
                            let metastore_id =
                                metastore["metastore_id"].as_str().unwrap_or("");
                            let metastore_name = metastore["name"].as_str().unwrap_or("");
                            let metastore_owner = metastore["owner"].as_str().unwrap_or("");

                            let message = get_metastore_owner_info(metastore_owner, &credentials);

                            return Ok(UCPermissionCheck {
                                metastore: MetastoreInfo {
                                    exists: true,
                                    metastore_id: Some(metastore_id.to_string()),
                                    metastore_name: Some(metastore_name.to_string()),
                                    region: Some(region),
                                },
                                has_create_catalog: false,
                                has_create_external_location: false,
                                has_create_storage_credential: false,
                                can_create_catalog: false,
                                message,
                            });
                        } else {
                            return Ok(UCPermissionCheck {
                                metastore: MetastoreInfo {
                                    exists: false,
                                    metastore_id: None,
                                    metastore_name: None,
                                    region: Some(region),
                                },
                                has_create_catalog: true,
                                has_create_external_location: true,
                                has_create_storage_credential: true,
                                can_create_catalog: true,
                                message: MSG_NO_METASTORE.to_string(),
                            });
                        }
                    }
                }
            }
        }

        // Fallback when GCP ID token could not be obtained — allow deployment to proceed
        return Ok(UCPermissionCheck {
            metastore: MetastoreInfo {
                exists: false,
                metastore_id: None,
                metastore_name: None,
                region: Some(region),
            },
            has_create_catalog: true,
            has_create_external_location: true,
            has_create_storage_credential: true,
            can_create_catalog: true,
            message: MSG_METASTORE_UNAVAILABLE.to_string(),
        });
    }

    // Service principal credentials path
    debug_log!("[check_uc_permissions] entering SP credentials path");
    let client_id = credentials
        .databricks_client_id
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or("Client ID is required for permission check")?;

    let client_secret = credentials
        .databricks_client_secret
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or("Client Secret is required for permission check")?;

    let accounts_host = databricks_accounts_host(cloud);

    let token_url = format!(
        "https://{}/oidc/accounts/{}/v1/token",
        accounts_host, account_id
    );

    debug_log!("[check_uc_permissions] requesting OAuth token from {}", token_url);
    let client = http_client()?;

    let token_response = client
        .post(&token_url)
        .form(&[
            ("grant_type", "client_credentials"),
            ("scope", "all-apis"),
        ])
        .basic_auth(client_id, Some(client_secret))
        .send()
        .await
        .map_err(|e| format!("Failed to get OAuth token: {}", e))?;

    if !token_response.status().is_success() {
        return Err("Failed to authenticate with Databricks".to_string());
    }

    // Detect HTML responses on token endpoint
    let token_content_type = token_response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if token_content_type.contains("text/html") {
        return Err(
            "Received unexpected HTML response from Databricks token endpoint. Please verify your Databricks Account ID and credentials.".to_string()
        );
    }

    let token_json: serde_json::Value = token_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token: {}", e))?;

    let access_token = token_json["access_token"]
        .as_str()
        .ok_or("No access token in response")?;
    debug_log!("[check_uc_permissions] OAuth token obtained successfully");

    // List metastores (account-level API requires /accounts/{account_id} in path)
    let metastores_url = format!(
        "https://{}/api/2.0/accounts/{}/metastores",
        accounts_host, account_id
    );

    debug_log!("[check_uc_permissions] listing metastores from {}", metastores_url);
    let metastores_response = client
        .get(&metastores_url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to list metastores: {}", e))?;
    debug_log!("[check_uc_permissions] metastores response status={}", metastores_response.status());

    if !metastores_response.status().is_success() {
        return Ok(UCPermissionCheck {
            metastore: MetastoreInfo {
                exists: false,
                metastore_id: None,
                metastore_name: None,
                region: Some(region.clone()),
            },
            has_create_catalog: true,
            has_create_external_location: true,
            has_create_storage_credential: true,
            can_create_catalog: true,
            message: MSG_NO_METASTORE.to_string(),
        });
    }

    // Detect HTML responses (e.g., login page returned instead of JSON)
    let content_type = metastores_response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if content_type.contains("text/html") {
        return Err(
            "Received unexpected HTML response from Databricks API. This may indicate an authentication issue. Please verify your Databricks Account ID and credentials.".to_string()
        );
    }

    let metastores_json: serde_json::Value = metastores_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse metastores: {}", e))?;

    let metastores = metastores_json["metastores"].as_array();

    if let Some(metastore) = find_metastore_for_region(metastores, &region) {
        let metastore_id = metastore["metastore_id"].as_str().unwrap_or("");
        let metastore_name = metastore["name"].as_str().unwrap_or("");
        let metastore_owner = metastore["owner"].as_str().unwrap_or("");

        let owner_info = get_metastore_owner_info(metastore_owner, &credentials);

        // Metastore owner has implicit full privileges
        let is_owner = metastore_owner == client_id.as_str();

        let permissions_url = format!(
            "https://{}/api/2.0/accounts/{}/metastores/{}/permissions",
            accounts_host, account_id, metastore_id
        );

        debug_log!("[check_uc_permissions] fetching permissions from {}", permissions_url);
        let permissions_response = client
            .get(&permissions_url)
            .bearer_auth(access_token)
            .send()
            .await;
        debug_log!("[check_uc_permissions] permissions response received");

        let (has_create_catalog, has_create_external_location, has_create_storage_credential) =
            if is_owner {
                (true, true, true)
            } else if let Ok(resp) = permissions_response {
                if resp.status().is_success() {
                    if let Ok(perm_json) = resp.json::<serde_json::Value>().await {
                        let assignments = perm_json["privilege_assignments"].as_array();
                        let mut create_catalog = false;
                        let mut create_ext_loc = false;
                        let mut create_storage_cred = false;

                        if let Some(arr) = assignments {
                            for assignment in arr {
                                let principal = assignment["principal"].as_str().unwrap_or("");
                                if principal != client_id.as_str() {
                                    continue;
                                }
                                if let Some(privileges) = assignment["privileges"].as_array() {
                                    for priv_val in privileges {
                                        let priv_str = priv_val.as_str().unwrap_or("");
                                        match priv_str {
                                            "CREATE_CATALOG" => create_catalog = true,
                                            "CREATE_EXTERNAL_LOCATION" => create_ext_loc = true,
                                            "CREATE_STORAGE_CREDENTIAL" => {
                                                create_storage_cred = true
                                            }
                                            "ALL_PRIVILEGES" => {
                                                create_catalog = true;
                                                create_ext_loc = true;
                                                create_storage_cred = true;
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                            }
                        }
                        (create_catalog, create_ext_loc, create_storage_cred)
                    } else {
                        (false, false, false)
                    }
                } else {
                    (false, false, false)
                }
            } else {
                (false, false, false)
            };

        let can_create =
            has_create_catalog && has_create_external_location && has_create_storage_credential;
        let permissions_msg = if can_create {
            "You have the required permissions to create catalogs.".to_string()
        } else {
            let mut missing = Vec::new();
            if !has_create_catalog {
                missing.push("CREATE_CATALOG");
            }
            if !has_create_storage_credential {
                missing.push("CREATE_STORAGE_CREDENTIAL");
            }
            if !has_create_external_location {
                missing.push("CREATE_EXTERNAL_LOCATION");
            }
            format!(
                "Missing permissions: {}. Contact your Metastore Admin.",
                missing.join(", ")
            )
        };
        let message = format!("{} {}", owner_info, permissions_msg);

        Ok(UCPermissionCheck {
            metastore: MetastoreInfo {
                exists: true,
                metastore_id: Some(metastore_id.to_string()),
                metastore_name: Some(metastore_name.to_string()),
                region: Some(region),
            },
            has_create_catalog,
            has_create_external_location,
            has_create_storage_credential,
            can_create_catalog: can_create,
            message,
        })
    } else {
        Ok(UCPermissionCheck {
            metastore: MetastoreInfo {
                exists: false,
                metastore_id: None,
                metastore_name: None,
                region: Some(region),
            },
            has_create_catalog: true,
            has_create_external_location: true,
            has_create_storage_credential: true,
            can_create_catalog: true,
            message: MSG_NO_METASTORE.to_string(),
        })
    }
}

/// Validate Azure identity (account admin) for Databricks access.
/// Uses Azure CLI to get an Azure AD token and validates account admin access via SCIM API.
/// The Azure AD token can be used directly as a Bearer token for Databricks account-level APIs.
#[tauri::command]
pub async fn validate_azure_databricks_identity(
    account_id: String,
    azure_account_email: String,
    azure_tenant_id: Option<String>,
) -> Result<String, String> {
    // Get Azure AD token for Databricks using Azure CLI
    // Gracefully skip if CLI is not installed (consistent with cloud validation pattern)
    let az_cli_path = match dependencies::find_azure_cli_path() {
        Some(path) => path,
        None => {
            return Ok(format!(
                "Azure CLI not installed. Databricks validation skipped for account: {}",
                azure_account_email
            ));
        }
    };
    
    let az_path_owned = az_cli_path.to_path_buf();
    let tenant_id_owned = azure_tenant_id.clone();
    let azure_token = tokio::task::spawn_blocking(move || {
        get_azure_databricks_token_with_fallback(&az_path_owned, tenant_id_owned.as_deref())
    })
    .await
    .map_err(|e| format!("Token task panicked: {}", e))??;
    
    // Use the Azure AD token directly for SCIM API (no token exchange needed)
    let client = http_client()?;
    let users_url = format!(
        "https://accounts.azuredatabricks.net/api/2.0/accounts/{}/scim/v2/Users?count=1",
        account_id
    );
    
    let users_response = client
        .get(&users_url)
        .bearer_auth(&azure_token)
        .send()
        .await
        .map_err(|e| format!("Failed to verify account access: {}", e))?;
    
    if !users_response.status().is_success() {
        let status = users_response.status();
        if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(format!(
                "Your Azure account ({}) does not have account admin privileges.\n\n\
                Please grant the 'Account admin' role in Databricks Account Console → User Management.",
                azure_account_email
            ));
        }
        return Err(format!(
            "Cannot verify account access ({}). Check your Databricks Account ID.",
            status
        ));
    }
    
    Ok(format!("Azure identity validated - Account Admin access confirmed for: {}", azure_account_email))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── normalize_region ────────────────────────────────────────────────

    #[test]
    fn normalize_region_lowercase() {
        assert_eq!(normalize_region("US-East-1"), "useast1");
    }

    #[test]
    fn normalize_region_removes_spaces() {
        assert_eq!(normalize_region("East US 2"), "eastus2");
    }

    #[test]
    fn normalize_region_removes_hyphens() {
        assert_eq!(normalize_region("us-west-2"), "uswest2");
    }

    #[test]
    fn normalize_region_already_normalized() {
        assert_eq!(normalize_region("useast1"), "useast1");
    }

    #[test]
    fn normalize_region_empty() {
        assert_eq!(normalize_region(""), "");
    }

    // ── find_metastore_for_region ───────────────────────────────────────

    #[test]
    fn find_metastore_matching_region() {
        let metastores = vec![
            serde_json::json!({"metastore_id": "ms-1", "region": "us-east-1", "name": "east"}),
            serde_json::json!({"metastore_id": "ms-2", "region": "eu-west-1", "name": "west"}),
        ];
        let result = find_metastore_for_region(Some(&metastores), "us-east-1");
        assert!(result.is_some());
        assert_eq!(result.unwrap()["metastore_id"], "ms-1");
    }

    #[test]
    fn find_metastore_case_insensitive() {
        let metastores = vec![
            serde_json::json!({"metastore_id": "ms-1", "region": "US-East-1", "name": "east"}),
        ];
        let result = find_metastore_for_region(Some(&metastores), "us-east-1");
        assert!(result.is_some());
    }

    #[test]
    fn find_metastore_no_match() {
        let metastores = vec![
            serde_json::json!({"metastore_id": "ms-1", "region": "eu-west-1", "name": "west"}),
        ];
        let result = find_metastore_for_region(Some(&metastores), "us-east-1");
        assert!(result.is_none());
    }

    #[test]
    fn find_metastore_none_list() {
        let result = find_metastore_for_region(None, "us-east-1");
        assert!(result.is_none());
    }

    #[test]
    fn find_metastore_empty_list() {
        let metastores = vec![];
        let result = find_metastore_for_region(Some(&metastores), "us-east-1");
        assert!(result.is_none());
    }

    // ── get_metastore_owner_info ────────────────────────────────────────

    fn default_creds() -> CloudCredentials {
        CloudCredentials::default()
    }

    #[test]
    fn owner_info_user_owner() {
        let msg = get_metastore_owner_info("admin@company.com", &default_creds());
        assert!(msg.contains("owned by user 'admin@company.com'"));
    }

    #[test]
    fn owner_info_sp_owner_uuid() {
        let msg = get_metastore_owner_info("550e8400-e29b-41d4-a716-446655440000", &default_creds());
        assert!(msg.contains("owned by service principal"));
    }

    #[test]
    fn owner_info_group_owner() {
        let msg = get_metastore_owner_info("admins", &default_creds());
        assert!(msg.contains("owned by group 'admins'"));
    }

    #[test]
    fn owner_info_identity_from_azure_email() {
        let mut creds = default_creds();
        creds.azure_account_email = Some("user@azure.com".to_string());
        let msg = get_metastore_owner_info("admin@company.com", &creds);
        assert!(msg.contains("User 'user@azure.com'"));
    }

    #[test]
    fn owner_info_identity_from_databricks_sp() {
        let mut creds = default_creds();
        creds.databricks_client_id = Some("sp-client-id".to_string());
        let msg = get_metastore_owner_info("admins", &creds);
        assert!(msg.contains("Service principal 'sp-client-id'"));
    }

    #[test]
    fn owner_info_identity_from_profile() {
        let mut creds = default_creds();
        creds.databricks_profile = Some("deployer-abc12345".to_string());
        let msg = get_metastore_owner_info("admins", &creds);
        assert!(msg.contains("Profile 'deployer-abc12345'"));
    }

    #[test]
    fn owner_info_gcp_sa_email() {
        let mut creds = default_creds();
        creds.gcp_service_account_email = Some("sa@project.iam.gserviceaccount.com".to_string());
        let msg = get_metastore_owner_info("admin@company.com", &creds);
        assert!(msg.contains("Service account 'sa@project.iam.gserviceaccount.com'"));
    }

    #[test]
    fn owner_info_gcp_credentials_json() {
        let mut creds = default_creds();
        creds.gcp_credentials_json = Some(
            r#"{"client_email": "sa@proj.iam.gserviceaccount.com", "private_key": "key"}"#.to_string(),
        );
        let msg = get_metastore_owner_info("admin@company.com", &creds);
        assert!(msg.contains("Service account 'sa@proj.iam.gserviceaccount.com'"));
    }

    #[test]
    fn owner_info_fallback_identity() {
        let msg = get_metastore_owner_info("admins", &default_creds());
        assert!(msg.contains("Your Databricks user or service principal"));
    }
}

