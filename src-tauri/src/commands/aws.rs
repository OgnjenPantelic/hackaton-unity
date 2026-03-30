//! AWS authentication and permission checking commands.

use super::{CloudCredentials, CloudPermissionCheck};
use crate::dependencies;
use serde::{Deserialize, Serialize};
use std::fs;

/// AWS CLI profile entry.
#[derive(Debug, Serialize, Deserialize)]
pub struct AwsProfile {
    pub name: String,
    pub is_sso: bool,
}

/// AWS STS caller identity.
#[derive(Debug, Serialize, Deserialize)]
pub struct AwsIdentity {
    pub account: String,
    pub arn: String,
    pub user_id: String,
}

/// Validate AWS profile name to prevent CLI injection.
fn validate_aws_profile_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// List AWS profiles from `~/.aws/config` and `~/.aws/credentials`.
#[tauri::command]
pub fn get_aws_profiles() -> Vec<AwsProfile> {
    let mut profiles = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Some(home) = dirs::home_dir() {
        // Parse ~/.aws/config
        let config_path = home.join(".aws").join("config");
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(&config_path) {
                let mut current_name: Option<String> = None;
                let mut profile_sso: std::collections::HashMap<String, bool> =
                    std::collections::HashMap::new();

                for line in content.lines() {
                    let line = line.trim();
                    if line.starts_with('[') && line.ends_with(']') {
                        let section = &line[1..line.len() - 1];
                        if section.starts_with("sso-session ") {
                            current_name = None;
                            continue;
                        }
                        let name = if section.starts_with("profile ") {
                            section.strip_prefix("profile ").unwrap().to_string()
                        } else {
                            section.to_string()
                        };
                        profile_sso.entry(name.clone()).or_insert(false);
                        current_name = Some(name);
                    } else if let Some(ref name) = current_name {
                        if line.starts_with("sso_start_url") || line.starts_with("sso_session") {
                            profile_sso.insert(name.clone(), true);
                        }
                    }
                }

                for (name, is_sso) in &profile_sso {
                    if !seen.contains(name) {
                        profiles.push(AwsProfile {
                            name: name.clone(),
                            is_sso: *is_sso,
                        });
                        seen.insert(name.clone());
                    }
                }
            }
        }

        // Parse ~/.aws/credentials for additional profiles
        let creds_path = home.join(".aws").join("credentials");
        if creds_path.exists() {
            if let Ok(content) = fs::read_to_string(&creds_path) {
                for line in content.lines() {
                    let line = line.trim();
                    if line.starts_with('[') && line.ends_with(']') {
                        let name = line[1..line.len() - 1].to_string();
                        if !seen.contains(&name) {
                            profiles.push(AwsProfile {
                                name: name.clone(),
                                is_sso: false,
                            });
                            seen.insert(name);
                        }
                    }
                }
            }
        }
    }

    // Ensure "default" is first if it exists
    profiles.sort_by(|a, b| {
        if a.name == "default" {
            std::cmp::Ordering::Less
        } else if b.name == "default" {
            std::cmp::Ordering::Greater
        } else {
            a.name.cmp(&b.name)
        }
    });

    profiles
}

/// Get AWS identity for a profile using `aws sts get-caller-identity`.
#[tauri::command]
pub async fn get_aws_identity(profile: String) -> Result<AwsIdentity, String> {
    if !profile.is_empty() && !validate_aws_profile_name(&profile) {
        return Err("Invalid AWS profile name".to_string());
    }

    let aws_path =
        dependencies::find_aws_cli_path().ok_or_else(|| crate::errors::cli_not_found("AWS CLI"))?;

    let mut cmd = super::silent_cmd(&aws_path);
    cmd.args(["sts", "get-caller-identity", "--output", "json"]);

    if !profile.is_empty() {
        cmd.args(["--profile", &profile]);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run AWS CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("expired") || stderr.contains("Token") {
            return Err(crate::errors::auth_expired("AWS"));
        }
        return Err(format!("Not authenticated: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(AwsIdentity {
        account: json["Account"].as_str().unwrap_or("").to_string(),
        arn: json["Arn"].as_str().unwrap_or("").to_string(),
        user_id: json["UserId"].as_str().unwrap_or("").to_string(),
    })
}

/// Trigger AWS SSO login for a profile. Supports cancellation via `cancel_cli_login`.
#[tauri::command]
pub async fn aws_sso_login(profile: String) -> Result<String, String> {
    use super::CLI_LOGIN_PROCESS;
    use std::time::{Duration, Instant};

    if !profile.is_empty() && !validate_aws_profile_name(&profile) {
        return Err("Invalid AWS profile name".to_string());
    }

    let aws_path =
        dependencies::find_aws_cli_path().ok_or_else(|| crate::errors::cli_not_found("AWS CLI"))?;

    let mut cmd = super::silent_cmd(&aws_path);
    cmd.args(["sso", "login"]);

    if !profile.is_empty() {
        cmd.args(["--profile", &profile]);
    }

    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run AWS CLI: {}", e))?;

    super::acquire_login_slot(child.id()).map_err(|e| {
        let _ = child.kill();
        e
    })?;

    let timeout = Duration::from_secs(300);
    let start = Instant::now();

    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().map_err(|e| format!("Failed to read output: {}", e))?;
                if !status.success() {
                    let was_cancelled = super::lock_or_recover(&CLI_LOGIN_PROCESS).is_none();
                    if was_cancelled {
                        break Err("LOGIN_CANCELLED".to_string());
                    }
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let stderr_str = stderr.trim();
                    if stderr_str.is_empty() || stderr_str.contains("Killed") || stderr_str.contains("terminated") {
                        break Err("LOGIN_CANCELLED".to_string());
                    }
                    break Err(format!("SSO login failed: {}", stderr_str));
                }
                break Ok("SSO login completed successfully.".to_string());
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    break Err("SSO login timed out after 5 minutes. Please try again.".to_string());
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            Err(e) => break Err(format!("Error waiting for AWS CLI: {}", e)),
        }
    };

    super::release_login_slot();

    result
}

