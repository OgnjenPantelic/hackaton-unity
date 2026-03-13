//! GCP authentication, permission checking, and service account management commands.

use super::debug_log;
use super::{http_client, is_valid_uuid, CLI_LOGIN_PROCESS};
#[cfg(debug_assertions)]
use super::mask_sensitive_id;
use super::{CloudCredentials, CloudPermissionCheck};
use crate::dependencies;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct GcpProject {
    pub project_id: String,
    pub name: String,
    pub state: String,
}

/// Required GCP permissions for Databricks workspace deployment.
/// From: <https://docs.databricks.com/gcp/en/admin/cloud-configurations/gcp/permissions>
const GCP_DATABRICKS_PERMISSIONS: &[&str] = &[
    // IAM permissions
    "iam.roles.create",
    "iam.roles.delete",
    "iam.roles.get",
    "iam.roles.update",
    "iam.serviceAccounts.create",
    "iam.serviceAccounts.get",
    "iam.serviceAccounts.getIamPolicy",
    "iam.serviceAccounts.setIamPolicy",
    "iam.serviceAccounts.getOpenIdToken",
    // Resource Manager permissions
    "resourcemanager.projects.get",
    "resourcemanager.projects.getIamPolicy",
    "resourcemanager.projects.setIamPolicy",
    // Service Usage permissions
    "serviceusage.services.get",
    "serviceusage.services.list",
    "serviceusage.services.enable",
    // Compute permissions
    "compute.networks.create",
    "compute.networks.delete",
    "compute.networks.get",
    "compute.networks.updatePolicy",
    "compute.subnetworks.create",
    "compute.subnetworks.delete",
    "compute.subnetworks.get",
    "compute.subnetworks.getIamPolicy",
    "compute.subnetworks.setIamPolicy",
    "compute.routers.create",
    "compute.routers.delete",
    "compute.routers.get",
    "compute.routers.update",
    "compute.projects.get",
    "compute.firewalls.create",
    "compute.firewalls.delete",
    "compute.firewalls.get",
    "compute.firewalls.list",
    // Storage permissions
    "storage.buckets.create",
    "storage.buckets.delete",
    "storage.buckets.get",
    "storage.buckets.getIamPolicy",
    "storage.buckets.setIamPolicy",
    "storage.buckets.update",
    "storage.objects.create",
    "storage.objects.delete",
    "storage.objects.get",
    "storage.objects.list",
];

/// Custom IAM role name created for the deployer SA.
const GCP_CUSTOM_ROLE_NAME: &str = "DatabricksWorkspaceDeployer";

/// GCP credentials validation result.
#[derive(Debug, Serialize, Deserialize)]
pub struct GcpValidation {
    pub valid: bool,
    pub project_id: Option<String>,
    pub account: Option<String>,
    pub message: String,
    pub oauth_token: Option<String>,
    pub impersonated_account: Option<String>,
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Create a skipped permission check result with a reason message.
fn skip_gcp_permission_check(reason: &str) -> CloudPermissionCheck {
    CloudPermissionCheck {
        has_all_permissions: true,
        checked_permissions: vec![],
        missing_permissions: vec![],
        message: format!("{}. Permission check skipped.", reason),
        is_warning: true,
    }
}

/// Generate an OAuth access token from a service account JSON key (no gcloud needed).
async fn generate_gcp_token_from_json_key(sa_json: &str) -> Result<String, String> {
    use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};

    let sa_creds: serde_json::Value =
        serde_json::from_str(sa_json).map_err(|e| format!("Invalid service account JSON: {}", e))?;

    let client_email = sa_creds["client_email"]
        .as_str()
        .ok_or("Missing client_email in service account JSON")?;
    let private_key = sa_creds["private_key"]
        .as_str()
        .ok_or("Missing private_key in service account JSON")?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "System clock error".to_string())?
        .as_secs();

    #[derive(Serialize)]
    struct AccessTokenClaims {
        iss: String,
        scope: String,
        aud: String,
        iat: u64,
        exp: u64,
    }

    let claims = AccessTokenClaims {
        iss: client_email.to_string(),
        scope: "https://www.googleapis.com/auth/cloud-platform".to_string(),
        aud: "https://oauth2.googleapis.com/token".to_string(),
        iat: now,
        exp: now + 3600,
    };

    let header = Header::new(Algorithm::RS256);
    let encoding_key = EncodingKey::from_rsa_pem(private_key.as_bytes())
        .map_err(|e| format!("Invalid private key in service account JSON: {}", e))?;

    let assertion = encode(&header, &claims, &encoding_key)
        .map_err(|e| format!("Failed to create JWT assertion: {}", e))?;

    let client = http_client()?;
    let token_response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", &assertion),
        ])
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    if !token_response.status().is_success() {
        let error_text = token_response.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed: {}", error_text));
    }

    let token_json: serde_json::Value = token_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    token_json["access_token"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No access_token in response".to_string())
}

