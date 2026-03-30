//! Template management commands — setup, listing, variable parsing.

use super::{
    copy_dir_all, get_templates_dir, sanitize_template_id, Template, INTERNAL_VARIABLES,
    TEMPLATES_VERSION,
};
use crate::terraform;
use std::fs;
use tauri::{AppHandle, Manager};

const GITHUB_TEMPLATES_BASE: &str =
    "https://github.com/OgnjenPantelic/workspace-creator/tree/main/src-tauri/templates";

/// Copy bundled templates into app-data on first run (or version change).
pub fn setup_templates(app: &AppHandle) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let templates_dir = app_data_dir.join("templates");
    let version_file = app_data_dir.join(".templates_version");

    // Check if we need to update templates
    let needs_update = if templates_dir.exists() {
        match fs::read_to_string(&version_file) {
            Ok(version) => version.trim() != TEMPLATES_VERSION,
            Err(_) => true,
        }
    } else {
        true
    };

    if !needs_update {
        return Ok(());
    }

    // Remove old templates to copy fresh ones (version changed or first run)
    if templates_dir.exists() {
        fs::remove_dir_all(&templates_dir)
            .map_err(|e| format!("Failed to remove old templates: {}", e))?;
    }

    fs::create_dir_all(&templates_dir).map_err(|e| e.to_string())?;

    // Copy embedded templates
    let source_templates = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("templates"))
        .filter(|p| p.exists());

    // Try resource dir first (production), then fall back to dev location
    let templates_source = if let Some(path) = source_templates {
        path
    } else {
        // In dev builds, CARGO_MANIFEST_DIR points to src-tauri/
        let manifest_candidate =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("templates");
        if manifest_candidate.exists() {
            manifest_candidate
        } else {
            let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
            let mut search_path = exe_path.parent();

            let mut dev_templates = None;
            while let Some(path) = search_path {
                let candidate = path.join("src-tauri").join("templates");
                if candidate.exists() {
                    dev_templates = Some(candidate);
                    break;
                }
                search_path = path.parent();
            }

            match dev_templates {
                Some(path) => path,
                None => {
                    return Err(
                        "Templates not found in resource dir or src-tauri directory".to_string(),
                    )
                }
            }
        }
    };

    copy_dir_all(&templates_source, &templates_dir)?;

    // Write version file
    fs::write(&version_file, TEMPLATES_VERSION)
        .map_err(|e| format!("Failed to write version: {}", e))?;

    Ok(())
}

/// Clear cached templates and force refresh.
#[tauri::command]
pub fn clear_templates_cache(app: AppHandle) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let templates_dir = app_data_dir.join("templates");
    let version_file = app_data_dir.join(".templates_version");

    if templates_dir.exists() {
        fs::remove_dir_all(&templates_dir)
            .map_err(|e| format!("Failed to remove templates: {}", e))?;
    }

    if version_file.exists() {
        fs::remove_file(&version_file)
            .map_err(|e| format!("Failed to remove version file: {}", e))?;
    }

    setup_templates(&app)?;

    Ok("Templates cache cleared and refreshed".to_string())
}

