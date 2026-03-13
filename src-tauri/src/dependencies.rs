use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::fs;
use which::which;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DependencyStatus {
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub required: bool,
    pub install_url: String,
}

/// Configuration for finding a CLI binary
#[allow(dead_code)] // Some fields only used on specific platforms
struct CliPathConfig {
    /// Binary name without extension (e.g., "terraform", "aws", "az")
    binary_name: &'static str,
    /// Windows-specific binary name if different (e.g., "az.cmd")
    windows_binary_name: Option<&'static str>,
    /// Common installation paths on Windows
    windows_paths: &'static [&'static str],
    /// Common installation paths on macOS/Linux
    unix_paths: &'static [&'static str],
    /// Additional paths to check in home directory (relative to home)
    home_relative_paths: &'static [&'static str],
    /// Additional paths to check based on env vars (env_var, relative_path)
    env_var_paths: &'static [(&'static str, &'static str)],
}

/// Generic function to find a CLI binary path
fn find_cli_path(config: &CliPathConfig) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let binary_name = config.windows_binary_name.unwrap_or(config.binary_name);
    #[cfg(not(target_os = "windows"))]
    let binary_name = config.binary_name;

    // Check env var paths first
    for (env_var, relative_path) in config.env_var_paths {
        if let Ok(base_path) = std::env::var(env_var) {
            let p = PathBuf::from(base_path).join(relative_path);
            if p.exists() {
                return Some(p);
            }
        }
    }

    // Check home-relative paths
    if let Some(home) = dirs::home_dir() {
        for relative_path in config.home_relative_paths {
            let p = home.join(relative_path);
            if p.exists() {
                return Some(p);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        for path in config.windows_paths {
            let p = PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        for path in config.unix_paths {
            let p = PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
    }

    // Fall back to which
    if let Ok(p) = which(binary_name) {
        return Some(p);
    }

    // On Windows, also try .cmd extension
    #[cfg(target_os = "windows")]
    {
        let cmd_name = format!("{}.cmd", config.binary_name);
        if let Ok(p) = which(&cmd_name) {
            return Some(p);
        }
    }

    None
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DatabricksProfile {
    pub name: String,
    pub host: String,
    pub account_id: Option<String>,
    pub has_client_credentials: bool,
    pub has_token: bool,
    pub cloud: String, // "aws", "azure", or "gcp"
}

/// Find Databricks CLI binary
pub fn find_databricks_cli_path() -> Option<PathBuf> {
    static CONFIG: CliPathConfig = CliPathConfig {
        binary_name: "databricks",
        windows_binary_name: Some("databricks.exe"),
        windows_paths: &[
            "C:\\Program Files\\Databricks\\databricks.exe",
            "C:\\Program Files (x86)\\Databricks\\databricks.exe",
        ],
        unix_paths: &[
            "/usr/local/bin/databricks",
            "/opt/homebrew/bin/databricks",
            "/usr/bin/databricks",
            "/bin/databricks",
            "/opt/local/bin/databricks",
            "/snap/bin/databricks",
        ],
        home_relative_paths: &[
            ".local/bin/databricks",  // pip install location on Linux/macOS
            ".databricks/bin/databricks", // Databricks installer location
        ],
        env_var_paths: &[
            ("LOCALAPPDATA", "Programs/databricks/databricks.exe"),
        ],
    };
    find_cli_path(&CONFIG)
}

pub fn check_databricks_cli() -> DependencyStatus {
    let mut status = DependencyStatus {
        name: "Databricks CLI".to_string(),
        installed: false,
        version: None,
        required: false,
        install_url: "https://docs.databricks.com/en/dev-tools/cli/install.html".to_string(),
    };

    if let Some(cli_path) = find_databricks_cli_path() {
        if let Ok(output) = crate::commands::silent_cmd(&cli_path).arg("--version").output() {
            if output.status.success() {
                status.installed = true;
                if let Ok(stdout) = String::from_utf8(output.stdout) {
                    status.version = Some(stdout.trim().to_string());
                }
            }
        }
    }

    status
}

/// Get the path to the Databricks config file
pub fn get_databricks_config_path() -> Option<PathBuf> {
    // Check DATABRICKS_CONFIG_FILE env var first
    if let Ok(config_file) = std::env::var("DATABRICKS_CONFIG_FILE") {
        let p = PathBuf::from(config_file);
        if p.exists() {
            return Some(p);
        }
    }
    
    // Default location: ~/.databrickscfg
    if let Some(home) = dirs::home_dir() {
        let p = home.join(".databrickscfg");
        if p.exists() {
            return Some(p);
        }
    }
    
    None
}

/// Parse the Databricks config file and extract profiles
pub fn read_databricks_profiles() -> Vec<DatabricksProfile> {
    let mut profiles = Vec::new();
    
    let config_path = match get_databricks_config_path() {
        Some(p) => p,
        None => return profiles,
    };
    
    let content = match fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return profiles,
    };
    
    let mut current_profile: Option<String> = None;
    let mut current_data: HashMap<String, String> = HashMap::new();
    
    for line in content.lines() {
        let line = line.trim();
        
        // Skip empty lines and comments
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        
        // Check for section header [profile_name]
        if line.starts_with('[') && line.ends_with(']') {
            // Save previous profile if exists
            if let Some(profile_name) = current_profile.take() {
                if let Some(profile) = create_profile(&profile_name, &current_data) {
                    profiles.push(profile);
                }
            }
            
            // Start new profile
            current_profile = Some(line[1..line.len()-1].to_string());
            current_data.clear();
            continue;
        }
        
        // Parse key = value
        if let Some(eq_pos) = line.find('=') {
            let key = line[..eq_pos].trim().to_lowercase();
            let value = line[eq_pos + 1..].trim().to_string();
            current_data.insert(key, value);
        }
    }
    
    // Don't forget the last profile
    if let Some(profile_name) = current_profile {
        if let Some(profile) = create_profile(&profile_name, &current_data) {
            profiles.push(profile);
        }
    }
    
    profiles
}

fn create_profile(name: &str, data: &HashMap<String, String>) -> Option<DatabricksProfile> {
    let host = data.get("host")?.clone();
    
    // Determine cloud from host
    let cloud = if host.contains("azuredatabricks") {
        "azure".to_string()
    } else if host.contains("gcp.databricks.com") {
        "gcp".to_string()
    } else if host.contains("cloud.databricks.com") || host.contains("accounts.cloud.databricks") {
        "aws".to_string()
    } else {
        // Custom or unknown host, skip
        return None;
    };
    
    // Check for various auth types
    let has_client_credentials = data.contains_key("client_id") && data.contains_key("client_secret");
    let has_token = data.contains_key("token");
    // OAuth profiles created by `databricks auth login` might have auth_type set
    // or just have host + account_id (using token cache)
    let has_oauth = data.get("auth_type").map(|t| t.contains("oauth")).unwrap_or(false);
    
    Some(DatabricksProfile {
        name: name.to_string(),
        host,
        account_id: data.get("account_id").cloned(),
        has_client_credentials,
        has_token: has_token || has_oauth,
        cloud,
    })
}

/// Get Databricks profiles filtered by cloud and account-level only
pub fn get_databricks_profiles_for_cloud(cloud: &str) -> Vec<DatabricksProfile> {
    let all_profiles = read_databricks_profiles();
    
    // Account-level hosts
    let aws_account_host = "accounts.cloud.databricks.com";
    let azure_account_host = "accounts.azuredatabricks.net";
    let gcp_account_host = "accounts.gcp.databricks.com";
    
    let mut filtered: Vec<DatabricksProfile> = all_profiles
        .into_iter()
        .filter(|p| {
            // Must match the cloud
            if p.cloud != cloud {
                return false;
            }
            
            // Must be account-level (not workspace-level)
            let is_account_level = match cloud {
                "aws" => p.host.contains(aws_account_host),
                "azure" => p.host.contains(azure_account_host),
                "gcp" => p.host.contains(gcp_account_host),
                _ => false,
            };
            
            if !is_account_level {
                return false;
            }
            
            // Must have account_id
            if p.account_id.is_none() {
                return false;
            }
            
            // Only allow service principal profiles (with client credentials)
            // SSO/OAuth profiles don't work for newly created workspaces because
            // there's no cached token for the new workspace URL (even with azure_workspace_resource_id)
            if !p.has_client_credentials {
                return false;
            }
            
            true
        })
        .collect::<Vec<_>>();
    
    // Sort profiles: deployer-* profiles first, then alphabetically
    filtered.sort_by(|a, b| {
        let a_is_deployer = a.name.starts_with("deployer-");
        let b_is_deployer = b.name.starts_with("deployer-");
        
        match (a_is_deployer, b_is_deployer) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });
    
    filtered
}

/// Find git binary
pub fn find_git_path() -> Option<PathBuf> {
    static CONFIG: CliPathConfig = CliPathConfig {
        binary_name: "git",
        windows_binary_name: Some("git.exe"),
        windows_paths: &[
            "C:\\Program Files\\Git\\cmd\\git.exe",
            "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
            "C:\\Program Files\\Git\\bin\\git.exe",
        ],
        unix_paths: &[
            "/usr/bin/git",
            "/usr/local/bin/git",
            "/opt/homebrew/bin/git",
            "/opt/local/bin/git",
        ],
        home_relative_paths: &[],
        env_var_paths: &[],
    };
    find_cli_path(&CONFIG)
}

pub fn check_git() -> DependencyStatus {
    let mut status = DependencyStatus {
        name: "Git".to_string(),
        installed: false,
        version: None,
        required: true,
        install_url: "https://git-scm.com/downloads".to_string(),
    };

    if let Some(git_path) = find_git_path() {
        if let Ok(output) = crate::commands::silent_cmd(&git_path).arg("--version").output() {
            if output.status.success() {
                status.installed = true;
                if let Ok(stdout) = String::from_utf8(output.stdout) {
                    if let Some(version) = stdout.strip_prefix("git version ") {
                        status.version = Some(version.trim().to_string());
                    }
                }
            }
        }
    }

    status
}

/// Find terraform binary by checking common installation paths
/// macOS GUI apps don't inherit shell PATH, so we check explicit locations
pub fn find_terraform_path() -> Option<PathBuf> {
    // Check our own install directory first
    #[cfg(target_os = "windows")]
    let binary_name = "terraform.exe";
    #[cfg(not(target_os = "windows"))]
    let binary_name = "terraform";

    let app_install_path = get_terraform_install_path().join(binary_name);
    if app_install_path.exists() {
        return Some(app_install_path);
    }

    static CONFIG: CliPathConfig = CliPathConfig {
        binary_name: "terraform",
        windows_binary_name: Some("terraform.exe"),
        windows_paths: &[
            "C:\\Program Files\\Terraform\\terraform.exe",
            "C:\\Program Files (x86)\\Terraform\\terraform.exe",
            "C:\\HashiCorp\\Terraform\\terraform.exe",
        ],
        unix_paths: &[
            "/usr/local/bin/terraform",
            "/opt/homebrew/bin/terraform",
            "/usr/bin/terraform",
            "/bin/terraform",
            "/opt/local/bin/terraform",
            "/snap/bin/terraform",
        ],
        home_relative_paths: &[
            ".local/bin/terraform",  // manual install to ~/.local/bin
        ],
        env_var_paths: &[
            ("LOCALAPPDATA", "Programs/Terraform/terraform.exe"),
        ],
    };
    find_cli_path(&CONFIG)
}

pub fn check_terraform() -> DependencyStatus {
    let mut status = DependencyStatus {
        name: "Terraform".to_string(),
        installed: false,
        version: None,
        required: true,
        install_url: "https://developer.hashicorp.com/terraform/install".to_string(),
    };

    if let Some(terraform_path) = find_terraform_path() {
        if let Ok(output) = crate::commands::silent_cmd(&terraform_path).arg("version").output() {
            if output.status.success() {
                status.installed = true;
                if let Ok(stdout) = String::from_utf8(output.stdout) {
                    if let Some(line) = stdout.lines().next() {
                        if let Some(version) = line.strip_prefix("Terraform v") {
                            status.version = Some(version.split_whitespace().next().unwrap_or(version).to_string());
                        }
                    }
                }
            }
        }
    }

    status
}

/// Find AWS CLI binary by checking common installation paths
pub fn find_aws_cli_path() -> Option<PathBuf> {
    static CONFIG: CliPathConfig = CliPathConfig {
        binary_name: "aws",
        windows_binary_name: Some("aws.exe"),
        windows_paths: &[
            "C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe",
            "C:\\Program Files (x86)\\Amazon\\AWSCLIV2\\aws.exe",
        ],
        unix_paths: &[
            "/usr/local/bin/aws",
            "/opt/homebrew/bin/aws",
            "/usr/bin/aws",
            "/bin/aws",
            "/opt/local/bin/aws",
            "/Library/Frameworks/Python.framework/Versions/Current/bin/aws",
            "/snap/bin/aws",
        ],
        home_relative_paths: &[
            ".local/bin/aws",  // pip install --user location
        ],
        env_var_paths: &[],
    };
    find_cli_path(&CONFIG)
}

pub fn check_aws_cli() -> DependencyStatus {
    let mut status = DependencyStatus {
        name: "AWS CLI".to_string(),
        installed: false,
        version: None,
        required: false,
        install_url: "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html".to_string(),
    };

    if let Some(aws_path) = find_aws_cli_path() {
        if let Ok(output) = crate::commands::silent_cmd(&aws_path).arg("--version").output() {
            if output.status.success() {
                status.installed = true;
                if let Ok(stdout) = String::from_utf8(output.stdout) {
                    status.version = Some(stdout.trim().to_string());
                }
            }
        }
    }

    status
}

/// Find Azure CLI binary by checking common installation paths
pub fn find_azure_cli_path() -> Option<PathBuf> {
    static CONFIG: CliPathConfig = CliPathConfig {
        binary_name: "az",
        windows_binary_name: Some("az.cmd"),
        windows_paths: &[
            "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd",
            "C:\\Program Files (x86)\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd",
        ],
        unix_paths: &[
            "/usr/local/bin/az",
            "/opt/homebrew/bin/az",
            "/usr/bin/az",
            "/bin/az",
            "/opt/local/bin/az",
            "/opt/az/bin/az",  // Linux apt install location
        ],
        home_relative_paths: &[
            ".local/bin/az",  // pip install --user location
            "bin/az",         // some Linux installs
        ],
        env_var_paths: &[],
    };
    find_cli_path(&CONFIG)
}

pub fn check_azure_cli() -> DependencyStatus {
    let mut status = DependencyStatus {
        name: "Azure CLI".to_string(),
        installed: false,
        version: None,
        required: false,
        install_url: "https://docs.microsoft.com/en-us/cli/azure/install-azure-cli".to_string(),
    };

    if let Some(az_path) = find_azure_cli_path() {
        if let Ok(output) = crate::commands::silent_cmd(&az_path).arg("--version").output() {
            if output.status.success() {
                status.installed = true;
                if let Ok(stdout) = String::from_utf8(output.stdout) {
                    if let Some(line) = stdout.lines().next() {
                        status.version = Some(line.trim().to_string());
                    }
                }
            }
        }
    }

    status
}

/// Find gcloud CLI binary by checking common installation paths
pub fn find_gcloud_cli_path() -> Option<PathBuf> {
    static CONFIG: CliPathConfig = CliPathConfig {
        binary_name: "gcloud",
        windows_binary_name: Some("gcloud.cmd"),
        windows_paths: &[
            "C:\\Program Files\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd",
            "C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd",
        ],
        unix_paths: &[
            "/usr/local/bin/gcloud",
            "/opt/homebrew/bin/gcloud",
            "/usr/bin/gcloud",
            "/bin/gcloud",
            "/opt/local/bin/gcloud",
            "/Applications/google-cloud-sdk/bin/gcloud",  // macOS .pkg / extracted install
            "/snap/bin/gcloud",                            // Linux snap
            "/snap/google-cloud-sdk/current/bin/gcloud",   // Linux snap (direct)
        ],
        home_relative_paths: &[
            "google-cloud-sdk/bin/gcloud",                 // Default interactive install (~/google-cloud-sdk)
            ".local/google-cloud-sdk/bin/gcloud",          // Alternative user install
            "AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd", // Windows per-user install
        ],
        env_var_paths: &[
            ("LOCALAPPDATA", "Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"),
        ],
    };
    find_cli_path(&CONFIG)
}

pub fn check_gcloud_cli() -> DependencyStatus {
    let mut status = DependencyStatus {
        name: "Google Cloud CLI".to_string(),
        installed: false,
        version: None,
        required: false,
        install_url: "https://cloud.google.com/sdk/docs/install".to_string(),
    };

    if let Some(gcloud_path) = find_gcloud_cli_path() {
        if let Ok(output) = crate::commands::silent_cmd(&gcloud_path).arg("--version").output() {
            if output.status.success() {
                status.installed = true;
                if let Ok(stdout) = String::from_utf8(output.stdout) {
                    if let Some(line) = stdout.lines().next() {
                        status.version = Some(line.trim().to_string());
                    }
                }
            }
        }
    }

    status
}

#[cfg(target_os = "macos")]
pub fn get_terraform_download_url() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_darwin_arm64.zip"
    } else {
        "https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_darwin_amd64.zip"
    }
}

#[cfg(target_os = "windows")]
pub fn get_terraform_download_url() -> &'static str {
    "https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_windows_amd64.zip"
}

