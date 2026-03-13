//! Terraform deployment, configuration, and lifecycle management commands.

use super::{
    copy_dir_all, debug_log, get_deployments_dir, get_templates_dir, opt_non_empty,
    sanitize_deployment_name, sanitize_template_id, CloudCredentials,
};
use crate::dependencies::{self, DependencyStatus};
use crate::terraform::{self, DeploymentStatus, CURRENT_PROCESS, DEPLOYMENT_STATUS};
use std::collections::HashMap;
use std::fs;
use tauri::AppHandle;

// ─── Helpers (deployment-local) ─────────────────────────────────────────────

/// Resolve a zip entry path safely, rejecting entries that escape `base_dir`.
fn safe_zip_entry_path(base_dir: &std::path::Path, entry_name: &str) -> Result<std::path::PathBuf, String> {
    use std::path::Component;

    let entry_path = std::path::Path::new(entry_name);
    for component in entry_path.components() {
        match component {
            Component::ParentDir => {
                return Err(format!(
                    "Zip entry contains path traversal: {}",
                    entry_name
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "Zip entry contains absolute path: {}",
                    entry_name
                ));
            }
            _ => {}
        }
    }

    let outpath = base_dir.join(entry_path);
    Ok(outpath)
}

/// Set an environment variable from an optional credential value.
fn set_env_if_present(env_vars: &mut HashMap<String, String>, key: &str, value: &Option<String>) {
    if let Some(v) = value {
        if !v.is_empty() {
            env_vars.insert(key.to_string(), v.clone());
        }
    }
}

/// Check if Databricks service principal credentials (client_id + client_secret) are present.
fn has_databricks_sp_creds(credentials: &CloudCredentials) -> bool {
    opt_non_empty(&credentials.databricks_client_id)
        && opt_non_empty(&credentials.databricks_client_secret)
}