/// List available deployment templates.
#[tauri::command]
pub fn get_templates(app: AppHandle) -> Result<Vec<Template>, String> {
    let templates_dir = get_templates_dir(&app)?;
    let mut templates = Vec::new();

    if templates_dir.join("aws-simple").exists() {
        templates.push(Template {
            id: "aws-simple".to_string(),
            name: "AWS Standard BYOVPC".to_string(),
            cloud: "aws".to_string(),
            description: "Secure baseline deployment with customer-managed VPC".to_string(),
            features: vec![
                "Customer-managed VPC (BYOVPC)".to_string(),
                "Security groups for traffic control".to_string(),
                "Private and public subnets".to_string(),
                "IAM roles and policies".to_string(),
                "S3 bucket configuration".to_string(),
                "Unity Catalog integration".to_string(),
            ],
            github_url: format!("{}/aws-simple", GITHUB_TEMPLATES_BASE),
        });
    }

    if templates_dir.join("azure-simple").exists() {
        templates.push(Template {
            id: "azure-simple".to_string(),
            name: "Azure Standard VNet".to_string(),
            cloud: "azure".to_string(),
            description: "Secure baseline deployment with VNet injection".to_string(),
            features: vec![
                "Private networking with VNet injection".to_string(),
                "Network security groups".to_string(),
                "NAT gateway for outbound access".to_string(),
                "Azure resource group isolation".to_string(),
                "Production-ready security".to_string(),
                "Unity Catalog integration".to_string(),
            ],
            github_url: format!("{}/azure-simple", GITHUB_TEMPLATES_BASE),
        });
    }

    if templates_dir.join("gcp-simple").exists() {
        templates.push(Template {
            id: "gcp-simple".to_string(),
            name: "GCP Standard BYOVPC".to_string(),
            cloud: "gcp".to_string(),
            description: "Secure baseline deployment with customer-managed VPC".to_string(),
            features: vec![
                "Customer-managed VPC (BYOVPC)".to_string(),
                "Cloud NAT for outbound access".to_string(),
                "Service account authentication".to_string(),
                "Metastore auto-detection/creation".to_string(),
                "Production-ready security".to_string(),
                "Unity Catalog integration".to_string(),
            ],
            github_url: format!("{}/gcp-simple", GITHUB_TEMPLATES_BASE),
        });
    }

    // SRA (Security Reference Architecture) templates
    if templates_dir.join("aws-sra").exists() {
        templates.push(Template {
            id: "aws-sra".to_string(),
            name: "AWS Security Reference Architecture".to_string(),
            cloud: "aws".to_string(),
            description: "Enterprise-grade security with PrivateLink, CMK encryption, and compliance controls".to_string(),
            features: vec![
                "VPC with PrivateLink (no public access)".to_string(),
                "Customer-managed keys (CMK) encryption".to_string(),
                "Security Analysis Tool (SAT)".to_string(),
                "Compliance Security Profile".to_string(),
                "Network connectivity configuration".to_string(),
                "Audit log delivery".to_string(),
                "Unity Catalog with isolated catalogs".to_string(),
            ],
            github_url: format!("{}/aws-sra", GITHUB_TEMPLATES_BASE),
        });
    }

    if templates_dir.join("azure-sra").exists() {
        templates.push(Template {
            id: "azure-sra".to_string(),
            name: "Azure Security Reference Architecture".to_string(),
            cloud: "azure".to_string(),
            description: "Enterprise-grade hub-spoke deployment with Private Endpoints and CMK encryption".to_string(),
            features: vec![
                "Hub-spoke VNet architecture".to_string(),
                "Private Endpoints (no public access)".to_string(),
                "Customer-managed keys (CMK) encryption".to_string(),
                "Azure Firewall with FQDN filtering".to_string(),
                "Security Analysis Tool (SAT)".to_string(),
                "Network Connectivity Configuration (NCC)".to_string(),
                "Unity Catalog with isolated catalogs".to_string(),
            ],
            github_url: format!("{}/azure-sra", GITHUB_TEMPLATES_BASE),
        });
    }

    if templates_dir.join("azure-pl-sts").exists() {
        templates.push(Template {
            id: "azure-pl-sts".to_string(),
            name: "Azure Private Link".to_string(),
            cloud: "azure".to_string(),
            description: "Private Link workspace with backend and DBFS private endpoints, DNS zones, and serverless NCC".to_string(),
            features: vec![
                "Backend Private Link (control plane)".to_string(),
                "DBFS Private Endpoint".to_string(),
                "Private DNS zones".to_string(),
                "Serverless NCC with Private Link".to_string(),
                "VNet injection with dedicated subnets".to_string(),
            ],
            github_url: "https://github.com/databricks-solutions/technical-services-solutions/tree/main/workspace-setup/terraform-examples/azure/azure-privatelink-classic/tf".to_string(),
        });
    }

    if templates_dir.join("gcp-sra").exists() {
        templates.push(Template {
            id: "gcp-sra".to_string(),
            name: "GCP Security Reference Architecture".to_string(),
            cloud: "gcp".to_string(),
            description: "Enterprise-grade security with Private Service Connect, CMEK, and hardened firewall".to_string(),
            features: vec![
                "Private Service Connect (PSC)".to_string(),
                "Customer-managed encryption keys (CMEK)".to_string(),
                "Hardened VPC firewall rules".to_string(),
                "IP access list restrictions".to_string(),
                "Private access settings".to_string(),
                "Service account impersonation".to_string(),
                "Modular workspace deployment".to_string(),
            ],
            github_url: format!("{}/gcp-sra", GITHUB_TEMPLATES_BASE),
        });
    }

    Ok(templates)
}