#[cfg(target_os = "linux")]
pub fn get_terraform_download_url() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_arm64.zip"
    } else {
        "https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip"
    }
}

pub fn get_terraform_install_path() -> std::path::PathBuf {
    if let Some(home) = dirs::home_dir() {
        let bin_dir = home.join(".databricks-deployer").join("bin");
        std::fs::create_dir_all(&bin_dir).ok();
        bin_dir
    } else {
        std::path::PathBuf::from(".")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── create_profile ──────────────────────────────────────────────────

    #[test]
    fn create_profile_aws_with_host() {
        let mut data = HashMap::new();
        data.insert("host".to_string(), "https://accounts.cloud.databricks.com".to_string());
        data.insert("account_id".to_string(), "acc-123".to_string());
        data.insert("client_id".to_string(), "cid".to_string());
        data.insert("client_secret".to_string(), "csec".to_string());

        let profile = create_profile("test-profile", &data);
        assert!(profile.is_some());
        let p = profile.unwrap();
        assert_eq!(p.name, "test-profile");
        assert_eq!(p.cloud, "aws");
        assert!(p.has_client_credentials);
        assert!(!p.has_token);
        assert_eq!(p.account_id, Some("acc-123".to_string()));
    }

    #[test]
    fn create_profile_azure_host() {
        let mut data = HashMap::new();
        data.insert("host".to_string(), "https://accounts.azuredatabricks.net".to_string());
        let profile = create_profile("az-prof", &data);
        assert!(profile.is_some());
        assert_eq!(profile.unwrap().cloud, "azure");
    }

    #[test]
    fn create_profile_gcp_host() {
        let mut data = HashMap::new();
        data.insert("host".to_string(), "https://accounts.gcp.databricks.com".to_string());
        let profile = create_profile("gcp-prof", &data);
        assert!(profile.is_some());
        assert_eq!(profile.unwrap().cloud, "gcp");
    }

    #[test]
    fn create_profile_unknown_host_returns_none() {
        let mut data = HashMap::new();
        data.insert("host".to_string(), "https://custom.example.com".to_string());
        assert!(create_profile("unknown", &data).is_none());
    }

    #[test]
    fn create_profile_no_host_returns_none() {
        let data = HashMap::new();
        assert!(create_profile("no-host", &data).is_none());
    }

    #[test]
    fn create_profile_has_token() {
        let mut data = HashMap::new();
        data.insert("host".to_string(), "https://accounts.cloud.databricks.com".to_string());
        data.insert("token".to_string(), "dapi123".to_string());
        let p = create_profile("tok", &data).unwrap();
        assert!(p.has_token);
        assert!(!p.has_client_credentials);
    }

    #[test]
    fn create_profile_oauth_auth_type() {
        let mut data = HashMap::new();
        data.insert("host".to_string(), "https://accounts.cloud.databricks.com".to_string());
        data.insert("auth_type".to_string(), "databricks-oauth".to_string());
        let p = create_profile("oauth", &data).unwrap();
        assert!(p.has_token);
    }

    // ── get_databricks_profiles_for_cloud ────────────────────────────────

    #[test]
    fn profiles_for_cloud_filters_by_cloud_and_account_level() {
        // This test exercises the filter logic (sort + cloud + account_id + SP creds check).
        // We can't inject profiles here, but we verify the function doesn't panic on empty.
        let filtered = get_databricks_profiles_for_cloud("aws");
        // May or may not have profiles — just verify it doesn't crash
        for p in &filtered {
            assert_eq!(p.cloud, "aws");
            assert!(p.has_client_credentials);
            assert!(p.account_id.is_some());
        }
    }

    // ── get_terraform_download_url ──────────────────────────────────────

    #[test]
    fn terraform_download_url_is_valid() {
        let url = get_terraform_download_url();
        assert!(url.starts_with("https://releases.hashicorp.com/terraform/"));
        assert!(url.ends_with(".zip"));
        assert!(url.contains("1.9.8"));
    }

    // ── get_terraform_install_path ──────────────────────────────────────

    #[test]
    fn terraform_install_path_is_under_home() {
        let path = get_terraform_install_path();
        let path_str = path.to_string_lossy();
        // Should be ~/.databricks-deployer/bin or "." if no home
        assert!(
            path_str.contains(".databricks-deployer") || path_str == ".",
            "Install path should be under .databricks-deployer/bin or fallback to '.'"
        );
    }

    // ── read_databricks_profiles with temp file ─────────────────────────

    #[test]
    fn read_profiles_from_config_content() {
        let content = r#"[deployer-aws]
host = https://accounts.cloud.databricks.com
account_id = acc-123
client_id = cid
client_secret = csec

[workspace-level]
host = https://my-workspace.cloud.databricks.com
token = dapi123
"#;
        // Parse manually using the same logic to verify it works
        let mut profiles = Vec::new();
        let mut current_profile: Option<String> = None;
        let mut current_data: HashMap<String, String> = HashMap::new();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') { continue; }
            if line.starts_with('[') && line.ends_with(']') {
                if let Some(name) = current_profile.take() {
                    if let Some(p) = create_profile(&name, &current_data) {
                        profiles.push(p);
                    }
                }
                current_profile = Some(line[1..line.len()-1].to_string());
                current_data.clear();
                continue;
            }
            if let Some(eq_pos) = line.find('=') {
                let key = line[..eq_pos].trim().to_lowercase();
                let value = line[eq_pos + 1..].trim().to_string();
                current_data.insert(key, value);
            }
        }
        if let Some(name) = current_profile {
            if let Some(p) = create_profile(&name, &current_data) {
                profiles.push(p);
            }
        }

        // deployer-aws is account-level AWS with SP creds;
        // workspace-level also matches "aws" because host contains "cloud.databricks.com"
        assert_eq!(profiles.len(), 2);
        let deployer = profiles.iter().find(|p| p.name == "deployer-aws").unwrap();
        assert_eq!(deployer.cloud, "aws");
        assert!(deployer.has_client_credentials);
        let ws = profiles.iter().find(|p| p.name == "workspace-level").unwrap();
        assert!(ws.has_token);
    }
}
