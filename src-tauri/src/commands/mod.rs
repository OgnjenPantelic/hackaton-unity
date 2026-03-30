//! Command handlers for the Tauri desktop application.
//!
//! This module is split into submodules by cloud provider and feature area:
//! - [`aws`] - AWS authentication and permission checking
//! - [`azure`] - Azure authentication and permission checking
//! - [`databricks`] - Databricks authentication and Unity Catalog permissions
//! - [`deployment`] - Terraform deployment, configuration, and lifecycle management
//! - [`gcp`] - GCP authentication, permission checking, and service account management
//! - [`github`] - Git repository initialization and GitHub integration
//! - [`templates`] - Template setup, listing, and variable parsing

pub mod assistant;
pub mod aws;
pub mod azure;
pub mod databricks;
pub mod deployment;
pub mod gcp;
pub mod github;
pub mod templates;

// Re-export all commands so lib.rs can reference them as commands::function_name
pub use assistant::*;
pub use aws::*;
pub use azure::*;
pub use databricks::*;
pub use deployment::*;
pub use gcp::*;
pub use github::*;
pub use templates::*;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

lazy_static::lazy_static! {
    /// PID of the currently running CLI login process (shared by Azure, AWS SSO, GCP,
    /// and Azure Databricks consent login). Only one interactive login may run at a time;
    /// starting a second would overwrite the tracked PID and break cancellation of the first.
    pub static ref CLI_LOGIN_PROCESS: Arc<Mutex<Option<u32>>> = Arc::new(Mutex::new(None));
}

/// Acquire a mutex lock, recovering from poisoning with a warning.
///
/// A poisoned lock means another thread panicked while holding it.
/// We log a debug warning and recover the inner value so the app
/// can continue rather than silently swallowing the error.
pub(crate) fn lock_or_recover<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| {
        debug_log!("[WARN] Mutex poisoned, recovering: {}", poisoned);
        poisoned.into_inner()
    })
}

/// Register a newly spawned login process.
///
/// Returns `Err` if another interactive login is already tracked, preventing
/// PID overwrite and potential orphan processes.  On success the PID is stored
/// in `CLI_LOGIN_PROCESS` so `cancel_cli_login` can find it.
pub(crate) fn acquire_login_slot(pid: u32) -> Result<(), String> {
    let mut guard = lock_or_recover(&CLI_LOGIN_PROCESS);
    if let Some(existing) = *guard {
        return Err(format!(
            "Another login is already in progress (PID {}). Please cancel it first.",
            existing
        ));
    }
    *guard = Some(pid);
    Ok(())
}

/// Release the login slot after a login process finishes (success or failure).
pub(crate) fn release_login_slot() {
    let mut guard = lock_or_recover(&CLI_LOGIN_PROCESS);
    *guard = None;
}

/// Cancel an in-progress CLI login (Azure, AWS SSO, GCP, or Azure Databricks consent).
///
/// Atomically takes the stored PID to avoid TOCTOU races, then sends
/// SIGTERM before SIGKILL on Unix to allow graceful cleanup.
#[tauri::command]
pub fn cancel_cli_login() -> Result<(), String> {
    let proc_id = lock_or_recover(&CLI_LOGIN_PROCESS).take();

    if let Some(pid) = proc_id {
        let pid_str = pid.to_string();

        #[cfg(unix)]
        {
            use std::thread;
            use std::time::Duration;

            let _ = silent_cmd("pkill").args(["-TERM", "-P", &pid_str]).output();
            let _ = silent_cmd("kill").args(["-TERM", &pid_str]).output();
            thread::sleep(Duration::from_millis(200));
            let _ = silent_cmd("pkill").args(["-9", "-P", &pid_str]).output();
            let _ = silent_cmd("kill").args(["-9", &pid_str]).output();
        }

        #[cfg(windows)]
        {
            let _ = silent_cmd("taskkill")
                .args(["/F", "/T", "/PID", &pid_str])
                .output();
        }
    }

    Ok(())
}

/// Debug logging macro — only emits output in debug builds.
macro_rules! debug_log {
    ($($arg:tt)*) => {
        #[cfg(debug_assertions)]
        eprintln!($($arg)*);
    };
}
pub(crate) use debug_log;

// ─── Shared Types ───────────────────────────────────────────────────────────

/// Terraform deployment template descriptor.
#[derive(Debug, Serialize, Deserialize)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub cloud: String,
    pub description: String,
    pub features: Vec<String>,
    pub github_url: String,
}