/// Get GCP OAuth token using multiple fallback methods.
/// Priority: 1) Existing token in credentials, 2) Generate from JSON key, 3) gcloud CLI.
async fn get_gcp_oauth_token(
    credentials: &CloudCredentials,
) -> Result<(String, Option<String>), String> {
    // Method 1: Use existing OAuth token from credentials
    if let Some(token) = credentials.gcp_oauth_token.as_ref().filter(|s| !s.is_empty()) {
        debug_log!("[check_gcp_permissions] Using existing OAuth token from credentials");
        let sa_email = credentials.gcp_service_account_email.clone();
        return Ok((token.clone(), sa_email));
    }

    // Method 2: Generate token from JSON key
    if let Some(sa_json) = credentials
        .gcp_credentials_json
        .as_ref()
        .filter(|s| !s.is_empty())
    {
        debug_log!("[check_gcp_permissions] Generating token from service account JSON key");
        match generate_gcp_token_from_json_key(sa_json).await {
            Ok(token) => {
                let sa_email = serde_json::from_str::<serde_json::Value>(sa_json)
                    .ok()
                    .and_then(|v| v["client_email"].as_str().map(|s| s.to_string()));
                return Ok((token, sa_email));
            }
            Err(_e) => {
                debug_log!("[check_gcp_permissions] Failed to generate token from JSON: {}", _e);
            }
        }
    }

    // Method 3: Fall back to gcloud CLI
    let gcloud_cli = dependencies::find_gcloud_cli_path()
        .ok_or("No OAuth token available and gcloud CLI not installed.")?;

    debug_log!("[check_gcp_permissions] Falling back to gcloud CLI for token");

    let impersonate_output = super::silent_cmd(&gcloud_cli)
        .args(["config", "get-value", "auth/impersonate_service_account"])
        .output()
        .ok();

    let impersonated_account = impersonate_output
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty() && s != "(unset)");

    let token_output = if let Some(ref sa_email) = impersonated_account {
        super::silent_cmd(&gcloud_cli)
            .args([
                "auth",
                "print-access-token",
                "--impersonate-service-account",
                sa_email,
            ])
            .output()
            .map_err(|e| format!("Failed to get impersonated token: {}", e))?
    } else {
        super::silent_cmd(&gcloud_cli)
            .args(["auth", "print-access-token"])
            .output()
            .map_err(|e| format!("Failed to get access token: {}", e))?
    };

    if !token_output.status.success() {
        return Err("Failed to get access token from gcloud CLI".to_string());
    }

    let token = String::from_utf8_lossy(&token_output.stdout)
        .trim()
        .to_string();
    Ok((token, impersonated_account))
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