/// Parse and return the Terraform variables for a given template.
#[tauri::command]
pub fn get_template_variables(
    app: AppHandle,
    template_id: String,
) -> Result<Vec<terraform::TerraformVariable>, String> {
    let safe_template_id = sanitize_template_id(&template_id)?;

    let templates_dir = get_templates_dir(&app)?;
    let variables_path = templates_dir.join(&safe_template_id).join("variables.tf");

    if !variables_path.exists() {
        return Err(format!("Template not found: {}", safe_template_id));
    }

    let content = fs::read_to_string(&variables_path).map_err(|e| e.to_string())?;
    let variables = terraform::parse_variables_tf(&content);

    // Filter out internal variables that are automatically set by the app
    let filtered_variables: Vec<terraform::TerraformVariable> = variables
        .into_iter()
        .filter(|v| !INTERNAL_VARIABLES.contains(&v.name.as_str()))
        .collect();

    Ok(filtered_variables)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn real_templates_dir() -> PathBuf {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        PathBuf::from(manifest_dir).join("templates")
    }

    // ── Real template parsing: azure-simple ─────────────────────────────

    #[test]
    fn parse_azure_simple_template() {
        let variables_path = real_templates_dir().join("azure-simple").join("variables.tf");
        let content = fs::read_to_string(&variables_path)
            .expect("azure-simple/variables.tf should exist");
        let vars = terraform::parse_variables_tf(&content);

        assert!(vars.len() >= 20, "azure-simple should have many variables, got {}", vars.len());

        let names: Vec<&str> = vars.iter().map(|v| v.name.as_str()).collect();
        assert!(names.contains(&"tenant_id"));
        assert!(names.contains(&"azure_subscription_id"));
        assert!(names.contains(&"workspace_name"));
        assert!(names.contains(&"databricks_account_id"));
        assert!(names.contains(&"location"));
        assert!(names.contains(&"resource_group_name"));
        assert!(names.contains(&"cidr"));
    }

    #[test]
    fn azure_simple_required_variables() {
        let variables_path = real_templates_dir().join("azure-simple").join("variables.tf");
        let content = fs::read_to_string(&variables_path).unwrap();
        let vars = terraform::parse_variables_tf(&content);

        let tenant_id = vars.iter().find(|v| v.name == "tenant_id").unwrap();
        assert!(tenant_id.required, "tenant_id should be required (no default)");

        let workspace_name = vars.iter().find(|v| v.name == "workspace_name").unwrap();
        assert!(workspace_name.required, "workspace_name should be required");
    }

    #[test]
    fn azure_simple_optional_variables() {
        let variables_path = real_templates_dir().join("azure-simple").join("variables.tf");
        let content = fs::read_to_string(&variables_path).unwrap();
        let vars = terraform::parse_variables_tf(&content);

        let create_rg = vars.iter().find(|v| v.name == "create_new_resource_group").unwrap();
        assert!(!create_rg.required, "create_new_resource_group has a default");
        assert_eq!(create_rg.default.as_deref(), Some("true"));

        let cidr = vars.iter().find(|v| v.name == "cidr").unwrap();
        assert!(!cidr.required, "cidr has a default");
        assert_eq!(cidr.default.as_deref(), Some("10.0.0.0/20"));
    }

    #[test]
    fn azure_simple_sensitive_variables() {
        let variables_path = real_templates_dir().join("azure-simple").join("variables.tf");
        let content = fs::read_to_string(&variables_path).unwrap();
        let vars = terraform::parse_variables_tf(&content);

        let account_id = vars.iter().find(|v| v.name == "databricks_account_id").unwrap();
        assert!(!account_id.sensitive, "databricks_account_id is an identifier, not a secret");

        let client_secret = vars.iter().find(|v| v.name == "databricks_client_secret").unwrap();
        assert!(client_secret.sensitive, "databricks_client_secret should be sensitive");
    }

    #[test]
    fn azure_simple_map_and_bool_types() {
        let variables_path = real_templates_dir().join("azure-simple").join("variables.tf");
        let content = fs::read_to_string(&variables_path).unwrap();
        let vars = terraform::parse_variables_tf(&content);

        let tags = vars.iter().find(|v| v.name == "tags").unwrap();
        assert!(tags.var_type.contains("map"), "tags should be map type");

        let create_vnet = vars.iter().find(|v| v.name == "create_new_vnet").unwrap();
        assert!(create_vnet.var_type.contains("bool"), "create_new_vnet should be bool type");
    }

    // ── Real template parsing: aws-simple ───────────────────────────────

    #[test]
    fn parse_aws_simple_template() {
        let variables_path = real_templates_dir().join("aws-simple").join("variables.tf");
        let content = fs::read_to_string(&variables_path)
            .expect("aws-simple/variables.tf should exist");
        let vars = terraform::parse_variables_tf(&content);

        assert!(!vars.is_empty(), "aws-simple should have variables");

        let names: Vec<&str> = vars.iter().map(|v| v.name.as_str()).collect();
        assert!(names.contains(&"databricks_account_id"));
    }

    // ── Real template parsing: gcp-simple ───────────────────────────────

    #[test]
    fn parse_gcp_simple_template() {
        let variables_path = real_templates_dir().join("gcp-simple").join("variables.tf");
        let content = fs::read_to_string(&variables_path)
            .expect("gcp-simple/variables.tf should exist");
        let vars = terraform::parse_variables_tf(&content);

        assert!(!vars.is_empty(), "gcp-simple should have variables");

        let names: Vec<&str> = vars.iter().map(|v| v.name.as_str()).collect();
        assert!(names.contains(&"google_project_name"));
        assert!(names.contains(&"gcp_auth_method"));
        assert!(names.contains(&"google_credentials_json"));
    }

    // ── INTERNAL_VARIABLES filtering ────────────────────────────────────

    #[test]
    fn internal_variables_filtered_from_gcp() {
        let variables_path = real_templates_dir().join("gcp-simple").join("variables.tf");
        let content = fs::read_to_string(&variables_path).unwrap();
        let all_vars = terraform::parse_variables_tf(&content);

        let filtered: Vec<_> = all_vars
            .into_iter()
            .filter(|v| !INTERNAL_VARIABLES.contains(&v.name.as_str()))
            .collect();

        let filtered_names: Vec<&str> = filtered.iter().map(|v| v.name.as_str()).collect();
        assert!(!filtered_names.contains(&"gcp_auth_method"), "gcp_auth_method should be filtered");
        assert!(!filtered_names.contains(&"google_credentials_json"), "google_credentials_json should be filtered");
        assert!(filtered_names.contains(&"google_project_name"), "google_project_name should NOT be filtered");
    }

    #[test]
    fn internal_variables_no_effect_on_azure() {
        let variables_path = real_templates_dir().join("azure-simple").join("variables.tf");
        let content = fs::read_to_string(&variables_path).unwrap();
        let all_vars = terraform::parse_variables_tf(&content);
        let all_count = all_vars.len();

        let internal_in_template = all_vars
            .iter()
            .filter(|v| INTERNAL_VARIABLES.contains(&v.name.as_str()))
            .count();

        let filtered: Vec<_> = all_vars
            .into_iter()
            .filter(|v| !INTERNAL_VARIABLES.contains(&v.name.as_str()))
            .collect();

        assert_eq!(
            filtered.len(),
            all_count - internal_in_template,
            "Only INTERNAL_VARIABLES should be filtered (workspace_url_override)"
        );
    }

    // ── Template copy + parse integration ───────────────────────────────

    #[test]
    fn copy_template_and_parse_variables() {
        let template_src = real_templates_dir().join("azure-simple");
        let tmp = tempfile::tempdir().unwrap();
        let deployment_dir = tmp.path().join("my-deployment");

        copy_dir_all(&template_src, &deployment_dir).unwrap();

        let vars_path = deployment_dir.join("variables.tf");
        assert!(vars_path.exists(), "variables.tf should exist after copy");

        let content = fs::read_to_string(&vars_path).unwrap();
        let vars = terraform::parse_variables_tf(&content);
        assert!(vars.len() >= 20, "parsed variables should match source");
    }

    // ── Template copy + generate tfvars integration ─────────────────────

    #[test]
    fn copy_template_and_generate_tfvars() {
        let template_src = real_templates_dir().join("azure-simple");
        let tmp = tempfile::tempdir().unwrap();
        let deployment_dir = tmp.path().join("my-deploy");

        copy_dir_all(&template_src, &deployment_dir).unwrap();

        let content = fs::read_to_string(deployment_dir.join("variables.tf")).unwrap();
        let variables = terraform::parse_variables_tf(&content);

        let mut values = std::collections::HashMap::new();
        values.insert("tenant_id".to_string(), serde_json::json!("my-tenant-id"));
        values.insert("azure_subscription_id".to_string(), serde_json::json!("my-sub-id"));
        values.insert("workspace_name".to_string(), serde_json::json!("test-workspace"));
        values.insert("databricks_account_id".to_string(), serde_json::json!("acc-123"));
        values.insert("resource_group_name".to_string(), serde_json::json!("rg-test"));
        values.insert("location".to_string(), serde_json::json!("eastus"));
        values.insert("root_storage_name".to_string(), serde_json::json!("rootstorage"));
        values.insert("admin_user".to_string(), serde_json::json!("admin@test.com"));
        values.insert("subnet_public_cidr".to_string(), serde_json::json!("10.0.0.0/22"));
        values.insert("subnet_private_cidr".to_string(), serde_json::json!("10.0.4.0/22"));

        let tfvars_content = terraform::generate_tfvars(&values, &variables);
        let tfvars_path = deployment_dir.join("terraform.tfvars");
        fs::write(&tfvars_path, &tfvars_content).unwrap();

        let written = fs::read_to_string(&tfvars_path).unwrap();
        assert!(written.contains("tenant_id = \"my-tenant-id\""));
        assert!(written.contains("workspace_name = \"test-workspace\""));
        assert!(written.contains("location = \"eastus\""));
        assert!(written.contains("admin_user = \"admin@test.com\""));
        assert!(written.contains("subnet_public_cidr = \"10.0.0.0/22\""));
    }

    #[test]
    fn generate_tfvars_with_bool_and_map_values() {
        let template_src = real_templates_dir().join("azure-simple");
        let tmp = tempfile::tempdir().unwrap();
        let deployment_dir = tmp.path().join("deploy-2");

        copy_dir_all(&template_src, &deployment_dir).unwrap();

        let content = fs::read_to_string(deployment_dir.join("variables.tf")).unwrap();
        let variables = terraform::parse_variables_tf(&content);

        let mut values = std::collections::HashMap::new();
        values.insert("tenant_id".to_string(), serde_json::json!("tid"));
        values.insert("azure_subscription_id".to_string(), serde_json::json!("sid"));
        values.insert("workspace_name".to_string(), serde_json::json!("ws"));
        values.insert("databricks_account_id".to_string(), serde_json::json!("acc"));
        values.insert("resource_group_name".to_string(), serde_json::json!("rg"));
        values.insert("location".to_string(), serde_json::json!("westeurope"));
        values.insert("root_storage_name".to_string(), serde_json::json!("storage"));
        values.insert("admin_user".to_string(), serde_json::json!("admin@test.com"));
        values.insert("subnet_public_cidr".to_string(), serde_json::json!("10.0.0.0/22"));
        values.insert("subnet_private_cidr".to_string(), serde_json::json!("10.0.4.0/22"));
        values.insert("create_new_vnet".to_string(), serde_json::json!(false));
        values.insert("create_unity_catalog".to_string(), serde_json::json!(true));

        let tfvars = terraform::generate_tfvars(&values, &variables);
        assert!(tfvars.contains("create_new_vnet = false"));
        assert!(tfvars.contains("create_unity_catalog = true"));
    }
}