/// Cloud provider and Databricks credentials bundle.
///
/// Passed between the frontend and Rust backend to authenticate
/// Terraform runs and CLI operations.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct CloudCredentials {
    // AWS
    pub aws_profile: Option<String>,
    pub aws_access_key_id: Option<String>,
    pub aws_secret_access_key: Option<String>,
    pub aws_session_token: Option<String>,
    pub aws_region: Option<String>,
    // Azure
    pub azure_tenant_id: Option<String>,
    pub azure_subscription_id: Option<String>,
    pub azure_client_id: Option<String>,
    pub azure_client_secret: Option<String>,
    pub azure_databricks_use_identity: Option<bool>,
    pub azure_account_email: Option<String>,
    // GCP
    pub gcp_project_id: Option<String>,
    pub gcp_credentials_json: Option<String>,
    pub gcp_use_adc: Option<bool>,
    pub gcp_oauth_token: Option<String>,
    pub gcp_service_account_email: Option<String>,
    // Databricks
    pub databricks_account_id: Option<String>,
    pub databricks_client_id: Option<String>,
    pub databricks_client_secret: Option<String>,
    pub databricks_profile: Option<String>,
    pub databricks_auth_type: Option<String>,
    // Cloud identifier
    pub cloud: Option<String>,
}

/// Result of a cloud provider permission check.
#[derive(Debug, Serialize, Deserialize)]
pub struct CloudPermissionCheck {
    pub has_all_permissions: bool,
    pub checked_permissions: Vec<String>,
    pub missing_permissions: Vec<String>,
    pub message: String,
    /// `true` = soft warning (can continue), `false` = hard block.
    pub is_warning: bool,
}

/// Unity Catalog metastore info.
#[derive(Debug, Serialize, Deserialize)]
pub struct MetastoreInfo {
    pub exists: bool,
    pub metastore_id: Option<String>,
    pub metastore_name: Option<String>,
    pub region: Option<String>,
}

/// Unity Catalog permission check result.
#[derive(Debug, Serialize, Deserialize)]
pub struct UCPermissionCheck {
    pub metastore: MetastoreInfo,
    pub has_create_catalog: bool,
    pub has_create_external_location: bool,
    pub has_create_storage_credential: bool,
    pub can_create_catalog: bool,
    pub message: String,
}

// ─── Constants ──────────────────────────────────────────────────────────────

/// Increment when embedded templates change to trigger a refresh.
pub(crate) const TEMPLATES_VERSION: &str = "2.76.0";

/// Variables that are automatically set by the app and hidden from the UI form.
pub(crate) const INTERNAL_VARIABLES: &[&str] = &[
    "gcp_auth_method",
    "google_credentials_json",
    "hub_workspace_url_override",
    "spoke_workspace_url_override",
    "workspace_url_override",
    "workspace_sku",
    "az_subscription",
];

// ─── Helper Functions ───────────────────────────────────────────────────────

/// Create a `std::process::Command` that suppresses console window popups on Windows.
/// On non-Windows platforms this is identical to `Command::new()`.
pub(crate) fn silent_cmd<S: AsRef<std::ffi::OsStr>>(program: S) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Recursively copy a directory tree. Used for templates and deployments.
pub(crate) fn copy_dir_all(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;

    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if ty.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Resolve the app-data templates directory.
pub(crate) fn get_templates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("templates"))
}

/// Resolve (and create) the app-data deployments directory.
pub(crate) fn get_deployments_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let deployments_dir = app_data_dir.join("deployments");
    fs::create_dir_all(&deployments_dir).map_err(|e| e.to_string())?;
    Ok(deployments_dir)
}

/// Sanitize deployment name to prevent path traversal attacks.
/// Only allows alphanumeric characters, hyphens, and underscores.
pub(crate) fn sanitize_deployment_name(name: &str) -> Result<String, String> {
    if name.is_empty() {
        return Err("Deployment name cannot be empty".to_string());
    }

    let sanitized: String = name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect();

    if sanitized.is_empty() {
        return Err("Deployment name contains no valid characters".to_string());
    }
    if sanitized.starts_with('-') {
        return Err("Deployment name cannot start with a hyphen".to_string());
    }
    if sanitized.len() > 200 {
        return Err("Deployment name is too long (max 200 characters)".to_string());
    }

    Ok(sanitized)
}

/// Mask sensitive identifiers for debug logging (show first 4 and last 4 chars).
#[cfg_attr(not(debug_assertions), allow(dead_code))]
pub(crate) fn mask_sensitive_id(id: &str) -> String {
    if id.len() <= 12 {
        return "***".to_string();
    }
    format!("{}...{}", &id[..4], &id[id.len()-4..])
}