/// Apply AWS credentials from a `CloudCredentials` struct to a `Command` as env vars.
/// Validates the profile name if present.
fn apply_aws_credentials(cmd: &mut std::process::Command, credentials: &CloudCredentials) -> Result<(), String> {
    if let Some(profile) = &credentials.aws_profile {
        if !profile.is_empty() {
            if !validate_aws_profile_name(profile) {
                return Err("Invalid AWS profile name".to_string());
            }
            cmd.env("AWS_PROFILE", profile);
        }
    }
    if let Some(key) = &credentials.aws_access_key_id {
        if !key.is_empty() {
            cmd.env("AWS_ACCESS_KEY_ID", key);
        }
    }
    if let Some(secret) = &credentials.aws_secret_access_key {
        if !secret.is_empty() {
            cmd.env("AWS_SECRET_ACCESS_KEY", secret);
        }
    }
    if let Some(token) = &credentials.aws_session_token {
        if !token.is_empty() {
            cmd.env("AWS_SESSION_TOKEN", token);
        }
    }
    Ok(())
}

/// AWS VPC descriptor for CIDR overlap detection.
#[derive(Debug, Clone, Serialize)]
pub struct AwsVpc {
    pub vpc_id: String,
    pub name: String,
    pub cidr_block: String,
}

/// List AWS VPCs in a region. Supports both profile and access-key auth via CloudCredentials.
#[tauri::command]
pub async fn get_aws_vpcs(credentials: CloudCredentials) -> Result<Vec<AwsVpc>, String> {
    let aws_cli = match dependencies::find_aws_cli_path() {
        Some(path) => path,
        None => return Ok(vec![]),
    };

    let region = credentials
        .aws_region
        .as_ref()
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| "us-east-1".to_string());

    let mut cmd = super::silent_cmd(&aws_cli);
    cmd.args(["ec2", "describe-vpcs", "--region", &region, "--output", "json"]);
    apply_aws_credentials(&mut cmd, &credentials)?;

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run AWS CLI: {}", e))?;

    if !output.status.success() {
        return Ok(vec![]);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse VPCs: {}", e))?;

    let empty = vec![];
    let vpcs: Vec<AwsVpc> = json["Vpcs"]
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .map(|v| {
            let name = v["Tags"]
                .as_array()
                .and_then(|tags| {
                    tags.iter().find(|t| t["Key"].as_str() == Some("Name"))
                        .and_then(|t| t["Value"].as_str())
                })
                .unwrap_or("")
                .to_string();
            AwsVpc {
                vpc_id: v["VpcId"].as_str().unwrap_or("").to_string(),
                name,
                cidr_block: v["CidrBlock"].as_str().unwrap_or("").to_string(),
            }
        })
        .collect();

    Ok(vpcs)
}