/// Validate GCP credentials using gcloud CLI (ADC or service account JSON).
#[tauri::command]
pub async fn validate_gcp_credentials(
    credentials: CloudCredentials,
) -> Result<GcpValidation, String> {
    let gcloud_cli = dependencies::find_gcloud_cli_path()
        .ok_or_else(|| crate::errors::cli_not_found("Google Cloud CLI"))?;

    let use_adc = credentials.gcp_use_adc.unwrap_or(true);

    if use_adc {
        // Check for service account impersonation
        let mut impersonate_cmd = super::silent_cmd(&gcloud_cli);
        impersonate_cmd.args(["config", "get-value", "auth/impersonate_service_account"]);

        let impersonate_output = impersonate_cmd
            .output()
            .map_err(|e| format!("Failed to check impersonated account: {}", e))?;

        let impersonated_account = if impersonate_output.status.success() {
            let acc = String::from_utf8_lossy(&impersonate_output.stdout)
                .trim()
                .to_string();
            if acc.is_empty() || acc == "(unset)" {
                None
            } else {
                Some(acc)
            }
        } else {
            None
        };

        // Get OAuth access token (handle impersonation correctly)
        let oauth_token = if impersonated_account.is_some() {
            // Temporarily unset impersonation to get the user's actual token
            let _ = super::silent_cmd(&gcloud_cli)
                .args(["config", "unset", "auth/impersonate_service_account"])
                .output();

            let mut token_cmd = super::silent_cmd(&gcloud_cli);
            token_cmd.args(["auth", "print-access-token"]);

            let token_output = token_cmd
                .output()
                .map_err(|e| format!("Failed to run gcloud: {}", e))?;

            // Restore impersonation immediately
            if let Some(ref sa) = impersonated_account {
                let _ = super::silent_cmd(&gcloud_cli)
                    .args(["config", "set", "auth/impersonate_service_account", sa])
                    .output();
            }

            if !token_output.status.success() {
                let stderr = String::from_utf8_lossy(&token_output.stderr);
                return Ok(GcpValidation {
                    valid: false,
                    project_id: None,
                    account: None,
                    message: format!(
                        "No GCP credentials found. Please run 'gcloud auth login' first. Error: {}",
                        stderr.trim()
                    ),
                    oauth_token: None,
                    impersonated_account: None,
                });
            }

            String::from_utf8_lossy(&token_output.stdout)
                .trim()
                .to_string()
        } else {
            let mut token_cmd = super::silent_cmd(&gcloud_cli);
            token_cmd.args(["auth", "print-access-token"]);

            let token_output = token_cmd
                .output()
                .map_err(|e| format!("Failed to run gcloud: {}", e))?;

            if !token_output.status.success() {
                let stderr = String::from_utf8_lossy(&token_output.stderr);
                return Ok(GcpValidation {
                    valid: false,
                    project_id: None,
                    account: None,
                    message: format!(
                        "No GCP credentials found. Please run 'gcloud auth login' first. Error: {}",
                        stderr.trim()
                    ),
                    oauth_token: None,
                    impersonated_account: None,
                });
            }

            String::from_utf8_lossy(&token_output.stdout)
                .trim()
                .to_string()
        };

        // Get current account
        let mut account_cmd = super::silent_cmd(&gcloud_cli);
        account_cmd.args(["config", "get-value", "account"]);

        let account_output = account_cmd
            .output()
            .map_err(|e| format!("Failed to get account: {}", e))?;

        let account = if account_output.status.success() {
            let acc = String::from_utf8_lossy(&account_output.stdout)
                .trim()
                .to_string();
            if acc.is_empty() {
                None
            } else {
                Some(acc)
            }
        } else {
            None
        };

        // Get default project
        let mut project_cmd = super::silent_cmd(&gcloud_cli);
        project_cmd.args(["config", "get-value", "project"]);

        let project_output = project_cmd
            .output()
            .map_err(|e| format!("Failed to get project: {}", e))?;

        let project_id = if project_output.status.success() {
            let proj = String::from_utf8_lossy(&project_output.stdout)
                .trim()
                .to_string();
            if proj.is_empty() {
                None
            } else {
                Some(proj)
            }
        } else {
            None
        };

        let final_project_id = credentials.gcp_project_id.clone().or(project_id);

        // Validate project exists
        if let Some(proj_id) = credentials.gcp_project_id.as_ref().filter(|s| !s.is_empty()) {
            if impersonated_account.is_some() {
                let _ = super::silent_cmd(&gcloud_cli)
                    .args(["config", "unset", "auth/impersonate_service_account"])
                    .output();
            }

            let mut describe_cmd = super::silent_cmd(&gcloud_cli);
            describe_cmd.args([
                "projects",
                "describe",
                proj_id,
                "--format=value(projectId)",
            ]);

            let describe_output = describe_cmd
                .output()
                .map_err(|e| format!("Failed to validate project: {}", e))?;

            if let Some(ref sa) = impersonated_account {
                let _ = super::silent_cmd(&gcloud_cli)
                    .args(["config", "set", "auth/impersonate_service_account", sa])
                    .output();
            }

            if !describe_output.status.success() {
                let stderr = String::from_utf8_lossy(&describe_output.stderr);

                let error_msg = if stderr.contains("NOT_FOUND") || stderr.contains("not exist") {
                    format!(
                        "GCP project '{}' does not exist. Please check the project ID.",
                        proj_id
                    )
                } else if stderr.contains("permission") {
                    format!(
                        "You don't have access to GCP project '{}'. Please check you have at least Viewer access.",
                        proj_id
                    )
                } else {
                    format!(
                        "Cannot access GCP project '{}'. Please verify the project ID is correct.",
                        proj_id
                    )
                };

                return Ok(GcpValidation {
                    valid: false,
                    project_id: final_project_id.clone(),
                    account,
                    message: error_msg,
                    oauth_token: Some(oauth_token),
                    impersonated_account,
                });
            }
        }

        let message = if let Some(ref sa) = impersonated_account {
            format!("Authenticated with service account impersonation: {}", sa)
        } else {
            "GCP credentials validated successfully.".to_string()
        };

        Ok(GcpValidation {
            valid: true,
            project_id: final_project_id,
            account,
            message,
            oauth_token: Some(oauth_token),
            impersonated_account,
        })
    } else {
        // Validate service account JSON
        let sa_json = credentials
            .gcp_credentials_json
            .as_ref()
            .filter(|s| !s.is_empty())
            .ok_or("Service account JSON is required")?;

        let sa_data: serde_json::Value =
            serde_json::from_str(sa_json).map_err(|e| format!("Invalid service account JSON: {}", e))?;

        let sa_type = sa_data["type"].as_str().unwrap_or("");
        if sa_type != "service_account" {
            return Ok(GcpValidation {
                valid: false,
                project_id: None,
                account: None,
                message: format!(
                    "Invalid credential type: '{}'. Expected 'service_account'.",
                    sa_type
                ),
                oauth_token: None,
                impersonated_account: None,
            });
        }

        let project_id = sa_data["project_id"].as_str().map(|s| s.to_string());
        let client_email = sa_data["client_email"].as_str().map(|s| s.to_string());

        if project_id.is_none() || client_email.is_none() {
            return Ok(GcpValidation {
                valid: false,
                project_id: None,
                account: None,
                message: "Service account JSON is missing 'project_id' or 'client_email' fields."
                    .to_string(),
                oauth_token: None,
                impersonated_account: None,
            });
        }

        Ok(GcpValidation {
            valid: true,
            project_id: credentials.gcp_project_id.clone().or(project_id),
            account: client_email.clone(),
            message: "Service account credentials validated.".to_string(),
            oauth_token: None,
            impersonated_account: client_email,
        })
    }
}