/// Databricks account-level API hostname for the given cloud provider.
pub(crate) fn databricks_accounts_host(cloud: &str) -> &'static str {
    match cloud {
        "azure" => "accounts.azuredatabricks.net",
        "gcp" => "accounts.gcp.databricks.com",
        _ => "accounts.cloud.databricks.com",
    }
}

/// Check if a string is a valid UUID v4 format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).
pub(crate) fn is_valid_uuid(s: &str) -> bool {
    s.len() == 36
        && s.chars().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// Create a standard HTTP client with a 30-second timeout.
///
/// Automatically configures the client with system proxy settings
/// detected via [`crate::proxy`] when no proxy env vars are present.
/// Uses `native-tls` to trust the OS certificate store (important for
/// corporate TLS inspection).
pub(crate) fn http_client() -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30));

    if let Some(proxy_url) = crate::proxy::get_https_proxy() {
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
            builder = builder.proxy(proxy);
        }
    }

    builder
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

/// Check if an `Option<String>` contains a non-empty value.
pub(crate) fn opt_non_empty(opt: &Option<String>) -> bool {
    opt.as_ref().map(|s| !s.is_empty()).unwrap_or(false)
}

/// Sanitize template ID to prevent path traversal attacks.
pub(crate) fn sanitize_template_id(id: &str) -> Result<String, String> {
    if id.is_empty() {
        return Err("Template ID cannot be empty".to_string());
    }
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid template ID".to_string());
    }
    if !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("Template ID contains invalid characters".to_string());
    }
    Ok(id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── sanitize_deployment_name ─────────────────────────────────────────

    #[test]
    fn sanitize_deployment_name_valid() {
        assert_eq!(sanitize_deployment_name("deploy-azure-123").unwrap(), "deploy-azure-123");
    }

    #[test]
    fn sanitize_deployment_name_with_underscores() {
        assert_eq!(sanitize_deployment_name("my_deploy_01").unwrap(), "my_deploy_01");
    }

    #[test]
    fn sanitize_deployment_name_strips_special_chars() {
        assert_eq!(sanitize_deployment_name("deploy/../hack").unwrap(), "deployhack");
    }

    #[test]
    fn sanitize_deployment_name_strips_spaces() {
        assert_eq!(sanitize_deployment_name("deploy name").unwrap(), "deployname");
    }

    #[test]
    fn sanitize_deployment_name_empty() {
        assert!(sanitize_deployment_name("").is_err());
    }

    #[test]
    fn sanitize_deployment_name_all_invalid_chars() {
        assert!(sanitize_deployment_name("///...").is_err());
    }

    #[test]
    fn sanitize_deployment_name_leading_hyphen() {
        assert!(sanitize_deployment_name("-badname").is_err());
    }

    #[test]
    fn sanitize_deployment_name_too_long() {
        let long = "a".repeat(201);
        assert!(sanitize_deployment_name(&long).is_err());
    }

    #[test]
    fn sanitize_deployment_name_max_length_ok() {
        let exact = "a".repeat(200);
        assert!(sanitize_deployment_name(&exact).is_ok());
    }

    // ── sanitize_template_id ────────────────────────────────────────────

    #[test]
    fn sanitize_template_id_valid() {
        assert_eq!(sanitize_template_id("azure-simple").unwrap(), "azure-simple");
    }

    #[test]
    fn sanitize_template_id_with_underscores() {
        assert_eq!(sanitize_template_id("gcp_advanced").unwrap(), "gcp_advanced");
    }

    #[test]
    fn sanitize_template_id_empty() {
        assert!(sanitize_template_id("").is_err());
    }

    #[test]
    fn sanitize_template_id_path_traversal_dots() {
        assert!(sanitize_template_id("../etc/passwd").is_err());
    }

    #[test]
    fn sanitize_template_id_forward_slash() {
        assert!(sanitize_template_id("templates/hack").is_err());
    }

    #[test]
    fn sanitize_template_id_backslash() {
        assert!(sanitize_template_id("templates\\hack").is_err());
    }

    #[test]
    fn sanitize_template_id_special_chars() {
        assert!(sanitize_template_id("template@v2").is_err());
    }

    // ── is_valid_uuid ───────────────────────────────────────────────────

    #[test]
    fn is_valid_uuid_valid() {
        assert!(is_valid_uuid("550e8400-e29b-41d4-a716-446655440000"));
    }

    #[test]
    fn is_valid_uuid_wrong_length() {
        assert!(!is_valid_uuid("550e8400-e29b-41d4"));
    }

    #[test]
    fn is_valid_uuid_no_dashes() {
        assert!(!is_valid_uuid("550e8400e29b41d4a716446655440000"));
    }

    #[test]
    fn is_valid_uuid_wrong_dash_positions() {
        assert!(!is_valid_uuid("550e840-0e29b-41d4-a716-446655440000"));
    }

    #[test]
    fn is_valid_uuid_non_hex_chars() {
        assert!(!is_valid_uuid("550e8400-e29b-41d4-a716-44665544000g"));
    }

    #[test]
    fn is_valid_uuid_empty() {
        assert!(!is_valid_uuid(""));
    }

    #[test]
    fn is_valid_uuid_uppercase_hex() {
        assert!(is_valid_uuid("550E8400-E29B-41D4-A716-446655440000"));
    }

    // ── mask_sensitive_id ───────────────────────────────────────────────

    #[test]
    fn mask_sensitive_id_normal() {
        assert_eq!(mask_sensitive_id("1234567890abcdef"), "1234...cdef");
    }

    #[test]
    fn mask_sensitive_id_short() {
        assert_eq!(mask_sensitive_id("short"), "***");
    }

    #[test]
    fn mask_sensitive_id_exactly_12() {
        assert_eq!(mask_sensitive_id("123456789012"), "***");
    }

    #[test]
    fn mask_sensitive_id_13_chars() {
        assert_eq!(mask_sensitive_id("1234567890123"), "1234...0123");
    }

    // ── databricks_accounts_host ────────────────────────────────────────

    #[test]
    fn databricks_host_azure() {
        assert_eq!(databricks_accounts_host("azure"), "accounts.azuredatabricks.net");
    }

    #[test]
    fn databricks_host_gcp() {
        assert_eq!(databricks_accounts_host("gcp"), "accounts.gcp.databricks.com");
    }

    #[test]
    fn databricks_host_aws() {
        assert_eq!(databricks_accounts_host("aws"), "accounts.cloud.databricks.com");
    }

    #[test]
    fn databricks_host_unknown_defaults_to_aws() {
        assert_eq!(databricks_accounts_host("unknown"), "accounts.cloud.databricks.com");
    }

    // ── opt_non_empty ───────────────────────────────────────────────────

    #[test]
    fn opt_non_empty_none() {
        assert!(!opt_non_empty(&None));
    }

    #[test]
    fn opt_non_empty_empty_string() {
        assert!(!opt_non_empty(&Some("".to_string())));
    }

    #[test]
    fn opt_non_empty_with_value() {
        assert!(opt_non_empty(&Some("value".to_string())));
    }

    // ── copy_dir_all (filesystem integration) ───────────────────────────

    #[test]
    fn copy_dir_all_flat_files() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let dst_target = dst.path().join("output");

        fs::write(src.path().join("file1.txt"), "hello").unwrap();
        fs::write(src.path().join("file2.tf"), "variable {}").unwrap();

        copy_dir_all(&src.path().to_path_buf(), &dst_target).unwrap();

        assert_eq!(fs::read_to_string(dst_target.join("file1.txt")).unwrap(), "hello");
        assert_eq!(fs::read_to_string(dst_target.join("file2.tf")).unwrap(), "variable {}");
    }

    #[test]
    fn copy_dir_all_nested_directories() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let dst_target = dst.path().join("output");

        fs::create_dir_all(src.path().join("subdir")).unwrap();
        fs::write(src.path().join("root.txt"), "root").unwrap();
        fs::write(src.path().join("subdir").join("nested.txt"), "nested").unwrap();

        copy_dir_all(&src.path().to_path_buf(), &dst_target).unwrap();

        assert_eq!(fs::read_to_string(dst_target.join("root.txt")).unwrap(), "root");
        assert_eq!(
            fs::read_to_string(dst_target.join("subdir").join("nested.txt")).unwrap(),
            "nested"
        );
    }

    #[test]
    fn copy_dir_all_empty_directory() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let dst_target = dst.path().join("output");

        copy_dir_all(&src.path().to_path_buf(), &dst_target).unwrap();

        assert!(dst_target.exists());
        assert!(fs::read_dir(&dst_target).unwrap().next().is_none());
    }

    #[test]
    fn copy_dir_all_preserves_content() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let dst_target = dst.path().join("output");

        let content = "variable \"region\" {\n  type = string\n  default = \"us-east-1\"\n}\n";
        fs::write(src.path().join("variables.tf"), content).unwrap();

        copy_dir_all(&src.path().to_path_buf(), &dst_target).unwrap();

        assert_eq!(fs::read_to_string(dst_target.join("variables.tf")).unwrap(), content);
    }

    #[test]
    fn copy_dir_all_source_not_found() {
        let dst = tempfile::tempdir().unwrap();
        let result = copy_dir_all(
            &PathBuf::from("/nonexistent/path"),
            &dst.path().join("output"),
        );
        assert!(result.is_err());
    }
}