/// Check AWS IAM permissions using the IAM Policy Simulator.
#[tauri::command]
pub async fn check_aws_permissions(
    credentials: CloudCredentials,
) -> Result<CloudPermissionCheck, String> {
    let required_actions = vec![
        "ec2:CreateVpc",
        "ec2:CreateSubnet",
        "ec2:CreateInternetGateway",
        "ec2:AttachInternetGateway",
        "ec2:CreateNatGateway",
        "ec2:AllocateAddress",
        "ec2:CreateRouteTable",
        "ec2:CreateRoute",
        "ec2:AssociateRouteTable",
        "ec2:CreateSecurityGroup",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:AuthorizeSecurityGroupEgress",
        "s3:CreateBucket",
        "s3:PutBucketPolicy",
        "s3:PutBucketEncryption",
        "s3:PutBucketPublicAccessBlock",
        "s3:PutBucketVersioning",
        "iam:CreateRole",
        "iam:AttachRolePolicy",
        "iam:PutRolePolicy",
        "iam:CreateInstanceProfile",
        "iam:AddRoleToInstanceProfile",
        "iam:PassRole",
    ];

    let aws_cli = match dependencies::find_aws_cli_path() {
        Some(path) => path,
        None => {
            return Ok(CloudPermissionCheck {
                has_all_permissions: true,
                checked_permissions: vec![],
                missing_permissions: vec![],
                message: "AWS CLI not installed. Permission check skipped.".to_string(),
                is_warning: true,
            });
        }
    };

    // Get caller identity to obtain the ARN
    let mut identity_cmd = super::silent_cmd(&aws_cli);
    identity_cmd.args(["sts", "get-caller-identity", "--output", "json"]);
    apply_aws_credentials(&mut identity_cmd, &credentials)?;

    let identity_output = identity_cmd
        .output()
        .map_err(|e| format!("Failed to get AWS identity: {}", e))?;

    if !identity_output.status.success() {
        let stderr = String::from_utf8_lossy(&identity_output.stderr);
        return Err(format!(
            "Invalid AWS credentials: {}",
            stderr.trim()
        ));
    }

    let identity_json: serde_json::Value = serde_json::from_slice(&identity_output.stdout)
        .map_err(|e| format!("Failed to parse identity: {}", e))?;

    let caller_arn = identity_json["Arn"]
        .as_str()
        .ok_or("No ARN in identity response")?;

    // Build the simulate-principal-policy command
    let mut simulate_cmd = super::silent_cmd(&aws_cli);
    simulate_cmd.args([
        "iam",
        "simulate-principal-policy",
        "--policy-source-arn",
        caller_arn,
        "--action-names",
    ]);

    for action in &required_actions {
        simulate_cmd.arg(action);
    }
    simulate_cmd.args(["--output", "json"]);
    apply_aws_credentials(&mut simulate_cmd, &credentials)?;

    let simulate_output = simulate_cmd
        .output()
        .map_err(|e| format!("Failed to simulate policy: {}", e))?;

    if !simulate_output.status.success() {
        let stderr = String::from_utf8_lossy(&simulate_output.stderr);

        if stderr.contains("AccessDenied") || stderr.contains("not authorized") {
            return Ok(CloudPermissionCheck {
                has_all_permissions: true,
                checked_permissions: vec![],
                missing_permissions: vec![],
                message: "Unable to check permissions (missing iam:SimulatePrincipalPolicy). Proceeding without verification.".to_string(),
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

    // Parse simulation results
    let results_json: serde_json::Value = serde_json::from_slice(&simulate_output.stdout)
        .map_err(|e| format!("Failed to parse simulation results: {}", e))?;

    let mut checked_permissions = Vec::new();
    let mut missing_permissions = Vec::new();

    if let Some(evaluations) = results_json["EvaluationResults"].as_array() {
        for eval in evaluations {
            let action = eval["EvalActionName"].as_str().unwrap_or("unknown");
            let decision = eval["EvalDecision"].as_str().unwrap_or("unknown");

            checked_permissions.push(action.to_string());

            if decision != "allowed" {
                missing_permissions.push(action.to_string());
            }
        }
    }

    let has_all = missing_permissions.is_empty();
    let message = if has_all {
        "All required AWS permissions verified.".to_string()
    } else {
        format!(
            "Missing {} permission(s): {}. This might be a false positive if you have custom IAM policies.",
            missing_permissions.len(),
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

    // ── validate_aws_profile_name ───────────────────────────────────────

    #[test]
    fn valid_profile_name_simple() {
        assert!(validate_aws_profile_name("default"));
    }

    #[test]
    fn valid_profile_name_with_hyphens() {
        assert!(validate_aws_profile_name("my-profile"));
    }

    #[test]
    fn valid_profile_name_with_underscores() {
        assert!(validate_aws_profile_name("my_profile"));
    }

    #[test]
    fn valid_profile_name_with_dots() {
        assert!(validate_aws_profile_name("dev.us-east-1"));
    }

    #[test]
    fn invalid_profile_name_empty() {
        assert!(!validate_aws_profile_name(""));
    }

    #[test]
    fn invalid_profile_name_too_long() {
        let long = "a".repeat(65);
        assert!(!validate_aws_profile_name(&long));
    }

    #[test]
    fn valid_profile_name_max_length() {
        let exact = "a".repeat(64);
        assert!(validate_aws_profile_name(&exact));
    }

    #[test]
    fn invalid_profile_name_special_chars() {
        assert!(!validate_aws_profile_name("profile;rm -rf /"));
    }

    #[test]
    fn invalid_profile_name_spaces() {
        assert!(!validate_aws_profile_name("my profile"));
    }

    #[test]
    fn invalid_profile_name_path_traversal() {
        assert!(!validate_aws_profile_name("../etc/passwd"));
    }
}