/// List GCP projects accessible to the current authenticated user.
#[tauri::command]
pub fn get_gcp_projects() -> Result<Vec<GcpProject>, String> {
    let gcloud_cli = dependencies::find_gcloud_cli_path()
        .ok_or_else(|| crate::errors::cli_not_found("Google Cloud CLI"))?;

    let output = super::silent_cmd(&gcloud_cli)
        .args(["projects", "list", "--format=json", "--sort-by=name"])
        .output()
        .map_err(|e| format!("Failed to list GCP projects: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gcloud error: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: Vec<serde_json::Value> =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse response: {}", e))?;

    let projects: Vec<GcpProject> = json
        .iter()
        .filter(|p| p["lifecycleState"].as_str() == Some("ACTIVE"))
        .map(|p| GcpProject {
            project_id: p["projectId"].as_str().unwrap_or("").to_string(),
            name: p["name"].as_str().unwrap_or("").to_string(),
            state: p["lifecycleState"].as_str().unwrap_or("").to_string(),
        })
        .collect();

    Ok(projects)
}

/// Trigger interactive GCP login with a 5-minute timeout.
/// Supports cancellation via `cancel_cli_login`.
#[tauri::command]
pub async fn gcp_login() -> Result<String, String> {
    use std::time::{Duration, Instant};

    let gcloud_cli = dependencies::find_gcloud_cli_path()
        .ok_or_else(|| crate::errors::cli_not_found("Google Cloud CLI"))?;

    let mut child = super::silent_cmd(&gcloud_cli)
        .args(["auth", "login"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run Google Cloud CLI: {}", e))?;

    super::acquire_login_slot(child.id()).map_err(|e| {
        let _ = child.kill();
        e
    })?;

    let timeout = Duration::from_secs(300);
    let start = Instant::now();

    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|e| format!("Failed to read output: {}", e))?;
                if !status.success() {
                    let was_cancelled = super::lock_or_recover(&CLI_LOGIN_PROCESS).is_none();
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
                    break Err(format!("GCP login failed: {}", stderr_str));
                }
                break Ok("GCP login completed successfully.".to_string());
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    break Err("GCP login timed out after 5 minutes. Please try again.".to_string());
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            Err(e) => break Err(format!("Error waiting for gcloud: {}", e)),
        }
    };

    super::release_login_slot();

    result
}

/// Validate GCP Databricks account access.
#[tauri::command]
pub async fn validate_gcp_databricks_access(
    account_id: String,
    oauth_token: String,
    service_account_email: Option<String>,
) -> Result<String, String> {
    if account_id.is_empty() {
        return Err("Databricks Account ID is required".to_string());
    }

    if !is_valid_uuid(&account_id.to_lowercase()) {
        return Err(format!(
            "Invalid Account ID format: '{}'\n\nExpected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\n\nFind your Account ID at accounts.gcp.databricks.com (click your profile icon).",
            account_id
        ));
    }

    if oauth_token.is_empty() {
        return Err(
            "OAuth token is required. Please verify your GCP credentials first.".to_string(),
        );
    }

    if oauth_token.len() < 50 {
        return Err(
            "OAuth token appears invalid. Please go back and verify your GCP credentials."
                .to_string(),
        );
    }

    let sa_email = service_account_email.filter(|s| !s.is_empty());

    if let Some(ref email) = sa_email {
        debug_log!(
            "[validate_gcp_databricks_access] Validating access for SA: {}",
            mask_sensitive_id(email)
        );

        let client = http_client()?;
        let generate_token_url = format!(
            "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{}:generateIdToken",
            email
        );

        let token_response = client
            .post(&generate_token_url)
            .bearer_auth(&oauth_token)
            .json(&serde_json::json!({
                "audience": "https://accounts.gcp.databricks.com",
                "includeEmail": true
            }))
            .send()
            .await;

        if let Ok(resp) = token_response {
            if resp.status().is_success() {
                if let Ok(token_json) = resp.json::<serde_json::Value>().await {
                    if let Some(id_token) = token_json["token"].as_str() {
                        let metastores_url = format!(
                            "https://accounts.gcp.databricks.com/api/2.0/accounts/{}/metastores",
                            account_id
                        );

                        debug_log!(
                            "[validate_gcp_databricks_access] Calling Databricks API to verify access"
                        );

                        let db_response = client
                            .get(&metastores_url)
                            .bearer_auth(id_token)
                            .send()
                            .await;

                        if let Ok(db_resp) = db_response {
                            let status = db_resp.status();
                            debug_log!(
                                "[validate_gcp_databricks_access] Databricks API status: {}",
                                status
                            );

                            if status.as_u16() == 403 {
                                return Err(format!(
                                    "Service account not authorized in Databricks.\n\n\
                                    The service account '{}' has not been added to the Databricks Account Console.\n\n\
                                    Please add it:\n\
                                    1. Go to accounts.gcp.databricks.com\n\
                                    2. Navigate to User management → Users\n\
                                    3. Click 'Add user' and enter: {}\n\
                                    4. Grant the 'Account admin' role",
                                    email, email
                                ));
                            } else if status.as_u16() == 401 {
                                return Err("Authentication failed. Please verify your GCP credentials and try again.".to_string());
                            } else if !status.is_success() {
                                let error_body = db_resp.text().await.unwrap_or_default();
                                return Err(format!(
                                    "Databricks API error ({}): {}",
                                    status, error_body
                                ));
                            }

                            return Ok(format!(
                                "Databricks access verified for service account: {}",
                                email
                            ));
                        }
                    }
                }
            } else {
                let status = resp.status();
                if status.as_u16() == 403 {
                    return Err(format!(
                        "Cannot generate ID token for service account.\n\n\
                        The service account '{}' may not have the 'Service Account Token Creator' role on itself.\n\n\
                        Run this command to fix:\n\
                        gcloud iam service-accounts add-iam-policy-binding {} \\\n  \
                        --member='serviceAccount:{}' \\\n  \
                        --role='roles/iam.serviceAccountTokenCreator'",
                        email, email, email
                    ));
                }
            }
        }
    }

    Ok("Configuration validated. Full Databricks access will be verified during deployment."
        .to_string())
}