/// Locate a Google Application Default Credentials JSON file.
///
/// The Databricks Terraform provider authenticates via Google's ADC chain
/// when `google_service_account` is set (impersonation mode). We check:
///   1. The standard ADC path (`gcloud auth application-default login`)
///   2. The legacy per-account path (`gcloud auth login`)
fn find_gcp_adc_path() -> Option<String> {
    let home = dirs::home_dir()?;

    let standard_adc = home.join(".config/gcloud/application_default_credentials.json");
    if standard_adc.exists() {
        debug_log!("[find_gcp_adc_path] found standard ADC: {:?}", standard_adc);
        return Some(standard_adc.to_string_lossy().to_string());
    }

    let gcloud = dependencies::find_gcloud_cli_path()?;
    let account = super::silent_cmd(&gcloud)
        .args(["config", "get-value", "account"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty() && s != "(unset)")?;

    let legacy_adc = home
        .join(".config/gcloud/legacy_credentials")
        .join(&account)
        .join("adc.json");
    if legacy_adc.exists() {
        debug_log!("[find_gcp_adc_path] found legacy ADC for {}: {:?}", account, legacy_adc);
        return Some(legacy_adc.to_string_lossy().to_string());
    }

    debug_log!("[find_gcp_adc_path] no ADC file found");
    None
}

/// Get a fresh GCP user OAuth token via gcloud CLI (for the Google Terraform provider).
/// Bypasses impersonation so the token belongs to the user, not the SA.
///
/// Uses the `CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT` env-var override (set to
/// empty) instead of mutating the global gcloud config, avoiding race conditions
/// and leaving the user's config untouched.
fn refresh_gcp_user_token() -> Option<String> {
    let gcloud = dependencies::find_gcloud_cli_path()?;

    let token_output = super::silent_cmd(&gcloud)
        .args(["auth", "print-access-token"])
        .env("CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT", "")
        .output()
        .ok();

    token_output
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Build the environment variables map that Terraform needs from credentials.
fn build_env_vars(credentials: &CloudCredentials) -> HashMap<String, String> {
    let mut env_vars = HashMap::new();

    // AWS credentials — clear conflicting env vars to prevent inherited shell values from clashing
    if let Some(profile) = &credentials.aws_profile {
        if !profile.is_empty() {
            env_vars.insert("AWS_PROFILE".to_string(), profile.clone());
            env_vars.insert("AWS_ACCESS_KEY_ID".to_string(), String::new());
            env_vars.insert("AWS_SECRET_ACCESS_KEY".to_string(), String::new());
            env_vars.insert("AWS_SESSION_TOKEN".to_string(), String::new());
        }
    } else {
        set_env_if_present(&mut env_vars, "AWS_ACCESS_KEY_ID", &credentials.aws_access_key_id);
        set_env_if_present(&mut env_vars, "AWS_SECRET_ACCESS_KEY", &credentials.aws_secret_access_key);
        set_env_if_present(&mut env_vars, "AWS_SESSION_TOKEN", &credentials.aws_session_token);
        env_vars.insert("AWS_PROFILE".to_string(), String::new());
    }
    set_env_if_present(&mut env_vars, "AWS_DEFAULT_REGION", &credentials.aws_region);

    // Azure credentials
    set_env_if_present(&mut env_vars, "ARM_TENANT_ID", &credentials.azure_tenant_id);
    set_env_if_present(&mut env_vars, "ARM_SUBSCRIPTION_ID", &credentials.azure_subscription_id);
    set_env_if_present(&mut env_vars, "ARM_CLIENT_ID", &credentials.azure_client_id);
    set_env_if_present(&mut env_vars, "ARM_CLIENT_SECRET", &credentials.azure_client_secret);

    // GCP credentials
    let is_gcp = credentials.cloud.as_deref() == Some("gcp");

    if let Some(project_id) = &credentials.gcp_project_id {
        if !project_id.is_empty() {
            env_vars.insert("GOOGLE_PROJECT".to_string(), project_id.clone());
            env_vars.insert("GCLOUD_PROJECT".to_string(), project_id.clone());
            env_vars.insert("CLOUDSDK_CORE_PROJECT".to_string(), project_id.clone());
        }
    }

    if opt_non_empty(&credentials.gcp_credentials_json) {
        set_env_if_present(&mut env_vars, "GOOGLE_CREDENTIALS", &credentials.gcp_credentials_json);
    } else if is_gcp {
        // Databricks SDK uses Google ADC for impersonation auth — point it at gcloud creds
        if let Some(adc_path) = find_gcp_adc_path() {
            env_vars.insert("GOOGLE_APPLICATION_CREDENTIALS".to_string(), adc_path);
        }

        // Google Terraform provider needs an OAuth token when no GOOGLE_CREDENTIALS is set
        let token = refresh_gcp_user_token()
            .or_else(|| credentials.gcp_oauth_token.clone().filter(|s| !s.is_empty()));
        if let Some(t) = token {
            env_vars.insert("GOOGLE_OAUTH_ACCESS_TOKEN".to_string(), t);
        }
    } else {
        set_env_if_present(
            &mut env_vars,
            "GOOGLE_OAUTH_ACCESS_TOKEN",
            &credentials.gcp_oauth_token,
        );
    }

    // Databricks credentials
    set_env_if_present(
        &mut env_vars,
        "DATABRICKS_ACCOUNT_ID",
        &credentials.databricks_account_id,
    );

    let databricks_auth_type = credentials
        .databricks_auth_type
        .as_deref()
        .unwrap_or("credentials");

    let profile_has_sp_creds = databricks_auth_type == "profile"
        && has_databricks_sp_creds(credentials);

    let is_azure = credentials.cloud.as_deref() == Some("azure");

    // Databricks auth — clear conflicting env vars to prevent inherited shell values from clashing
    if is_gcp {
        env_vars.insert("DATABRICKS_CONFIG_FILE".to_string(), "/dev/null".to_string());
    } else if !is_azure {
        if databricks_auth_type == "profile" && !profile_has_sp_creds {
            set_env_if_present(
                &mut env_vars,
                "DATABRICKS_CONFIG_PROFILE",
                &credentials.databricks_profile,
            );
            env_vars.insert("DATABRICKS_CLIENT_ID".to_string(), String::new());
            env_vars.insert("DATABRICKS_CLIENT_SECRET".to_string(), String::new());
        } else {
            set_env_if_present(
                &mut env_vars,
                "DATABRICKS_CLIENT_ID",
                &credentials.databricks_client_id,
            );
            set_env_if_present(
                &mut env_vars,
                "DATABRICKS_CLIENT_SECRET",
                &credentials.databricks_client_secret,
            );
            env_vars.insert("DATABRICKS_CONFIG_PROFILE".to_string(), String::new());
        }
    }

    env_vars
}

/// Read Databricks CLI config (default profile).
/// Respects `DATABRICKS_CONFIG_FILE` env var, falling back to `~/.databrickscfg`.
/// Returns `(client_id, client_secret, account_id)`.
fn read_databricks_cli_config() -> Option<(Option<String>, Option<String>, Option<String>)> {
    let config_path = dependencies::get_databricks_config_path()?;
    let content = fs::read_to_string(&config_path).ok()?;
    let mut client_id = None;
    let mut client_secret = None;
    let mut account_id = None;
    let mut in_default_section = false;

    for line in content.lines() {
        let line = line.trim();

        if line.starts_with('[') && line.ends_with(']') {
            let section = &line[1..line.len() - 1];
            in_default_section = section.eq_ignore_ascii_case("default");
            continue;
        }

        if in_default_section {
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim().to_lowercase();
                let value = value.trim().to_string();

                match key.as_str() {
                    "client_id" => client_id = Some(value),
                    "client_secret" => client_secret = Some(value),
                    "account_id" => account_id = Some(value),
                    _ => {}
                }
            }
        }
    }

    if client_id.is_some() || client_secret.is_some() || account_id.is_some() {
        Some((client_id, client_secret, account_id))
    } else {
        None
    }
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

/// Check which CLI dependencies are installed.
#[tauri::command]
pub async fn check_dependencies() -> HashMap<String, DependencyStatus> {
    tokio::task::spawn_blocking(|| {
        let mut deps = HashMap::new();

        deps.insert("terraform".to_string(), dependencies::check_terraform());
        deps.insert("git".to_string(), dependencies::check_git());
        deps.insert("aws".to_string(), dependencies::check_aws_cli());
        deps.insert("azure".to_string(), dependencies::check_azure_cli());
        deps.insert("gcloud".to_string(), dependencies::check_gcloud_cli());
        deps.insert(
            "databricks".to_string(),
            dependencies::check_databricks_cli(),
        );

        deps
    })
    .await
    .unwrap_or_default()
}

/// Check connectivity to external services required by Terraform.
///
/// Returns a map of domain names to reachability status.  Used on the
/// Dependencies screen to warn users early about network issues before
/// `terraform init` is attempted.
#[tauri::command]
pub async fn check_terraform_connectivity() -> HashMap<String, bool> {
    let client = match super::http_client() {
        Ok(c) => c,
        Err(_) => return HashMap::new(),
    };

    let urls: Vec<(&str, &str)> = vec![
        ("registry.terraform.io", "https://registry.terraform.io/.well-known/terraform.json"),
        ("releases.hashicorp.com", "https://releases.hashicorp.com"),
        ("github.com", "https://github.com"),
    ];

    let mut results = HashMap::new();
    for (name, url) in urls {
        let reachable = client
            .head(url)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .is_ok();
        results.insert(name.to_string(), reachable);
    }
    results
}

/// Download and install Terraform.
#[tauri::command]
pub async fn install_terraform() -> Result<String, String> {
    let url = dependencies::get_terraform_download_url();
    let install_dir = dependencies::get_terraform_install_path();

    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to download Terraform: {}", e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let temp_dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let zip_path = temp_dir.path().join("terraform.zip");

    fs::write(&zip_path, &bytes).map_err(|e| format!("Failed to write zip: {}", e))?;

    let file = fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = safe_zip_entry_path(&install_dir, file.name())?;

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = outpath.parent() {
                fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = outfile.metadata().map_err(|e| e.to_string())?.permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&outpath, perms).map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(format!(
        "Terraform installed to {}",
        install_dir.display()
    ))
}

/// Save deployment configuration (copy template + generate `terraform.tfvars`).
#[tauri::command]
pub fn save_configuration(
    app: AppHandle,
    template_id: String,
    deployment_name: String,
    values: HashMap<String, serde_json::Value>,
    credentials: Option<CloudCredentials>,
) -> Result<String, String> {
    let safe_deployment_name = sanitize_deployment_name(&deployment_name)?;
    let safe_template_id = sanitize_template_id(&template_id)?;

    let templates_dir = get_templates_dir(&app)?;
    let template_dir = templates_dir.join(&safe_template_id);
    let template_variables_path = template_dir.join("variables.tf");

    if !template_variables_path.exists() {
        return Err("Template not found".to_string());
    }

    let deployments_dir = get_deployments_dir(&app)?;
    let deployment_dir = deployments_dir.join(&safe_deployment_name);

    if !deployment_dir.exists() {
        fs::create_dir_all(&deployment_dir).map_err(|e| e.to_string())?;
        copy_dir_all(&template_dir, &deployment_dir)?;
    }

    let tfvars_path = deployment_dir.join("terraform.tfvars");
    let variables_path = deployment_dir.join("variables.tf");

    // Merge credentials into values for terraform variables that need them
    let mut merged_values = values.clone();
    if let Some(creds) = credentials {
        if let Some(ref account_id) = creds.databricks_account_id {
            if !account_id.is_empty() {
                merged_values.insert(
                    "databricks_account_id".to_string(),
                    serde_json::Value::String(account_id.clone()),
                );
            }
        }

        // Map UI auth type to Terraform databricks_auth_type: azure-cli (Azure Identity),
        // oauth-m2m (service principal), databricks-cli (OAuth/SSO profile)
        let auth_type = match creds.databricks_auth_type.as_deref() {
            Some("profile") => {
                if creds.cloud.as_deref() == Some("azure") && creds.azure_databricks_use_identity == Some(true) {
                    "azure-cli"
                } else if has_databricks_sp_creds(&creds) {
                    "oauth-m2m"
                } else {
                    "databricks-cli"
                }
            }
            _ => "oauth-m2m",
        };
        merged_values.insert(
            "databricks_auth_type".to_string(),
            serde_json::Value::String(auth_type.to_string()),
        );

        // Azure-specific Databricks variables
        if creds.cloud.as_deref() == Some("azure") {
            if auth_type == "oauth-m2m" {
                if let Some(client_id) = &creds.databricks_client_id {
                    if !client_id.is_empty() {
                        merged_values.insert(
                            "databricks_client_id".to_string(),
                            serde_json::Value::String(client_id.clone()),
                        );
                    }
                }
                if let Some(client_secret) = &creds.databricks_client_secret {
                    if !client_secret.is_empty() {
                        merged_values.insert(
                            "databricks_client_secret".to_string(),
                            serde_json::Value::String(client_secret.clone()),
                        );
                    }
                }
            } else if auth_type == "databricks-cli" {
                // Only write profile for databricks-cli, not for azure-cli
                if let Some(profile) = &creds.databricks_profile {
                    if !profile.is_empty() {
                        merged_values.insert(
                            "databricks_profile".to_string(),
                            serde_json::Value::String(profile.clone()),
                        );
                    }
                }
            }
        }

        if let Some(tenant_id) = &creds.azure_tenant_id {
            if !tenant_id.is_empty() {
                merged_values.insert(
                    "tenant_id".to_string(),
                    serde_json::Value::String(tenant_id.clone()),
                );
            }
        }
        if let Some(sub_id) = &creds.azure_subscription_id {
            if !sub_id.is_empty() {
                merged_values.insert(
                    "subscription_id".to_string(),
                    serde_json::Value::String(sub_id.clone()),
                );
                merged_values.insert(
                    "azure_subscription_id".to_string(),
                    serde_json::Value::String(sub_id.clone()),
                );
            }
        }

        // GCP-specific variables
        if creds.cloud.as_deref() == Some("gcp") {
            if let Some(project_id) = &creds.gcp_project_id {
                if !project_id.is_empty() {
                    merged_values.insert(
                        "google_project_name".to_string(),
                        serde_json::Value::String(project_id.clone()),
                    );
                    merged_values.insert(
                        "google_project".to_string(),
                        serde_json::Value::String(project_id.clone()),
                    );
                    merged_values.insert(
                        "project".to_string(),
                        serde_json::Value::String(project_id.clone()),
                    );
                }
            }

            let gcp_auth_method = if opt_non_empty(&creds.gcp_credentials_json) {
                "credentials"
            } else {
                "impersonation"
            };

            merged_values.insert(
                "gcp_auth_method".to_string(),
                serde_json::Value::String(gcp_auth_method.to_string()),
            );

            if let Some(ref email) = creds.gcp_service_account_email {
                if !email.is_empty() {
                    merged_values.insert(
                        "google_service_account_email".to_string(),
                        serde_json::Value::String(email.clone()),
                    );
                    merged_values.insert(
                        "databricks_google_service_account".to_string(),
                        serde_json::Value::String(email.clone()),
                    );
                }
            }

            if let Some(ref json) = creds.gcp_credentials_json {
                if !json.is_empty() {
                    merged_values.insert(
                        "google_credentials_json".to_string(),
                        serde_json::Value::String(json.clone()),
                    );
                }
            }
        }
    }

    let variables_content = fs::read_to_string(&variables_path).map_err(|e| e.to_string())?;
    let variables = terraform::parse_variables_tf(&variables_content);

    let tfvars_content = terraform::generate_tfvars(&merged_values, &variables);
    fs::write(&tfvars_path, tfvars_content).map_err(|e| e.to_string())?;

    Ok(deployment_dir.to_string_lossy().to_string())
}

/// Run a Terraform command (init, apply, destroy, etc.) in a background thread.
#[tauri::command]
pub async fn run_terraform_command(
    app: AppHandle,
    deployment_name: String,
    command: String,
    credentials: CloudCredentials,
) -> Result<(), String> {
    let safe_deployment_name = sanitize_deployment_name(&deployment_name)?;

    // Check if a Terraform deployment is already in progress
    {
        let proc = CURRENT_PROCESS.lock().map_err(|e| e.to_string())?;
        if let Some(pid) = *proc {
            #[cfg(unix)]
            {
                let output = super::silent_cmd("kill")
                    .args(["-0", &pid.to_string()])
                    .output();
                if let Ok(out) = output {
                    if out.status.success() {
                        return Err("A deployment is already running".to_string());
                    }
                }
            }
            #[cfg(windows)]
            {
                let status = DEPLOYMENT_STATUS.lock().map_err(|e| e.to_string())?;
                if status.running {
                    return Err("A deployment is already running".to_string());
                }
            }
        }
    }

    let deployments_dir = get_deployments_dir(&app)?;
    let deployment_dir = deployments_dir.join(&safe_deployment_name);

    if !deployment_dir.exists() {
        return Err("Deployment not found. Please save configuration first.".to_string());
    }

    let env_vars = build_env_vars(&credentials);

    // Reset deployment status before starting Terraform
    {
        let mut status = DEPLOYMENT_STATUS.lock().map_err(|e| e.to_string())?;
        status.running = true;
        status.command = Some(format!("terraform {}", command));
        status.output = String::new();
        status.success = None;
        status.can_rollback = terraform::check_state_exists(&deployment_dir);
    }

    // Run terraform in background thread
    let status_clone = DEPLOYMENT_STATUS.clone();
    let process_clone = CURRENT_PROCESS.clone();
    let cmd = command.clone();
    let dir = deployment_dir.clone();
    let is_apply = cmd == "apply";

    std::thread::spawn(move || {
        let env_vars_for_retry = if is_apply { Some(env_vars.clone()) } else { None };

        match terraform::run_terraform(&cmd, &dir, env_vars) {
            Ok(mut child) => {
                let set_pid = |pid: u32| {
                    if let Ok(mut proc) = process_clone.lock() {
                        *proc = Some(pid);
                    }
                };

                let success = match terraform::stream_and_wait(
                    &mut child,
                    status_clone.clone(),
                    &set_pid,
                ) {
                    Ok(s) => s,
                    Err(e) => {
                        if let Ok(mut s) = status_clone.lock() {
                            s.running = false;
                            s.success = Some(false);
                            s.output.push_str(&format!("\nError: {}", e));
                        }
                        if let Ok(mut proc) = process_clone.lock() {
                            *proc = None;
                        }
                        return;
                    }
                };

                if success {
                    if let Ok(mut s) = status_clone.lock() {
                        s.running = false;
                        s.success = Some(true);
                        s.can_rollback = terraform::check_state_exists(&dir);
                    }
                } else if let Some(retry_env) = env_vars_for_retry {
                    let (ok, can_rollback) = terraform::import_and_retry_apply(
                        &dir,
                        &retry_env,
                        status_clone.clone(),
                        process_clone.clone(),
                    );
                    if let Ok(mut s) = status_clone.lock() {
                        s.running = false;
                        s.success = Some(ok);
                        s.can_rollback = can_rollback;
                    }
                } else {
                    if let Ok(mut s) = status_clone.lock() {
                        s.running = false;
                        s.success = Some(false);
                        s.can_rollback = terraform::check_state_exists(&dir);
                    }
                }

                if let Ok(mut proc) = process_clone.lock() {
                    *proc = None;
                }
            }
            Err(e) => {
                if let Ok(mut s) = status_clone.lock() {
                    s.running = false;
                    s.success = Some(false);
                    s.output = format!("Failed to start terraform: {}", e);
                }
            }
        }
    });

    Ok(())
}

/// Get current deployment status.
#[tauri::command]
pub fn get_deployment_status() -> Result<DeploymentStatus, String> {
    let status = DEPLOYMENT_STATUS.lock().map_err(|e| e.to_string())?;
    Ok(status.clone())
}

/// Reset deployment status to default.
#[tauri::command]
pub fn reset_deployment_status() -> Result<(), String> {
    let mut status = DEPLOYMENT_STATUS.lock().map_err(|e| e.to_string())?;
    *status = DeploymentStatus::default();
    Ok(())
}

/// Cancel a running deployment by killing the Terraform process.
#[tauri::command]
pub fn cancel_deployment() -> Result<(), String> {
    let proc_id = {
        let proc = CURRENT_PROCESS.lock().map_err(|e| e.to_string())?;
        *proc
    };

    if let Some(pid) = proc_id {
        #[cfg(unix)]
        {
            super::silent_cmd("kill")
                .args(["-TERM", &pid.to_string()])
                .output()
                .map_err(|e| e.to_string())?;
        }

        #[cfg(windows)]
        {
            super::silent_cmd("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .output()
                .map_err(|e| e.to_string())?;
        }

        if let Ok(mut status) = DEPLOYMENT_STATUS.lock() {
            status.running = false;
            status.success = Some(false);
            status.output.push_str("\n\nDeployment cancelled by user.");
        }
    }

    Ok(())
}

/// Rollback a deployment (runs `terraform destroy`).
#[tauri::command]
pub async fn rollback_deployment(
    app: AppHandle,
    deployment_name: String,
    credentials: CloudCredentials,
) -> Result<(), String> {
    run_terraform_command(app, deployment_name, "destroy".to_string(), credentials).await
}

/// Read cloud credentials from environment / CLI config.
#[tauri::command]
pub fn get_cloud_credentials(cloud: String) -> Result<CloudCredentials, String> {
    let mut creds = CloudCredentials {
        cloud: Some(cloud.clone()),
        ..Default::default()
    };

    match cloud.as_str() {
        "aws" => {
            creds.aws_access_key_id = std::env::var("AWS_ACCESS_KEY_ID").ok();
            creds.aws_secret_access_key = std::env::var("AWS_SECRET_ACCESS_KEY").ok();
            creds.aws_session_token = std::env::var("AWS_SESSION_TOKEN").ok();
            creds.aws_region = std::env::var("AWS_DEFAULT_REGION")
                .ok()
                .or_else(|| std::env::var("AWS_REGION").ok());
        }
        "azure" => {
            creds.azure_tenant_id = std::env::var("ARM_TENANT_ID").ok();
            creds.azure_subscription_id = std::env::var("ARM_SUBSCRIPTION_ID").ok();
            creds.azure_client_id = std::env::var("ARM_CLIENT_ID").ok();
            creds.azure_client_secret = std::env::var("ARM_CLIENT_SECRET").ok();
        }
        "gcp" => {
            creds.gcp_project_id = std::env::var("GOOGLE_PROJECT")
                .ok()
                .or_else(|| std::env::var("GCLOUD_PROJECT").ok());
            creds.gcp_credentials_json = std::env::var("GOOGLE_CREDENTIALS").ok();
            creds.gcp_use_adc = Some(creds.gcp_credentials_json.is_none());
        }
        _ => {}
    }

    // Databricks credentials — environment then CLI config
    creds.databricks_account_id = std::env::var("DATABRICKS_ACCOUNT_ID").ok();
    creds.databricks_client_id = std::env::var("DATABRICKS_CLIENT_ID").ok();
    creds.databricks_client_secret = std::env::var("DATABRICKS_CLIENT_SECRET").ok();

    if creds.databricks_client_id.is_none() || creds.databricks_client_secret.is_none() {
        if let Some(cli_creds) = read_databricks_cli_config() {
            if creds.databricks_client_id.is_none() {
                creds.databricks_client_id = cli_creds.0;
            }
            if creds.databricks_client_secret.is_none() {
                creds.databricks_client_secret = cli_creds.1;
            }
            if creds.databricks_account_id.is_none() {
                creds.databricks_account_id = cli_creds.2;
            }
        }
    }

    Ok(creds)
}

/// Get the path to the deployments parent directory.
#[tauri::command]
pub fn get_deployments_folder(app: AppHandle) -> Result<String, String> {
    let deployments_dir = get_deployments_dir(&app)?;
    Ok(deployments_dir.to_string_lossy().to_string())
}

/// Open a folder in the system file manager.
///
/// Validates the path is an existing directory and rejects traversal sequences.
#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    use std::process::Command;

    if path.contains("..") {
        return Err("Path traversal is not allowed".to_string());
    }

    let p = std::path::Path::new(&path);
    if !p.is_dir() {
        return Err("Path is not an existing directory".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

/// Open a URL in the system default browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    use std::process::Command;

    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Invalid URL: must start with http:// or https://".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── has_databricks_sp_creds ─────────────────────────────────────────

    #[test]
    fn has_sp_creds_both_present() {
        let creds = CloudCredentials {
            databricks_client_id: Some("client-id".to_string()),
            databricks_client_secret: Some("client-secret".to_string()),
            ..Default::default()
        };
        assert!(has_databricks_sp_creds(&creds));
    }

    #[test]
    fn has_sp_creds_missing_id() {
        let creds = CloudCredentials {
            databricks_client_secret: Some("client-secret".to_string()),
            ..Default::default()
        };
        assert!(!has_databricks_sp_creds(&creds));
    }

    #[test]
    fn has_sp_creds_missing_secret() {
        let creds = CloudCredentials {
            databricks_client_id: Some("client-id".to_string()),
            ..Default::default()
        };
        assert!(!has_databricks_sp_creds(&creds));
    }

    #[test]
    fn has_sp_creds_empty_strings() {
        let creds = CloudCredentials {
            databricks_client_id: Some("".to_string()),
            databricks_client_secret: Some("".to_string()),
            ..Default::default()
        };
        assert!(!has_databricks_sp_creds(&creds));
    }

    #[test]
    fn has_sp_creds_none() {
        let creds = CloudCredentials::default();
        assert!(!has_databricks_sp_creds(&creds));
    }

    // ── set_env_if_present ──────────────────────────────────────────────

    #[test]
    fn set_env_if_present_with_value() {
        let mut env = HashMap::new();
        set_env_if_present(&mut env, "KEY", &Some("value".to_string()));
        assert_eq!(env.get("KEY"), Some(&"value".to_string()));
    }

    #[test]
    fn set_env_if_present_with_none() {
        let mut env = HashMap::new();
        set_env_if_present(&mut env, "KEY", &None);
        assert!(!env.contains_key("KEY"));
    }

    #[test]
    fn set_env_if_present_with_empty_string() {
        let mut env = HashMap::new();
        set_env_if_present(&mut env, "KEY", &Some("".to_string()));
        assert!(!env.contains_key("KEY"));
    }

    // ── build_env_vars ──────────────────────────────────────────────────

    #[test]
    fn build_env_vars_aws_profile() {
        let creds = CloudCredentials {
            aws_profile: Some("my-profile".to_string()),
            cloud: Some("aws".to_string()),
            ..Default::default()
        };
        let env = build_env_vars(&creds);
        assert_eq!(env.get("AWS_PROFILE"), Some(&"my-profile".to_string()));
        assert_eq!(env.get("AWS_ACCESS_KEY_ID"), Some(&String::new()));
        assert_eq!(env.get("AWS_SECRET_ACCESS_KEY"), Some(&String::new()));
        assert_eq!(env.get("AWS_SESSION_TOKEN"), Some(&String::new()));
    }

    #[test]
    fn build_env_vars_aws_keys() {
        let creds = CloudCredentials {
            aws_access_key_id: Some("AKID".to_string()),
            aws_secret_access_key: Some("SECRET".to_string()),
            aws_session_token: Some("TOKEN".to_string()),
            aws_region: Some("us-east-1".to_string()),
            cloud: Some("aws".to_string()),
            ..Default::default()
        };
        let env = build_env_vars(&creds);
        assert_eq!(env.get("AWS_ACCESS_KEY_ID"), Some(&"AKID".to_string()));
        assert_eq!(env.get("AWS_SECRET_ACCESS_KEY"), Some(&"SECRET".to_string()));
        assert_eq!(env.get("AWS_SESSION_TOKEN"), Some(&"TOKEN".to_string()));
        assert_eq!(env.get("AWS_DEFAULT_REGION"), Some(&"us-east-1".to_string()));
        assert_eq!(env.get("AWS_PROFILE"), Some(&String::new()));
    }

    #[test]
    fn build_env_vars_azure() {
        let creds = CloudCredentials {
            azure_tenant_id: Some("tid".to_string()),
            azure_subscription_id: Some("sid".to_string()),
            azure_client_id: Some("cid".to_string()),
            azure_client_secret: Some("csec".to_string()),
            cloud: Some("azure".to_string()),
            ..Default::default()
        };
        let env = build_env_vars(&creds);
        assert_eq!(env.get("ARM_TENANT_ID"), Some(&"tid".to_string()));
        assert_eq!(env.get("ARM_SUBSCRIPTION_ID"), Some(&"sid".to_string()));
        assert_eq!(env.get("ARM_CLIENT_ID"), Some(&"cid".to_string()));
        assert_eq!(env.get("ARM_CLIENT_SECRET"), Some(&"csec".to_string()));
    }

    #[test]
    fn build_env_vars_gcp_project() {
        let creds = CloudCredentials {
            gcp_project_id: Some("my-project".to_string()),
            cloud: Some("gcp".to_string()),
            ..Default::default()
        };
        let env = build_env_vars(&creds);
        assert_eq!(env.get("GOOGLE_PROJECT"), Some(&"my-project".to_string()));
        assert_eq!(env.get("GCLOUD_PROJECT"), Some(&"my-project".to_string()));
        assert_eq!(env.get("CLOUDSDK_CORE_PROJECT"), Some(&"my-project".to_string()));
    }

    #[test]
    fn build_env_vars_gcp_credentials_json() {
        let creds = CloudCredentials {
            gcp_credentials_json: Some("{\"key\":\"value\"}".to_string()),
            cloud: Some("gcp".to_string()),
            ..Default::default()
        };
        let env = build_env_vars(&creds);
        assert_eq!(env.get("GOOGLE_CREDENTIALS"), Some(&"{\"key\":\"value\"}".to_string()));
        assert!(!env.contains_key("GOOGLE_OAUTH_ACCESS_TOKEN"));
    }

    #[test]
    fn build_env_vars_gcp_impersonation_mode() {
        let creds = CloudCredentials {
            gcp_oauth_token: Some("oauth-token".to_string()),
            cloud: Some("gcp".to_string()),
            ..Default::default()
        };
        let env = build_env_vars(&creds);
        assert!(!env.contains_key("GOOGLE_CREDENTIALS"));
        assert_eq!(env.get("DATABRICKS_CONFIG_FILE"), Some(&"/dev/null".to_string()));
        // GOOGLE_APPLICATION_CREDENTIALS is set when a gcloud ADC file exists on the machine
        // GOOGLE_OAUTH_ACCESS_TOKEN is set from gcloud CLI or the stored fallback value
    }

    #[test]
    fn build_env_vars_gcp_nullifies_databricks_config() {
        let creds = CloudCredentials {
            cloud: Some("gcp".to_string()),
            ..Default::default()
        };
        let env = build_env_vars(&creds);
        assert_eq!(env.get("DATABRICKS_CONFIG_FILE"), Some(&"/dev/null".to_string()));
    }

    #[test]
    fn build_env_vars_databricks_sp_credentials() {
        let creds = CloudCredentials {
            databricks_account_id: Some("acc-id".to_string()),
            databricks_client_id: Some("sp-id".to_string()),
            databricks_client_secret: Some("sp-secret".to_string()),
            databricks_auth_type: Some("credentials".to_string()),
            cloud: Some("aws".to_string()),
            ..Default::default()
        };
        let env = build_env_vars(&creds);
        assert_eq!(env.get("DATABRICKS_ACCOUNT_ID"), Some(&"acc-id".to_string()));
        assert_eq!(env.get("DATABRICKS_CLIENT_ID"), Some(&"sp-id".to_string()));
        assert_eq!(env.get("DATABRICKS_CLIENT_SECRET"), Some(&"sp-secret".to_string()));
        assert_eq!(env.get("DATABRICKS_CONFIG_PROFILE"), Some(&String::new()));
    }

    #[test]
    fn build_env_vars_databricks_profile_without_sp() {
        let creds = CloudCredentials {
            databricks_profile: Some("my-profile".to_string()),
            databricks_auth_type: Some("profile".to_string()),
            cloud: Some("aws".to_string()),
            ..Default::default()
        };
        let env = build_env_vars(&creds);
        assert_eq!(env.get("DATABRICKS_CONFIG_PROFILE"), Some(&"my-profile".to_string()));
        assert_eq!(env.get("DATABRICKS_CLIENT_ID"), Some(&String::new()));
        assert_eq!(env.get("DATABRICKS_CLIENT_SECRET"), Some(&String::new()));
    }

    #[test]
    fn build_env_vars_databricks_profile_with_sp_uses_sp() {
        let creds = CloudCredentials {
            databricks_profile: Some("my-profile".to_string()),
            databricks_client_id: Some("sp-id".to_string()),
            databricks_client_secret: Some("sp-secret".to_string()),
            databricks_auth_type: Some("profile".to_string()),
            cloud: Some("aws".to_string()),
            ..Default::default()
        };
        let env = build_env_vars(&creds);
        assert_eq!(env.get("DATABRICKS_CLIENT_ID"), Some(&"sp-id".to_string()));
        assert_eq!(env.get("DATABRICKS_CLIENT_SECRET"), Some(&"sp-secret".to_string()));
        assert_eq!(env.get("DATABRICKS_CONFIG_PROFILE"), Some(&String::new()));
    }

    #[test]
    fn build_env_vars_empty_credentials() {
        let creds = CloudCredentials::default();
        let env = build_env_vars(&creds);
        assert_eq!(env.get("AWS_PROFILE"), Some(&String::new()));
        assert!(!env.contains_key("ARM_TENANT_ID"));
    }

    #[test]
    fn build_env_vars_empty_aws_profile_ignored() {
        let creds = CloudCredentials {
            aws_profile: Some("".to_string()),
            cloud: Some("aws".to_string()),
            ..Default::default()
        };
        let env = build_env_vars(&creds);
        assert!(!env.contains_key("AWS_PROFILE"));
    }

    // ── open_url validation ─────────────────────────────────────────────

    #[test]
    fn open_url_rejects_non_http() {
        let result = open_url("ftp://example.com".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid URL"));
    }

    #[test]
    fn open_url_rejects_javascript() {
        let result = open_url("javascript:alert(1)".to_string());
        assert!(result.is_err());
    }

    // ── safe_zip_entry_path ─────────────────────────────────────────────

    #[test]
    fn zip_path_normal_entry() {
        let base = std::path::PathBuf::from("/tmp/install");
        let result = safe_zip_entry_path(&base, "terraform");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), base.join("terraform"));
    }

    #[test]
    fn zip_path_nested_entry() {
        let base = std::path::PathBuf::from("/tmp/install");
        let result = safe_zip_entry_path(&base, "bin/terraform");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), base.join("bin/terraform"));
    }

    #[test]
    fn zip_path_rejects_parent_traversal() {
        let base = std::path::PathBuf::from("/tmp/install");
        let result = safe_zip_entry_path(&base, "../etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("path traversal"));
    }

    #[test]
    fn zip_path_rejects_nested_traversal() {
        let base = std::path::PathBuf::from("/tmp/install");
        let result = safe_zip_entry_path(&base, "foo/../../etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("path traversal"));
    }

    #[test]
    fn zip_path_rejects_absolute_path() {
        let base = std::path::PathBuf::from("/tmp/install");
        let result = safe_zip_entry_path(&base, "/etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("absolute path"));
    }

    // ── open_folder validation ──────────────────────────────────────────

    #[test]
    fn open_folder_rejects_traversal() {
        let result = open_folder("/tmp/../etc".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("traversal"));
    }

    #[test]
    fn open_folder_rejects_nonexistent() {
        let result = open_folder("/nonexistent/path/that/does/not/exist".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not an existing directory"));
    }

    #[test]
    fn open_folder_rejects_file_path() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let result = open_folder(temp.path().to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not an existing directory"));
    }

    // ── read_databricks_cli_config parsing ──────────────────────────────

    #[test]
    fn read_cli_config_parses_default_section() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join(".databrickscfg");
        std::fs::write(
            &config_path,
            "[DEFAULT]\nclient_id = cid-123\nclient_secret = csec-456\naccount_id = acc-789\n",
        )
        .unwrap();

        // Override HOME to point at temp dir so the function finds the file
        let original_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", dir.path());

        let result = read_databricks_cli_config();

        // Restore HOME
        if let Some(h) = original_home {
            std::env::set_var("HOME", h);
        }

        assert!(result.is_some());
        let (cid, csec, acc) = result.unwrap();
        assert_eq!(cid, Some("cid-123".to_string()));
        assert_eq!(csec, Some("csec-456".to_string()));
        assert_eq!(acc, Some("acc-789".to_string()));
    }

    #[test]
    fn read_cli_config_ignores_non_default_sections() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join(".databrickscfg");
        std::fs::write(
            &config_path,
            "[my-profile]\nclient_id = cid\nclient_secret = csec\naccount_id = acc\n",
        )
        .unwrap();

        let original_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", dir.path());

        let result = read_databricks_cli_config();

        if let Some(h) = original_home {
            std::env::set_var("HOME", h);
        }

        assert!(result.is_none());
    }

    // ── build_env_vars: Azure auth type combinations ────────────────────

    #[test]
    fn build_env_vars_azure_does_not_set_databricks_config_profile() {
        let creds = CloudCredentials {
            cloud: Some("azure".to_string()),
            azure_tenant_id: Some("tid".to_string()),
            databricks_client_id: Some("sp-id".to_string()),
            databricks_client_secret: Some("sp-sec".to_string()),
            databricks_auth_type: Some("credentials".to_string()),
            ..Default::default()
        };
        let env = build_env_vars(&creds);
        // Azure cloud should not set DATABRICKS_CONFIG_PROFILE or DATABRICKS_CLIENT_*
        // (those are handled via Terraform variables, not env vars)
        assert!(!env.contains_key("DATABRICKS_CONFIG_PROFILE"));
        assert!(!env.contains_key("DATABRICKS_CLIENT_ID"));
    }

    #[test]
    fn build_env_vars_aws_session_token_optional() {
        let creds = CloudCredentials {
            aws_access_key_id: Some("AKID".to_string()),
            aws_secret_access_key: Some("SECRET".to_string()),
            cloud: Some("aws".to_string()),
            ..Default::default()
        };
        let env = build_env_vars(&creds);
        assert_eq!(env.get("AWS_ACCESS_KEY_ID"), Some(&"AKID".to_string()));
        assert!(!env.contains_key("AWS_SESSION_TOKEN"));
    }
}