/// Validate GCP Databricks account access using a service account JSON key (no CLI needed).
#[tauri::command]
pub async fn validate_gcp_databricks_access_with_key(
    account_id: String,
    sa_json: String,
) -> Result<String, String> {
    if account_id.is_empty() {
        return Err("Databricks Account ID is required".to_string());
    }

    if !is_valid_uuid(&account_id.to_lowercase()) {
        return Err(format!(
            "Invalid Account ID format: '{}'\n\nExpected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\n\nFind your Account ID at accounts.gcp.databricks.com (click your profile icon).",
            account_id
        ));
    }

    if sa_json.is_empty() {
        return Err("Service account JSON key is required".to_string());
    }

    // Generate OAuth token from SA JSON key
    let oauth_token = generate_gcp_token_from_json_key(&sa_json).await?;

    // Extract SA email from JSON
    let sa_creds: serde_json::Value = serde_json::from_str(&sa_json)
        .map_err(|e| format!("Invalid service account JSON: {}", e))?;
    let sa_email = sa_creds["client_email"]
        .as_str()
        .ok_or("Missing client_email in service account JSON")?
        .to_string();

    // Generate ID token for Databricks
    let client = http_client()?;
    let generate_token_url = format!(
        "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{}:generateIdToken",
        sa_email
    );

    let token_response = client
        .post(&generate_token_url)
        .bearer_auth(&oauth_token)
        .json(&serde_json::json!({
            "audience": "https://accounts.gcp.databricks.com",
            "includeEmail": true
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to generate ID token: {}", e))?;

    if !token_response.status().is_success() {
        let status = token_response.status();
        if status.as_u16() == 403 {
            return Err(format!(
                "Cannot generate ID token for service account '{}'.\n\n\
                Ensure the service account has the 'Service Account Token Creator' role on itself.",
                sa_email
            ));
        }
        let error_text = token_response.text().await.unwrap_or_default();
        return Err(format!("ID token generation failed ({}): {}", status, error_text));
    }

    let token_json: serde_json::Value = token_response
        .json()
        .await
        .map_err(|_| "Failed to parse ID token response".to_string())?;

    let id_token = token_json["token"]
        .as_str()
        .ok_or("No token in ID token response")?;

    // Verify Databricks account access
    let metastores_url = format!(
        "https://accounts.gcp.databricks.com/api/2.0/accounts/{}/metastores",
        account_id
    );

    let db_response = client
        .get(&metastores_url)
        .bearer_auth(id_token)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Databricks: {}", e))?;

    let status = db_response.status();
    if status.as_u16() == 403 {
        return Err(format!(
            "Service account not authorized in Databricks.\n\n\
            The service account '{}' has not been added to the Databricks Account Console.\n\n\
            Please add it:\n\
            1. Go to accounts.gcp.databricks.com\n\
            2. Navigate to User management → Users\n\
            3. Click 'Add user' and enter: {}\n\
            4. Grant the 'Account admin' role",
            sa_email, sa_email
        ));
    } else if status.as_u16() == 401 {
        return Err("Authentication failed. The service account key may be invalid or expired.".to_string());
    } else if !status.is_success() {
        let error_body = db_response.text().await.unwrap_or_default();
        return Err(format!("Databricks API error ({}): {}", status, error_body));
    }

    Ok(format!(
        "Databricks access verified for service account: {}",
        sa_email
    ))
}

/// Check GCP IAM permissions using the Cloud Resource Manager `testIamPermissions` API.
#[tauri::command]
pub async fn check_gcp_permissions(
    credentials: CloudCredentials,
) -> Result<CloudPermissionCheck, String> {
    let required_permissions = vec![
        "compute.networks.create",
        "compute.subnetworks.create",
        "compute.firewalls.create",
        "compute.firewalls.list",
        "storage.buckets.create",
        "iam.serviceAccounts.create",
        "iam.serviceAccounts.setIamPolicy",
    ];

    let project_id = if let Some(proj) = credentials.gcp_project_id.as_ref().filter(|s| !s.is_empty()) {
        proj.clone()
    } else {
        if let Some(gcloud_cli) = dependencies::find_gcloud_cli_path() {
            let config_output = super::silent_cmd(&gcloud_cli)
                .args(["config", "get-value", "project"])
                .output()
                .ok();

            config_output
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|p| !p.is_empty() && p != "(unset)")
                .unwrap_or_default()
        } else {
            String::new()
        }
    };

    if project_id.is_empty() {
        return Ok(skip_gcp_permission_check("No GCP project ID available"));
    }

    let (token, service_account) = match get_gcp_oauth_token(&credentials).await {
        Ok(result) => result,
        Err(e) => {
            debug_log!("[check_gcp_permissions] Failed to get token: {}", e);
            return Ok(skip_gcp_permission_check(&format!(
                "Could not obtain OAuth token: {}",
                e
            )));
        }
    };

    let api_url = format!(
        "https://cloudresourcemanager.googleapis.com/v1/projects/{}:testIamPermissions",
        project_id
    );

    let client = http_client()?;
    let api_response = client
        .post(&api_url)
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "permissions": required_permissions
        }))
        .send()
        .await;

    let api_response = match api_response {
        Ok(resp) => resp,
        Err(e) => {
            debug_log!("[check_gcp_permissions] API request failed: {}", e);
            return Ok(skip_gcp_permission_check(&format!(
                "API request failed: {}",
                e
            )));
        }
    };

    let json_value: serde_json::Value = match api_response.json().await {
        Ok(v) => v,
        Err(_) => {
            return Ok(skip_gcp_permission_check(
                "Could not parse permission check response",
            ));
        }
    };

    let _has_error = json_value.get("error").is_some();
    let _granted_count = json_value
        .get("permissions")
        .and_then(|p| p.as_array())
        .map(|arr| arr.len())
        .unwrap_or(0);
    debug_log!(
        "[check_gcp_permissions] API response: {} permissions granted, error: {}",
        _granted_count,
        _has_error
    );

    if let Some(error) = json_value.get("error") {
        let error_msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown API error");
        return Ok(skip_gcp_permission_check(&format!(
            "API error: {}",
            error_msg
        )));
    }

    let granted_permissions: Vec<String> = json_value
        .get("permissions")
        .and_then(|p| p.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let checked_permissions: Vec<String> =
        required_permissions.iter().map(|s| s.to_string()).collect();

    let missing_permissions: Vec<String> = required_permissions
        .iter()
        .filter(|p| !granted_permissions.contains(&p.to_string()))
        .map(|s| s.to_string())
        .collect();

    let has_all = missing_permissions.is_empty();

    let message = if has_all {
        if let Some(ref sa) = service_account {
            format!(
                "All required GCP permissions verified for service account: {}",
                sa
            )
        } else {
            "All required GCP permissions verified.".to_string()
        }
    } else {
        let fix_cmd = format!(
            "gcloud iam roles update DatabricksWorkspaceDeployer \\\n  --project={} \\\n  --add-permissions={}",
            project_id,
            missing_permissions.join(",")
        );
        format!(
            "Missing {} permission(s): {}\n\nRun this command to fix:\n{}",
            missing_permissions.len(),
            missing_permissions.join(", "),
            fix_cmd
        )
    };

    Ok(CloudPermissionCheck {
        has_all_permissions: has_all,
        checked_permissions,
        missing_permissions,
        message,
        is_warning: !has_all,
    })
}

/// Create a GCP service account for Databricks deployment.
///
/// Creates the SA, creates a custom role with minimal required permissions,
/// grants that role to the SA, grants Token Creator to user, and configures impersonation.
#[tauri::command]
pub async fn create_gcp_service_account(
    project_id: String,
    sa_name: String,
) -> Result<String, String> {
    let gcloud_cli = dependencies::find_gcloud_cli_path()
        .ok_or_else(|| crate::errors::cli_not_found("Google Cloud CLI"))?;

    if project_id.is_empty() {
        return Err("Project ID is required".to_string());
    }
    if sa_name.is_empty() {
        return Err("Service account name is required".to_string());
    }

    if !sa_name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(
            "Service account name can only contain lowercase letters, digits, and hyphens"
                .to_string(),
        );
    }
    if sa_name.len() < 6 || sa_name.len() > 30 {
        return Err("Service account name must be between 6 and 30 characters".to_string());
    }

    // Step 0: Get current user's email
    let user_output = super::silent_cmd(&gcloud_cli)
        .args(["config", "get-value", "account"])
        .output()
        .map_err(|e| format!("Failed to get current user: {}", e))?;

    let user_email = String::from_utf8_lossy(&user_output.stdout)
        .trim()
        .to_string();
    if user_email.is_empty() {
        return Err(
            "No authenticated user found. Please run 'gcloud auth login' first.".to_string(),
        );
    }

    let sa_email = format!("{}@{}.iam.gserviceaccount.com", sa_name, project_id);

    // Step 1: Create service account
    let create_output = super::silent_cmd(&gcloud_cli)
        .args([
            "iam",
            "service-accounts",
            "create",
            &sa_name,
            "--display-name",
            "Databricks Deployer",
            "--description",
            "Service account for Databricks workspace deployment",
            "--project",
            &project_id,
        ])
        .output()
        .map_err(|e| format!("Failed to run gcloud: {}", e))?;

    if !create_output.status.success() {
        let stderr = String::from_utf8_lossy(&create_output.stderr);
        if !stderr.contains("already exists") {
            return Err(format!(
                "Failed to create service account: {}",
                stderr.trim()
            ));
        }
    }

    // Step 2a: Create custom role
    let permissions_str = GCP_DATABRICKS_PERMISSIONS.join(",");

    let create_role_output = super::silent_cmd(&gcloud_cli)
        .args([
            "iam",
            "roles",
            "create",
            GCP_CUSTOM_ROLE_NAME,
            "--project",
            &project_id,
            "--title",
            "Databricks Workspace Deployer",
            "--description",
            "Minimal permissions for Databricks workspace deployment",
            "--permissions",
            &permissions_str,
        ])
        .output()
        .map_err(|e| format!("Failed to create custom role: {}", e))?;

    if !create_role_output.status.success() {
        let stderr = String::from_utf8_lossy(&create_role_output.stderr);
        if !stderr.contains("already exists") {
            if stderr.contains("PERMISSION_DENIED") || stderr.contains("permission") {
                return Err(format!(
                    "Cannot create custom role. Your account lacks 'iam.roles.create' permission.\n\n\
                    Please ask your GCP admin to grant the following permissions to service account '{}':\n\n\
                    {}\n\n\
                    See: https://docs.databricks.com/gcp/en/admin/cloud-configurations/gcp/permissions",
                    sa_email,
                    GCP_DATABRICKS_PERMISSIONS.join("\n")
                ));
            }
            return Err(format!(
                "Failed to create custom role: {}",
                stderr.trim()
            ));
        }
    }

    // Step 2b: Grant custom role to the SA
    let custom_role_path = format!("projects/{}/roles/{}", project_id, GCP_CUSTOM_ROLE_NAME);

    let grant_output = super::silent_cmd(&gcloud_cli)
        .args([
            "projects",
            "add-iam-policy-binding",
            &project_id,
            "--member",
            &format!("serviceAccount:{}", sa_email),
            "--role",
            &custom_role_path,
            "--condition",
            "None",
        ])
        .output()
        .map_err(|e| format!("Failed to grant custom role: {}", e))?;

    if !grant_output.status.success() {
        let stderr = String::from_utf8_lossy(&grant_output.stderr);
        return Err(format!(
            "Failed to grant custom role to service account: {}",
            stderr.trim()
        ));
    }

    // Step 3: Grant Service Account Token Creator role to user
    let token_creator_output = super::silent_cmd(&gcloud_cli)
        .args([
            "iam",
            "service-accounts",
            "add-iam-policy-binding",
            &sa_email,
            "--member",
            &format!("user:{}", user_email),
            "--role",
            "roles/iam.serviceAccountTokenCreator",
            "--project",
            &project_id,
        ])
        .output()
        .map_err(|e| format!("Failed to grant Token Creator role: {}", e))?;

    if !token_creator_output.status.success() {
        let stderr = String::from_utf8_lossy(&token_creator_output.stderr);
        return Err(format!(
            "Failed to grant Token Creator role: {}",
            stderr.trim()
        ));
    }

    // Step 3b: Grant SA the Token Creator role on itself
    let sa_self_token_creator = super::silent_cmd(&gcloud_cli)
        .args([
            "iam",
            "service-accounts",
            "add-iam-policy-binding",
            &sa_email,
            "--member",
            &format!("serviceAccount:{}", sa_email),
            "--role",
            "roles/iam.serviceAccountTokenCreator",
            "--project",
            &project_id,
        ])
        .output()
        .map_err(|e| format!("Failed to grant SA self Token Creator role: {}", e))?;

    if !sa_self_token_creator.status.success() {
        let _stderr = String::from_utf8_lossy(&sa_self_token_creator.stderr);
        debug_log!(
            "[create_gcp_service_account] Warning: Could not grant SA self Token Creator role: {}",
            _stderr.trim()
        );
    }

    // Step 4: Configure impersonation
    let impersonate_output = super::silent_cmd(&gcloud_cli)
        .args([
            "config",
            "set",
            "auth/impersonate_service_account",
            &sa_email,
        ])
        .output()
        .map_err(|e| format!("Failed to configure impersonation: {}", e))?;

    if !impersonate_output.status.success() {
        let stderr = String::from_utf8_lossy(&impersonate_output.stderr);
        return Err(format!(
            "Failed to configure impersonation: {}",
            stderr.trim()
        ));
    }

    // Step 5: Wait for IAM propagation
    let max_attempts = 24;
    let mut attempt = 0;

    loop {
        attempt += 1;

        let token_test = super::silent_cmd(&gcloud_cli)
            .args(["auth", "print-access-token"])
            .output();

        if let Ok(output) = token_test {
            if output.status.success() {
                break;
            }
        }

        if attempt >= max_attempts {
            let _ = super::silent_cmd(&gcloud_cli)
                .args(["config", "unset", "auth/impersonate_service_account"])
                .output();

            return Err(format!(
                "Service account created, but IAM propagation timed out after 120 seconds. \
                Please wait a minute and then run: gcloud config set auth/impersonate_service_account {}",
                sa_email
            ));
        }

        std::thread::sleep(std::time::Duration::from_secs(5));
    }

    Ok(sa_email)
}

/// Add a GCP service account to Databricks Account Console with Account Admin role.
#[tauri::command]
pub async fn add_service_account_to_databricks(
    account_id: String,
    service_account_email: String,
) -> Result<String, String> {
    let accounts_host = "accounts.gcp.databricks.com";
    let client = http_client()?;

    if account_id.is_empty() {
        return Err("Databricks Account ID is required".to_string());
    }
    if service_account_email.is_empty() {
        return Err("Service account email is required".to_string());
    }

    let gcloud_cli = dependencies::find_gcloud_cli_path()
        .ok_or_else(|| crate::errors::cli_not_found("Google Cloud CLI"))?;

    let user_output = super::silent_cmd(&gcloud_cli)
        .args(["config", "get-value", "account"])
        .output()
        .map_err(|e| format!("Failed to get current user: {}", e))?;

    let user_email = String::from_utf8_lossy(&user_output.stdout)
        .trim()
        .to_string();
    if user_email.is_empty() {
        return Err(
            "No authenticated user found. Please run 'gcloud auth login' first.".to_string(),
        );
    }

    // Check if impersonation is currently configured
    let impersonate_check = super::silent_cmd(&gcloud_cli)
        .args(["config", "get-value", "auth/impersonate_service_account"])
        .output()
        .ok();

    let current_impersonation = impersonate_check.and_then(|o| {
        if o.status.success() {
            let val = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if val.is_empty() || val == "(unset)" {
                None
            } else {
                Some(val)
            }
        } else {
            None
        }
    });

    // Temporarily disable impersonation
    if current_impersonation.is_some() {
        let _ = super::silent_cmd(&gcloud_cli)
            .args(["config", "unset", "auth/impersonate_service_account"])
            .output();
    }

    // Get a fresh OAuth token for the USER
    let token_output = super::silent_cmd(&gcloud_cli)
        .args(["auth", "print-access-token"])
        .output()
        .map_err(|e| format!("Failed to get OAuth token: {}", e))?;

    // Restore impersonation
    if let Some(ref sa_email) = current_impersonation {
        let _ = super::silent_cmd(&gcloud_cli)
            .args([
                "config",
                "set",
                "auth/impersonate_service_account",
                sa_email,
            ])
            .output();
    }

    if !token_output.status.success() {
        let stderr = String::from_utf8_lossy(&token_output.stderr);
        return Err(format!(
            "Failed to get OAuth token for {}. Make sure you're logged in with 'gcloud auth login'. Error: {}",
            user_email,
            stderr.trim()
        ));
    }

    let oauth_token = String::from_utf8_lossy(&token_output.stdout)
        .trim()
        .to_string();

    // Step 1: Create user via SCIM API
    let create_user_url = format!(
        "https://{}/api/2.0/accounts/{}/scim/v2/Users",
        accounts_host, account_id
    );

    let create_user_body = serde_json::json!({
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        "userName": service_account_email,
        "displayName": service_account_email.split('@').next().unwrap_or(&service_account_email),
        "active": true
    });

    let create_response = client
        .post(&create_user_url)
        .bearer_auth(&oauth_token)
        .header("Content-Type", "application/scim+json")
        .json(&create_user_body)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Databricks: {}", e))?;

    let create_status = create_response.status();
    let create_text = create_response.text().await.unwrap_or_default();

    let user_id: String;

    if create_status.is_success() {
        let create_json: serde_json::Value = serde_json::from_str(&create_text)
            .map_err(|e| format!("Failed to parse create response: {}", e))?;
        user_id = create_json["id"]
            .as_str()
            .ok_or("No user ID in create response")?
            .to_string();
    } else if create_status == reqwest::StatusCode::CONFLICT {
        let list_url = format!(
            "https://{}/api/2.0/accounts/{}/scim/v2/Users?filter=userName eq \"{}\"",
            accounts_host, account_id, service_account_email
        );

        let list_response = client
            .get(&list_url)
            .bearer_auth(&oauth_token)
            .send()
            .await
            .map_err(|e| format!("Failed to find existing user: {}", e))?;

        if !list_response.status().is_success() {
            return Err(format!(
                "Failed to find existing user: {}",
                list_response.status()
            ));
        }

        let list_json: serde_json::Value = list_response
            .json()
            .await
            .map_err(|e| format!("Failed to parse list response: {}", e))?;

        let resources = list_json["Resources"]
            .as_array()
            .ok_or("No Resources in list response")?;

        if resources.is_empty() {
            return Err("User not found after conflict response".to_string());
        }

        user_id = resources[0]["id"]
            .as_str()
            .ok_or("No user ID in list response")?
            .to_string();
    } else if create_status == reqwest::StatusCode::FORBIDDEN
        || create_status == reqwest::StatusCode::UNAUTHORIZED
    {
        return Err(
            "You don't have permission to add users to Databricks. \
            Make sure you are logged in as a Databricks account admin."
                .to_string(),
        );
    } else {
        return Err(format!(
            "Failed to create user ({}): {}",
            create_status, create_text
        ));
    }

    // Step 2: Grant Account Admin role
    let update_url = format!(
        "https://{}/api/2.0/accounts/{}/scim/v2/Users/{}",
        accounts_host, account_id, user_id
    );

    let patch_body = serde_json::json!({
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        "Operations": [
            {
                "op": "add",
                "path": "roles",
                "value": [
                    {
                        "value": "account_admin"
                    }
                ]
            }
        ]
    });

    let patch_response = client
        .patch(&update_url)
        .bearer_auth(&oauth_token)
        .header("Content-Type", "application/scim+json")
        .json(&patch_body)
        .send()
        .await
        .map_err(|e| format!("Failed to grant admin role: {}", e))?;

    if !patch_response.status().is_success() {
        let error_text = patch_response.text().await.unwrap_or_default();
        return Err(format!(
            "Failed to grant Account Admin role: {}",
            error_text
        ));
    }

    Ok(format!(
        "Service account '{}' added to Databricks with Account Admin role",
        service_account_email
    ))
}
