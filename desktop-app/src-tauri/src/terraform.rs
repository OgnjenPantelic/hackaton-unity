use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerraformVariable {
    pub name: String,
    pub description: String,
    pub var_type: String,
    pub default: Option<String>,
    pub required: bool,
    pub sensitive: bool,
    pub validation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentStatus {
    pub running: bool,
    pub command: Option<String>,
    pub output: String,
    pub success: Option<bool>,
    pub can_rollback: bool,
}

impl Default for DeploymentStatus {
    fn default() -> Self {
        Self {
            running: false,
            command: None,
            output: String::new(),
            success: None,
            can_rollback: false,
        }
    }
}

lazy_static::lazy_static! {
    pub static ref DEPLOYMENT_STATUS: Arc<Mutex<DeploymentStatus>> = Arc::new(Mutex::new(DeploymentStatus::default()));
    pub static ref CURRENT_PROCESS: Arc<Mutex<Option<u32>>> = Arc::new(Mutex::new(None));
}

pub fn parse_variables_tf(content: &str) -> Vec<TerraformVariable> {
    let mut variables = Vec::new();
    let mut current_var: Option<TerraformVariable> = None;
    let mut in_variable_block = false;
    let mut brace_count = 0;
    let mut current_description = String::new();
    let mut current_type = String::from("string");
    let mut current_default: Option<String> = None;
    let mut is_sensitive = false;
    let mut current_validation: Option<String> = None;
    
    // Track multiline default value parsing
    let mut in_multiline_default = false;
    let mut default_brace_count = 0;
    let mut default_bracket_count = 0;
    let mut multiline_default_buffer = String::new();

    for line in content.lines() {
        let trimmed = line.trim();

        // Start of variable block
        if !in_variable_block && trimmed.starts_with("variable ") && trimmed.contains('{') {
            in_variable_block = true;
            brace_count = 1;
            
            // Extract variable name
            if let Some(name_start) = trimmed.find('"') {
                if let Some(name_end) = trimmed[name_start + 1..].find('"') {
                    let name = &trimmed[name_start + 1..name_start + 1 + name_end];
                    current_var = Some(TerraformVariable {
                        name: name.to_string(),
                        description: String::new(),
                        var_type: "string".to_string(),
                        default: None,
                        required: true,
                        sensitive: false,
                        validation: None,
                    });
                }
            }
            current_description.clear();
            current_type = String::from("string");
            current_default = None;
            is_sensitive = false;
            current_validation = None;
            in_multiline_default = false;
            default_brace_count = 0;
            default_bracket_count = 0;
            multiline_default_buffer.clear();
            continue;
        }

        if in_variable_block {
            // Parse multiline default values (maps/lists) by tracking brace/bracket balance
            if in_multiline_default {
                multiline_default_buffer.push_str(trimmed);
                multiline_default_buffer.push(' ');
                
                default_brace_count += trimmed.matches('{').count() as i32;
                default_brace_count -= trimmed.matches('}').count() as i32;
                default_bracket_count += trimmed.matches('[').count() as i32;
                default_bracket_count -= trimmed.matches(']').count() as i32;
                
                // Check if multiline default is complete
                if default_brace_count <= 0 && default_bracket_count <= 0 {
                    in_multiline_default = false;
                    // For complex defaults (maps/lists), just mark as having a default
                    // We don't need to parse the actual value for the UI
                    current_default = Some(multiline_default_buffer.trim().to_string());
                }
                
                // Still count braces for the variable block
                brace_count += trimmed.matches('{').count() as i32;
                brace_count -= trimmed.matches('}').count() as i32;
            } else {
                // Count braces for variable block
                brace_count += trimmed.matches('{').count() as i32;
                brace_count -= trimmed.matches('}').count() as i32;

                // Parse attributes (only at brace_count == 1, i.e., top level of variable)
                if brace_count >= 1 {
                    if trimmed.starts_with("description") {
                        if let Some(val) = extract_string_value(trimmed) {
                            current_description = val;
                        }
                    } else if trimmed.starts_with("type") {
                        if let Some(val) = extract_type_value(trimmed) {
                            current_type = val;
                        }
                    } else if trimmed.starts_with("default") {
                        // Check if this is a multiline default
                        let after_eq = trimmed.split_once('=').map(|(_, v)| v.trim()).unwrap_or("");
                        
                        if after_eq.starts_with('{') || after_eq.starts_with('[') {
                            // Count opening/closing braces/brackets on this line
                            let open_braces = after_eq.matches('{').count() as i32;
                            let close_braces = after_eq.matches('}').count() as i32;
                            let open_brackets = after_eq.matches('[').count() as i32;
                            let close_brackets = after_eq.matches(']').count() as i32;
                            
                            if open_braces > close_braces || open_brackets > close_brackets {
                                // Multiline default starts here
                                in_multiline_default = true;
                                default_brace_count = open_braces - close_braces;
                                default_bracket_count = open_brackets - close_brackets;
                                multiline_default_buffer = after_eq.to_string();
                                multiline_default_buffer.push(' ');
                            } else {
                                // Single-line complex default
                                current_default = Some(after_eq.to_string());
                            }
                        } else {
                            // Simple default value
                            current_default = extract_default_value(trimmed);
                        }
                    } else if trimmed.starts_with("sensitive") && trimmed.contains("true") {
                        is_sensitive = true;
                    } else if trimmed.starts_with("condition") {
                        if let Some(val) = extract_string_value(line) {
                            current_validation = Some(val);
                        }
                    }
                }
            }

            // End of variable block
            if brace_count == 0 && !in_multiline_default {
                if let Some(mut var) = current_var.take() {
                    var.description = current_description.clone();
                    var.var_type = current_type.clone();
                    var.default = current_default.clone();
                    var.required = current_default.is_none();
                    var.sensitive = is_sensitive;
                    var.validation = current_validation.clone();
                    variables.push(var);
                }
                in_variable_block = false;
            }
        }
    }

    variables
}

fn extract_string_value(line: &str) -> Option<String> {
    if let Some(start) = line.find('"') {
        if let Some(end) = line[start + 1..].rfind('"') {
            return Some(line[start + 1..start + 1 + end].to_string());
        }
    }
    None
}

fn extract_type_value(line: &str) -> Option<String> {
    let line = line.trim();
    if let Some(idx) = line.find('=') {
        let type_part = line[idx + 1..].trim();
        return Some(type_part.to_string());
    }
    None
}

fn extract_default_value(line: &str) -> Option<String> {
    let line = line.trim();
    if let Some(idx) = line.find('=') {
        let value_part = line[idx + 1..].trim();
        // Handle quoted strings
        if value_part.starts_with('"') && value_part.ends_with('"') {
            return Some(value_part[1..value_part.len() - 1].to_string());
        }
        // Handle other values
        if !value_part.is_empty() && value_part != "{" && value_part != "[" {
            return Some(value_part.to_string());
        }
    }
    None
}

pub fn generate_tfvars(values: &HashMap<String, serde_json::Value>, variables: &[TerraformVariable]) -> String {
    let mut lines = Vec::new();
    
    for var in variables {
        if let Some(value) = values.get(&var.name) {
            // Skip empty strings for required variables (no default)
            if let serde_json::Value::String(s) = value {
                if s.trim().is_empty() && var.default.is_none() {
                    continue;
                }
                // Skip Terraform null literals (parsed from `default = null`)
                let trimmed = s.trim();
                if trimmed == "null" || trimmed.starts_with("null ") {
                    continue;
                }
            }
            
            let var_type = var.var_type.to_lowercase();
            
            let formatted = match value {
                serde_json::Value::String(s) => {
                    // Check if the variable type is map or list and try to parse the string
                    if var_type.starts_with("map") || var_type.contains("map(") {
                        if let Ok(obj) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(s) {
                            format_map(&var.name, &obj)
                        } else if s.trim().is_empty() || s.trim() == "{}" {
                            format!("{} = {{}}", var.name)
                        } else if s.trim().starts_with('{') {
                            // HCL literal — skip, let Terraform use its default
                            continue;
                        } else {
                            format!("{} = \"{}\"", var.name, s)
                        }
                    } else if var_type.starts_with("object") || var_type.contains("object(") {
                        if let Ok(obj) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(s) {
                            format_map(&var.name, &obj)
                        } else if s.trim().is_empty() || s.trim() == "{}" {
                            format!("{} = {{}}", var.name)
                        } else if s.trim().starts_with('{') {
                            continue;
                        } else {
                            format!("{} = \"{}\"", var.name, s)
                        }
                    } else if var_type.starts_with("list") || var_type.contains("list(") || var_type.starts_with("set") || var_type.contains("set(") {
                        if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(s) {
                            format_list(&var.name, &arr)
                        } else if s.trim().is_empty() || s.trim() == "[]" {
                            format!("{} = []", var.name)
                        } else if s.trim().starts_with('[') {
                            // HCL literal that isn't valid JSON — skip, let Terraform use default
                            continue;
                        } else {
                            format!("{} = \"{}\"", var.name, s)
                        }
                    } else if var_type == "bool" {
                        // Handle boolean strings - output without quotes
                        let bool_val = s.to_lowercase();
                        if bool_val == "true" || bool_val == "false" {
                            format!("{} = {}", var.name, bool_val)
                        } else {
                            format!("{} = \"{}\"", var.name, s)
                        }
                    } else {
                        format!("{} = \"{}\"", var.name, s)
                    }
                }
                serde_json::Value::Bool(b) => format!("{} = {}", var.name, b),
                serde_json::Value::Number(n) => format!("{} = {}", var.name, n),
                serde_json::Value::Array(arr) => format_list(&var.name, arr),
                serde_json::Value::Object(obj) => format_map(&var.name, obj),
                _ => continue,
            };
            lines.push(formatted);
        }
    }
    
    lines.join("\n")
}

fn format_list(name: &str, arr: &[serde_json::Value]) -> String {
    // Check if list contains objects (for list(object(...)) types)
    let has_objects = arr.iter().any(|v| matches!(v, serde_json::Value::Object(_)));
    
    if has_objects {
        // Format as list of objects with proper HCL syntax
        let items: Vec<String> = arr.iter()
            .filter_map(|v| {
                if let serde_json::Value::Object(obj) = v {
                    let fields: Vec<String> = obj.iter()
                        .filter_map(|(k, v)| {
                            match v {
                                serde_json::Value::String(s) => Some(format!("    {} = \"{}\"", k, s)),
                                serde_json::Value::Number(n) => Some(format!("    {} = {}", k, n)),
                                serde_json::Value::Bool(b) => Some(format!("    {} = {}", k, b)),
                                _ => None,
                            }
                        })
                        .collect();
                    Some(format!("  {{\n{}\n  }}", fields.join("\n")))
                } else {
                    None
                }
            })
            .collect();
        format!("{} = [\n{}\n]", name, items.join(",\n"))
    } else {
        // Simple list of primitives
        let items: Vec<String> = arr.iter()
            .map(|v| match v {
                serde_json::Value::String(s) => format!("\"{}\"", s),
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::Bool(b) => b.to_string(),
                _ => "null".to_string(),
            })
            .collect();
        format!("{} = [{}]", name, items.join(", "))
    }
}

fn format_map(name: &str, obj: &serde_json::Map<String, serde_json::Value>) -> String {
    if obj.is_empty() {
        return format!("{} = {{}}", name);
    }
    let mut obj_lines = vec![format!("{} = {{", name)];
    format_object_fields(obj, 1, &mut obj_lines);
    obj_lines.push("}".to_string());
    obj_lines.join("\n")
}

fn format_object_fields(
    obj: &serde_json::Map<String, serde_json::Value>,
    depth: usize,
    lines: &mut Vec<String>,
) {
    let indent = "  ".repeat(depth);
    for (k, v) in obj {
        match v {
            serde_json::Value::String(s) => lines.push(format!("{}\"{}\" = \"{}\"", indent, k, s)),
            serde_json::Value::Number(n) => lines.push(format!("{}\"{}\" = {}", indent, k, n)),
            serde_json::Value::Bool(b) => lines.push(format!("{}\"{}\" = {}", indent, k, b)),
            serde_json::Value::Object(nested) => {
                lines.push(format!("{}\"{}\" = {{", indent, k));
                format_object_fields(nested, depth + 1, lines);
                lines.push(format!("{}}}", indent));
            }
            serde_json::Value::Array(arr) => {
                let items: Vec<String> = arr
                    .iter()
                    .map(|v| match v {
                        serde_json::Value::String(s) => format!("\"{}\"", s),
                        serde_json::Value::Number(n) => n.to_string(),
                        serde_json::Value::Bool(b) => b.to_string(),
                        _ => "null".to_string(),
                    })
                    .collect();
                lines.push(format!("{}\"{}\" = [{}]", indent, k, items.join(", ")));
            }
            serde_json::Value::Null => lines.push(format!("{}\"{}\" = null", indent, k)),
        }
    }
}

pub fn run_terraform(
    command: &str,
    working_dir: &PathBuf,
    env_vars: HashMap<String, String>,
) -> Result<Child, String> {
    let terraform_path = get_terraform_path();
    
    let args: Vec<&str> = match command {
        "init" => vec!["init", "-no-color"],
        "plan" => vec!["plan", "-no-color"],
        "apply" => vec!["apply", "-auto-approve", "-no-color"],
        "destroy" => vec!["destroy", "-auto-approve", "-no-color"],
        _ => return Err(format!("Unknown command: {}", command)),
    };

    let mut cmd = Command::new(&terraform_path);
    cmd.args(&args)
        .current_dir(working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Set environment variables
    for (key, value) in env_vars {
        cmd.env(key, value);
    }

    // Extend PATH to include common installation locations (macOS GUI apps have minimal PATH)
    let install_dir = crate::dependencies::get_terraform_install_path();
    let current_path = std::env::var("PATH").unwrap_or_default();
    
    #[cfg(target_os = "windows")]
    let extended_path = format!(
        "{};{}",
        install_dir.to_string_lossy(),
        current_path
    );
    
    #[cfg(not(target_os = "windows"))]
    let extended_path = format!(
        "{}:/usr/local/bin:/opt/homebrew/bin:/opt/local/bin:{}",
        install_dir.to_string_lossy(),
        current_path
    );
    
    cmd.env("PATH", extended_path);

    cmd.spawn().map_err(|e| e.to_string())
}

fn get_terraform_path() -> String {
    // Reuse the path finding logic from dependencies module
    crate::dependencies::find_terraform_path()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "terraform".to_string())
}

// ─── Import-on-retry: detect "already exists" errors and auto-import ────────

#[derive(Debug, Clone, PartialEq)]
pub enum ImportableResource {
    Azurerm {
        tf_address: String,
        import_id: String,
    },
    DatabricksPeRule {
        tf_address: String,
        rule_id: String,
    },
    DatabricksGeneric {
        tf_address: String,
        import_id: String,
    },
}

/// Split Terraform output into error blocks and extract importable resources.
///
/// Supports three formats:
///   Format A (azurerm): `A resource with the ID "..." already exists`
///   Format B (databricks PE): `already exists under rule <uuid>`
///   Format C (databricks generic): `Network Policy <id> already existed for account <acct>`
pub fn parse_importable_errors(output: &str) -> Vec<ImportableResource> {
    lazy_static::lazy_static! {
        static ref AZURERM_RE: Regex =
            Regex::new(r#"(?i)a resource with the ID "([^"]+)" already exists"#).unwrap();
        static ref PE_RULE_RE: Regex =
            Regex::new(r"already exists under rule ([0-9a-f-]+)").unwrap();
        static ref NETWORK_POLICY_RE: Regex =
            Regex::new(r"Network Policy (\S+) already existed for account").unwrap();
        static ref WITH_RE: Regex =
            Regex::new(r"^\s*with\s+([^,]+),").unwrap();
    }

    let mut results = Vec::new();

    let lines: Vec<&str> = output.lines().collect();
    let mut block_starts: Vec<usize> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if line.starts_with("Error:") {
            block_starts.push(i);
        }
    }

    for (idx, &start) in block_starts.iter().enumerate() {
        let end = block_starts.get(idx + 1).copied().unwrap_or(lines.len());
        let block: Vec<&str> = lines[start..end].to_vec();
        let block_text = block.join("\n");

        let tf_address = block.iter().find_map(|line| {
            WITH_RE
                .captures(line)
                .map(|caps| caps[1].trim().to_string())
        });

        let tf_address = match tf_address {
            Some(addr) => addr,
            None => continue,
        };

        // Format A: azurerm
        if let Some(caps) = AZURERM_RE.captures(&block_text) {
            results.push(ImportableResource::Azurerm {
                tf_address,
                import_id: caps[1].to_string(),
            });
            continue;
        }

        // Format B: databricks PE rule
        if let Some(caps) = PE_RULE_RE.captures(&block_text) {
            results.push(ImportableResource::DatabricksPeRule {
                tf_address,
                rule_id: caps[1].to_string(),
            });
            continue;
        }

        // Format C: databricks network policy
        if let Some(caps) = NETWORK_POLICY_RE.captures(&block_text) {
            results.push(ImportableResource::DatabricksGeneric {
                tf_address,
                import_id: caps[1].to_string(),
            });
        }
    }

    results
}

/// Run `terraform import` for a single resource and wait for completion.
pub fn run_terraform_import(
    address: &str,
    id: &str,
    working_dir: &Path,
    env_vars: &HashMap<String, String>,
) -> Result<String, String> {
    let terraform_path = get_terraform_path();

    let mut cmd = Command::new(&terraform_path);
    cmd.args(["import", "-no-color", "-input=false", address, id])
        .current_dir(working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (key, value) in env_vars {
        cmd.env(key, value);
    }

    let install_dir = crate::dependencies::get_terraform_install_path();
    let current_path = std::env::var("PATH").unwrap_or_default();

    #[cfg(target_os = "windows")]
    let extended_path = format!("{};{}", install_dir.to_string_lossy(), current_path);

    #[cfg(not(target_os = "windows"))]
    let extended_path = format!(
        "{}:/usr/local/bin:/opt/homebrew/bin:/opt/local/bin:{}",
        install_dir.to_string_lossy(),
        current_path
    );

    cmd.env("PATH", extended_path);

    let output = cmd.output().map_err(|e| format!("Failed to run terraform import: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, stderr);

    // Terraform import can exit non-zero due to unrelated plan errors (e.g. for_each
    // depending on unknown values) even though the import itself succeeded.
    // Check for the "Import prepared!" marker that confirms the resource was imported.
    let import_succeeded =
        output.status.success() || combined.contains("Import prepared!");

    if import_succeeded {
        Ok(combined)
    } else {
        Err(combined)
    }
}

/// Look up the NCC ID from Terraform state (for `create_hub = true` case).
///
/// Runs `terraform state list` to find the NCC resource, then
/// `terraform state show -json` to extract `network_connectivity_config_id`.
pub fn get_ncc_id_from_state(
    working_dir: &Path,
    env_vars: &HashMap<String, String>,
) -> Option<String> {
    let terraform_path = get_terraform_path();
    let extended_path = build_extended_path();

    // Step 1: list state entries and find the NCC resource
    let list_output = Command::new(&terraform_path)
        .args(["state", "list", "-no-color"])
        .current_dir(working_dir)
        .envs(env_vars)
        .env("PATH", &extended_path)
        .output()
        .ok()?;

    if !list_output.status.success() {
        return None;
    }

    let list_text = String::from_utf8_lossy(&list_output.stdout);
    let ncc_address = list_text
        .lines()
        .find(|line| line.contains("databricks_mws_network_connectivity_config"))?
        .trim()
        .to_string();

    // Step 2: show the NCC resource as JSON and extract network_connectivity_config_id
    let show_output = Command::new(&terraform_path)
        .args(["state", "show", "-json", "-no-color", &ncc_address])
        .current_dir(working_dir)
        .envs(env_vars)
        .env("PATH", &extended_path)
        .output()
        .ok()?;

    if !show_output.status.success() {
        return None;
    }

    let json_text = String::from_utf8_lossy(&show_output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&json_text).ok()?;
    parsed["attributes"]["network_connectivity_config_id"]
        .as_str()
        .map(|s| s.to_string())
}

/// Read a variable value from terraform.tfvars (simple `key = "value"` format).
pub fn read_tfvar(working_dir: &Path, var_name: &str) -> Option<String> {
    let tfvars_path = working_dir.join("terraform.tfvars");
    let content = fs::read_to_string(tfvars_path).ok()?;
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(var_name) {
            let rest = rest.trim();
            if let Some(rest) = rest.strip_prefix('=') {
                let val = rest.trim().trim_matches('"');
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

/// Resolve the NCC ID needed for PE rule import IDs.
/// Tries state first, falls back to existing_ncc_id in tfvars.
pub fn resolve_ncc_id(
    working_dir: &Path,
    env_vars: &HashMap<String, String>,
) -> Option<String> {
    get_ncc_id_from_state(working_dir, env_vars)
        .or_else(|| read_tfvar(working_dir, "existing_ncc_id"))
}

fn build_extended_path() -> String {
    let install_dir = crate::dependencies::get_terraform_install_path();
    let current_path = std::env::var("PATH").unwrap_or_default();

    #[cfg(target_os = "windows")]
    {
        format!("{};{}", install_dir.to_string_lossy(), current_path)
    }

    #[cfg(not(target_os = "windows"))]
    {
        format!(
            "{}:/usr/local/bin:/opt/homebrew/bin:/opt/local/bin:{}",
            install_dir.to_string_lossy(),
            current_path
        )
    }
}

/// Placeholder URL injected into Terraform env so providers can initialise
/// before workspaces exist in state (used during auto-import flows).
pub const PROVIDER_PLACEHOLDER_URL: &str = "https://placeholder.azuredatabricks.net";

/// Resolve the `(tf_address, import_id)` pair for an [`ImportableResource`],
/// returning `None` when the NCC ID is required but unavailable.
pub fn resolve_import_pair(
    resource: &ImportableResource,
    ncc_id: &Option<String>,
) -> Option<(String, String)> {
    match resource {
        ImportableResource::Azurerm { tf_address, import_id } => {
            Some((tf_address.clone(), import_id.clone()))
        }
        ImportableResource::DatabricksPeRule { tf_address, rule_id } => {
            ncc_id.as_ref().map(|ncc| (tf_address.clone(), format!("{}/{}", ncc, rule_id)))
        }
        ImportableResource::DatabricksGeneric { tf_address, import_id } => {
            Some((tf_address.clone(), import_id.clone()))
        }
    }
}

/// Build the import environment: clone the base env vars and inject
/// placeholder workspace URLs so Terraform providers can initialise.
pub fn build_import_env(base_env: &HashMap<String, String>) -> HashMap<String, String> {
    let mut env = base_env.clone();
    env.entry("TF_VAR_hub_workspace_url_override".into())
        .or_insert_with(|| PROVIDER_PLACEHOLDER_URL.into());
    env.entry("TF_VAR_spoke_workspace_url_override".into())
        .or_insert_with(|| PROVIDER_PLACEHOLDER_URL.into());
    env.entry("TF_VAR_workspace_url_override".into())
        .or_insert_with(|| PROVIDER_PLACEHOLDER_URL.into());
    env
}

/// Run a batch of `terraform import` commands for the given resources.
///
/// Returns `true` if all imports succeeded, `false` if any failed.
/// Calls `log` for each status message.
pub fn run_import_batch(
    resources: &[ImportableResource],
    ncc_id: &Option<String>,
    working_dir: &Path,
    import_env: &HashMap<String, String>,
    log: &mut dyn FnMut(&str),
) -> bool {
    let mut all_ok = true;
    for res in resources {
        let (address, id) = match resolve_import_pair(res, ncc_id) {
            Some(pair) => pair,
            None => {
                let addr = match res {
                    ImportableResource::DatabricksPeRule { tf_address, .. } => tf_address,
                    _ => unreachable!(),
                };
                log(&format!("Skipping import of {}: could not resolve NCC ID\n", addr));
                all_ok = false;
                continue;
            }
        };

        log(&format!("Importing {} ...\n", address));

        match run_terraform_import(&address, &id, working_dir, import_env) {
            Ok(msg) => {
                log(&msg);
                log("\n");
            }
            Err(msg) => {
                all_ok = false;
                log(&format!("Import failed for {}: {}\n", address, msg));
            }
        }
    }
    all_ok
}

/// Stream stdout + stderr from a Terraform child process into a shared output
/// buffer, wait for the child to exit, and return whether it succeeded.
///
/// `set_pid` is called with the child PID so the caller can track it for
/// cancellation. `append_output` is called for each line of output.
pub fn stream_and_wait(
    child: &mut Child,
    append_output: Arc<Mutex<DeploymentStatus>>,
    set_pid: &dyn Fn(u32),
) -> Result<bool, String> {
    set_pid(child.id());

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let out_status = append_output.clone();
    let err_status = append_output.clone();

    let h1 = stdout.map(|out| {
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(out);
            for line in std::io::BufRead::lines(reader).flatten() {
                if let Ok(mut s) = out_status.lock() {
                    s.output.push_str(&line);
                    s.output.push('\n');
                }
            }
        })
    });

    let h2 = stderr.map(|err| {
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(err);
            for line in std::io::BufRead::lines(reader).flatten() {
                if let Ok(mut s) = err_status.lock() {
                    s.output.push_str(&line);
                    s.output.push('\n');
                }
            }
        })
    });

    if let Some(h) = h1 { let _ = h.join(); }
    if let Some(h) = h2 { let _ = h.join(); }

    child.wait()
        .map(|exit| exit.success())
        .map_err(|e| format!("Error waiting for terraform: {}", e))
}

/// After an `apply` failure, auto-import "already exists" resources and
/// retry `apply` up to `MAX_RETRIES` times.
///
/// Returns `(success, can_rollback)`.
pub fn import_and_retry_apply(
    working_dir: &Path,
    env_vars: &HashMap<String, String>,
    status: Arc<Mutex<DeploymentStatus>>,
    process: Arc<Mutex<Option<u32>>>,
) -> (bool, bool) {
    const MAX_RETRIES: usize = 3;

    let output_snapshot = status.lock()
        .map(|s| s.output.clone())
        .unwrap_or_default();

    let importable = parse_importable_errors(&output_snapshot);

    if importable.is_empty() {
        return (false, check_state_exists(&working_dir.to_path_buf()));
    }

    let ncc_id = resolve_ncc_id(working_dir, env_vars);
    let import_env = build_import_env(env_vars);

    let mut log_to_status = |msg: &str| {
        if let Ok(mut s) = status.lock() {
            s.output.push_str(msg);
        }
    };

    log_to_status(&format!(
        "\n--- Auto-importing {} existing resource(s) ---\n",
        importable.len()
    ));

    let all_ok = run_import_batch(&importable, &ncc_id, working_dir, &import_env, &mut log_to_status);

    if !all_ok {
        log_to_status("\nSome imports had errors (may be caused by unrelated plan issues). Retrying apply anyway...\n");
    }

    for attempt in 1..=MAX_RETRIES {
        if let Ok(mut s) = status.lock() {
            s.output.push_str(&format!(
                "\n--- Retrying deployment after imports (attempt {}/{}) ---\n",
                attempt, MAX_RETRIES
            ));
        }

        let mut retry_child = match run_terraform("apply", &working_dir.to_path_buf(), env_vars.clone()) {
            Ok(child) => child,
            Err(e) => {
                log_to_status(&format!("\nFailed to start retry: {}\n", e));
                return (false, check_state_exists(&working_dir.to_path_buf()));
            }
        };

        let output_before_retry = status.lock()
            .map(|s| s.output.len())
            .unwrap_or(0);

        let set_pid = |pid: u32| {
            if let Ok(mut proc) = process.lock() {
                *proc = Some(pid);
            }
        };

        let success = match stream_and_wait(&mut retry_child, status.clone(), &set_pid) {
            Ok(s) => s,
            Err(e) => {
                log_to_status(&format!("\nRetry error: {}\n", e));
                if let Ok(mut proc) = process.lock() {
                    *proc = None;
                }
                return (false, check_state_exists(&working_dir.to_path_buf()));
            }
        };

        if let Ok(mut proc) = process.lock() {
            *proc = None;
        }

        if success {
            return (true, check_state_exists(&working_dir.to_path_buf()));
        }

        if attempt < MAX_RETRIES {
            let new_output = status.lock()
                .map(|s| s.output[output_before_retry..].to_string())
                .unwrap_or_default();
            let new_importable = parse_importable_errors(&new_output);

            if new_importable.is_empty() {
                return (false, check_state_exists(&working_dir.to_path_buf()));
            }

            log_to_status(&format!(
                "\n--- Auto-importing {} more resource(s) ---\n",
                new_importable.len()
            ));

            run_import_batch(&new_importable, &ncc_id, working_dir, &import_env, &mut log_to_status);
        }
    }

    (false, check_state_exists(&working_dir.to_path_buf()))
}

pub fn check_state_exists(working_dir: &PathBuf) -> bool {
    let state_file = working_dir.join("terraform.tfstate");
    if state_file.exists() {
        if let Ok(content) = fs::read_to_string(&state_file) {
            // Check if state has resources
            return content.contains("\"resources\"") && content.contains("\"type\"");
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    // ── parse_variables_tf ──────────────────────────────────────────────

    #[test]
    fn parse_simple_string_variable() {
        let tf = r#"
variable "region" {
  description = "The AWS region"
  type        = string
  default     = "us-east-1"
}
"#;
        let vars = parse_variables_tf(tf);
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].name, "region");
        assert_eq!(vars[0].description, "The AWS region");
        assert_eq!(vars[0].default.as_deref(), Some("us-east-1"));
        assert!(!vars[0].required);
    }

    #[test]
    fn parse_required_variable_no_default() {
        let tf = r#"
variable "name" {
  description = "Deployment name"
  type        = string
}
"#;
        let vars = parse_variables_tf(tf);
        assert_eq!(vars.len(), 1);
        assert!(vars[0].required);
        assert!(vars[0].default.is_none());
    }

    #[test]
    fn parse_sensitive_variable() {
        let tf = r#"
variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}
"#;
        let vars = parse_variables_tf(tf);
        assert_eq!(vars.len(), 1);
        assert!(vars[0].sensitive);
    }

    #[test]
    fn parse_bool_variable() {
        let tf = r#"
variable "enable_logging" {
  description = "Enable logging"
  type        = bool
  default     = true
}
"#;
        let vars = parse_variables_tf(tf);
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].default.as_deref(), Some("true"));
    }

    #[test]
    fn parse_multiple_variables() {
        let tf = r#"
variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
}

variable "count" {
  description = "Number of instances"
  type        = number
  default     = 1
}
"#;
        let vars = parse_variables_tf(tf);
        assert_eq!(vars.len(), 3);
        assert_eq!(vars[0].name, "region");
        assert_eq!(vars[1].name, "instance_type");
        assert_eq!(vars[2].name, "count");
    }

    #[test]
    fn parse_multiline_map_default() {
        let tf = r#"
variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {
    env  = "prod"
    team = "data"
  }
}
"#;
        let vars = parse_variables_tf(tf);
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].name, "tags");
        assert!(!vars[0].required);
        assert!(vars[0].default.is_some());
    }

    #[test]
    fn parse_multiline_list_default() {
        let tf = r#"
variable "subnets" {
  description = "Subnet list"
  type        = list(string)
  default     = [
    "subnet-1",
    "subnet-2"
  ]
}
"#;
        let vars = parse_variables_tf(tf);
        assert_eq!(vars.len(), 1);
        assert!(!vars[0].required);
        assert!(vars[0].default.is_some());
    }

    #[test]
    fn parse_empty_content() {
        let vars = parse_variables_tf("");
        assert!(vars.is_empty());
    }

    #[test]
    fn parse_no_variables() {
        let tf = r#"
resource "aws_instance" "web" {
  ami           = "ami-12345"
  instance_type = "t2.micro"
}
"#;
        let vars = parse_variables_tf(tf);
        assert!(vars.is_empty());
    }

    // ── generate_tfvars ─────────────────────────────────────────────────

    #[test]
    fn generate_tfvars_string_value() {
        let vars = vec![TerraformVariable {
            name: "region".to_string(),
            description: String::new(),
            var_type: "string".to_string(),
            default: None,
            required: true,
            sensitive: false,
            validation: None,
        }];
        let mut values = HashMap::new();
        values.insert("region".to_string(), serde_json::json!("us-east-1"));
        let result = generate_tfvars(&values, &vars);
        assert_eq!(result, "region = \"us-east-1\"");
    }

    #[test]
    fn generate_tfvars_bool_value() {
        let vars = vec![TerraformVariable {
            name: "enabled".to_string(),
            description: String::new(),
            var_type: "bool".to_string(),
            default: None,
            required: true,
            sensitive: false,
            validation: None,
        }];
        let mut values = HashMap::new();
        values.insert("enabled".to_string(), serde_json::json!(true));
        let result = generate_tfvars(&values, &vars);
        assert_eq!(result, "enabled = true");
    }

    #[test]
    fn generate_tfvars_number_value() {
        let vars = vec![TerraformVariable {
            name: "count".to_string(),
            description: String::new(),
            var_type: "number".to_string(),
            default: None,
            required: true,
            sensitive: false,
            validation: None,
        }];
        let mut values = HashMap::new();
        values.insert("count".to_string(), serde_json::json!(42));
        let result = generate_tfvars(&values, &vars);
        assert_eq!(result, "count = 42");
    }

    #[test]
    fn generate_tfvars_list_of_strings() {
        let vars = vec![TerraformVariable {
            name: "zones".to_string(),
            description: String::new(),
            var_type: "list(string)".to_string(),
            default: None,
            required: true,
            sensitive: false,
            validation: None,
        }];
        let mut values = HashMap::new();
        values.insert("zones".to_string(), serde_json::json!(["us-east-1a", "us-east-1b"]));
        let result = generate_tfvars(&values, &vars);
        assert_eq!(result, "zones = [\"us-east-1a\", \"us-east-1b\"]");
    }

    #[test]
    fn generate_tfvars_map_value() {
        let vars = vec![TerraformVariable {
            name: "tags".to_string(),
            description: String::new(),
            var_type: "map(string)".to_string(),
            default: None,
            required: true,
            sensitive: false,
            validation: None,
        }];
        let mut values = HashMap::new();
        let mut map = serde_json::Map::new();
        map.insert("env".to_string(), serde_json::json!("prod"));
        values.insert("tags".to_string(), serde_json::Value::Object(map));
        let result = generate_tfvars(&values, &vars);
        assert!(result.contains("tags = {"));
        assert!(result.contains("\"env\" = \"prod\""));
    }

    #[test]
    fn generate_tfvars_empty_map() {
        let vars = vec![TerraformVariable {
            name: "tags".to_string(),
            description: String::new(),
            var_type: "map(string)".to_string(),
            default: None,
            required: true,
            sensitive: false,
            validation: None,
        }];
        let mut values = HashMap::new();
        values.insert("tags".to_string(), serde_json::Value::Object(serde_json::Map::new()));
        let result = generate_tfvars(&values, &vars);
        assert_eq!(result, "tags = {}");
    }

    #[test]
    fn generate_tfvars_bool_string_for_bool_type() {
        let vars = vec![TerraformVariable {
            name: "flag".to_string(),
            description: String::new(),
            var_type: "bool".to_string(),
            default: None,
            required: true,
            sensitive: false,
            validation: None,
        }];
        let mut values = HashMap::new();
        values.insert("flag".to_string(), serde_json::json!("true"));
        let result = generate_tfvars(&values, &vars);
        assert_eq!(result, "flag = true");
    }

    #[test]
    fn generate_tfvars_skips_empty_required_string() {
        let vars = vec![TerraformVariable {
            name: "name".to_string(),
            description: String::new(),
            var_type: "string".to_string(),
            default: None,
            required: true,
            sensitive: false,
            validation: None,
        }];
        let mut values = HashMap::new();
        values.insert("name".to_string(), serde_json::json!(""));
        let result = generate_tfvars(&values, &vars);
        assert!(result.is_empty());
    }

    #[test]
    fn generate_tfvars_skips_missing_values() {
        let vars = vec![TerraformVariable {
            name: "region".to_string(),
            description: String::new(),
            var_type: "string".to_string(),
            default: None,
            required: true,
            sensitive: false,
            validation: None,
        }];
        let values = HashMap::new();
        let result = generate_tfvars(&values, &vars);
        assert!(result.is_empty());
    }

    #[test]
    fn generate_tfvars_multiple_variables() {
        let vars = vec![
            TerraformVariable {
                name: "region".to_string(),
                description: String::new(),
                var_type: "string".to_string(),
                default: None,
                required: true,
                sensitive: false,
                validation: None,
            },
            TerraformVariable {
                name: "count".to_string(),
                description: String::new(),
                var_type: "number".to_string(),
                default: None,
                required: true,
                sensitive: false,
                validation: None,
            },
        ];
        let mut values = HashMap::new();
        values.insert("region".to_string(), serde_json::json!("eu-west-1"));
        values.insert("count".to_string(), serde_json::json!(3));
        let result = generate_tfvars(&values, &vars);
        assert!(result.contains("region = \"eu-west-1\""));
        assert!(result.contains("count = 3"));
    }

    #[test]
    fn generate_tfvars_map_string_parseable() {
        let vars = vec![TerraformVariable {
            name: "tags".to_string(),
            description: String::new(),
            var_type: "map(string)".to_string(),
            default: None,
            required: true,
            sensitive: false,
            validation: None,
        }];
        let mut values = HashMap::new();
        values.insert("tags".to_string(), serde_json::json!("{\"env\":\"prod\"}"));
        let result = generate_tfvars(&values, &vars);
        assert!(result.contains("tags = {"));
        assert!(result.contains("\"env\" = \"prod\""));
    }

    #[test]
    fn generate_tfvars_list_string_parseable() {
        let vars = vec![TerraformVariable {
            name: "zones".to_string(),
            description: String::new(),
            var_type: "list(string)".to_string(),
            default: None,
            required: true,
            sensitive: false,
            validation: None,
        }];
        let mut values = HashMap::new();
        values.insert("zones".to_string(), serde_json::json!("[\"a\",\"b\"]"));
        let result = generate_tfvars(&values, &vars);
        assert_eq!(result, "zones = [\"a\", \"b\"]");
    }

    // ── check_state_exists (Phase 2 — filesystem with tempdir) ──────────

    #[test]
    fn check_state_exists_no_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!check_state_exists(&dir.path().to_path_buf()));
    }

    #[test]
    fn check_state_exists_empty_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("terraform.tfstate"), "").unwrap();
        assert!(!check_state_exists(&dir.path().to_path_buf()));
    }

    #[test]
    fn check_state_exists_no_resources() {
        let dir = tempfile::tempdir().unwrap();
        let content = r#"{ "version": 4, "serial": 1 }"#;
        fs::write(dir.path().join("terraform.tfstate"), content).unwrap();
        assert!(!check_state_exists(&dir.path().to_path_buf()));
    }

    #[test]
    fn check_state_exists_with_resources() {
        let dir = tempfile::tempdir().unwrap();
        let content = r#"{
            "version": 4,
            "resources": [
                { "type": "aws_instance", "name": "web" }
            ]
        }"#;
        fs::write(dir.path().join("terraform.tfstate"), content).unwrap();
        assert!(check_state_exists(&dir.path().to_path_buf()));
    }

    #[test]
    fn check_state_exists_resources_keyword_but_no_type() {
        let dir = tempfile::tempdir().unwrap();
        let content = r#"{ "resources": [] }"#;
        fs::write(dir.path().join("terraform.tfstate"), content).unwrap();
        assert!(!check_state_exists(&dir.path().to_path_buf()));
    }

    // ── parse_importable_errors ─────────────────────────────────────────

    #[test]
    fn parse_azurerm_workspace_error() {
        let output = r#"module.spoke_workspace.azurerm_private_endpoint.backend[0]: Creation complete after 1m21s
Error: A resource with the ID "/subscriptions/aaa/resourceGroups/rg-hub/providers/Microsoft.Databricks/workspaces/WS1" already exists - to be managed via Terraform this resource needs to be imported into the State.
  with module.webauth_workspace[0].azurerm_databricks_workspace.this,
  on modules/workspace/main.tf line 30, in resource "azurerm_databricks_workspace" "this":
  30: resource "azurerm_databricks_workspace" "this" {
"#;
        let results = parse_importable_errors(output);
        assert_eq!(results.len(), 1);
        match &results[0] {
            ImportableResource::Azurerm { tf_address, import_id } => {
                assert_eq!(tf_address, "module.webauth_workspace[0].azurerm_databricks_workspace.this");
                assert_eq!(import_id, "/subscriptions/aaa/resourceGroups/rg-hub/providers/Microsoft.Databricks/workspaces/WS1");
            }
            _ => panic!("Expected Azurerm variant"),
        }
    }

    #[test]
    fn parse_azurerm_lowercase_a() {
        let output = r#"Error: a resource with the ID "/subscriptions/x/y/z" already exists - to be managed via Terraform
  with module.foo.azurerm_storage_account.bar,
  on main.tf line 1
"#;
        let results = parse_importable_errors(output);
        assert_eq!(results.len(), 1);
        assert!(matches!(&results[0], ImportableResource::Azurerm { .. }));
    }

    #[test]
    fn parse_azurerm_for_each_address() {
        let output = r#"Error: A resource with the ID "/subscriptions/x/y" already exists
  with module.net.azurerm_subnet.this["private"],
  on modules/net/main.tf line 5
"#;
        let results = parse_importable_errors(output);
        assert_eq!(results.len(), 1);
        match &results[0] {
            ImportableResource::Azurerm { tf_address, .. } => {
                assert_eq!(tf_address, r#"module.net.azurerm_subnet.this["private"]"#);
            }
            _ => panic!("Expected Azurerm variant"),
        }
    }

    #[test]
    fn parse_databricks_pe_rule_error() {
        let output = r#"Error: cannot create mws ncc private endpoint rule: Private endpoint databricks-xxx-pe-yyy to resource id /subscriptions/aaa/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa with group id blob already exists under rule 94ff95d2-241e-4bc3-81e7-78f4050acabb. Please use the existing private endpoint rule or delete it before creating a new one.
  with module.spoke_catalog.module.ncc_blob.databricks_mws_ncc_private_endpoint_rule.this,
  on modules/self-approving-pe/main.tf line 16, in resource "databricks_mws_ncc_private_endpoint_rule" "this":
  16: resource "databricks_mws_ncc_private_endpoint_rule" "this" {
"#;
        let results = parse_importable_errors(output);
        assert_eq!(results.len(), 1);
        match &results[0] {
            ImportableResource::DatabricksPeRule { tf_address, rule_id } => {
                assert_eq!(tf_address, "module.spoke_catalog.module.ncc_blob.databricks_mws_ncc_private_endpoint_rule.this");
                assert_eq!(rule_id, "94ff95d2-241e-4bc3-81e7-78f4050acabb");
            }
            _ => panic!("Expected DatabricksPeRule variant"),
        }
    }

    #[test]
    fn parse_mixed_errors() {
        let output = r#"module.spoke.resource: Creating...
Error: A resource with the ID "/subscriptions/aaa/bbb" already exists
  with module.ws[0].azurerm_databricks_workspace.this,
  on main.tf line 1

Error: cannot create mws ncc private endpoint rule: already exists under rule aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.
  with module.cat.module.ncc_blob.databricks_mws_ncc_private_endpoint_rule.this,
  on modules/self-approving-pe/main.tf line 16

Error: something unrelated went wrong
  with module.other.some_resource.this,
  on other.tf line 5
"#;
        let results = parse_importable_errors(output);
        assert_eq!(results.len(), 2);
        assert!(matches!(&results[0], ImportableResource::Azurerm { .. }));
        assert!(matches!(&results[1], ImportableResource::DatabricksPeRule { .. }));
    }

    #[test]
    fn parse_no_importable_errors() {
        let output = r#"Error: Failed credential validation checks
  with databricks_mws_credentials.this,
  on main.tf line 5
"#;
        let results = parse_importable_errors(output);
        assert!(results.is_empty());
    }

    #[test]
    fn parse_malformed_block_missing_with() {
        let output = r#"Error: A resource with the ID "/subscriptions/x/y" already exists
  on main.tf line 1
"#;
        let results = parse_importable_errors(output);
        assert!(results.is_empty());
    }

    #[test]
    fn parse_empty_output() {
        let results = parse_importable_errors("");
        assert!(results.is_empty());
    }

    #[test]
    fn parse_with_extra_whitespace() {
        let output = "Error: A resource with the ID \"/sub/x\" already exists\n    with   module.a.azurerm_rg.this ,\n    on main.tf line 1\n";
        let results = parse_importable_errors(output);
        assert_eq!(results.len(), 1);
        match &results[0] {
            ImportableResource::Azurerm { tf_address, .. } => {
                assert_eq!(tf_address, "module.a.azurerm_rg.this");
            }
            _ => panic!("Expected Azurerm"),
        }
    }

    #[test]
    fn parse_network_policy_error() {
        let output = r#"Error: failed to create account_network_policy
  with module.hub[0].databricks_account_network_policy.restrictive_network_policy,
  on modules/hub/serverless.tf line 18, in resource "databricks_account_network_policy" "restrictive_network_policy":
  18: resource "databricks_account_network_policy" "restrictive_network_policy" {
Network Policy np-hub0gjutm-restrictive already existed for account
ccb842e7-2376-4152-b0b0-29fa952379b8.
"#;
        let results = parse_importable_errors(output);
        assert_eq!(results.len(), 1);
        match &results[0] {
            ImportableResource::DatabricksGeneric { tf_address, import_id } => {
                assert_eq!(tf_address, "module.hub[0].databricks_account_network_policy.restrictive_network_policy");
                assert_eq!(import_id, "np-hub0gjutm-restrictive");
            }
            _ => panic!("Expected DatabricksGeneric variant"),
        }
    }

    #[test]
    fn parse_mixed_errors_with_network_policy() {
        let output = r#"Error: a resource with the ID "/subscriptions/x/resourceGroups/rg-hub" already exists
  with azurerm_resource_group.hub[0],
  on main.tf line 7, in resource "azurerm_resource_group" "hub":
   7: resource "azurerm_resource_group" "hub" {
Error: failed to create account_network_policy
  with module.hub[0].databricks_account_network_policy.hub_policy,
  on modules/hub/serverless.tf line 32, in resource "databricks_account_network_policy" "hub_policy":
  32: resource "databricks_account_network_policy" "hub_policy" {
Network Policy np-hub-hub already existed for account
ccb842e7-2376-4152-b0b0-29fa952379b8.
Error: cannot create mws ncc private endpoint rule: already exists under rule aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.
  with module.cat.module.ncc_blob.databricks_mws_ncc_private_endpoint_rule.this,
  on modules/self-approving-pe/main.tf line 16
"#;
        let results = parse_importable_errors(output);
        assert_eq!(results.len(), 3);
        assert!(matches!(&results[0], ImportableResource::Azurerm { .. }));
        assert!(matches!(&results[1], ImportableResource::DatabricksGeneric { .. }));
        assert!(matches!(&results[2], ImportableResource::DatabricksPeRule { .. }));
    }

    // ── read_tfvar ──────────────────────────────────────────────────────

    #[test]
    fn read_tfvar_simple() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("terraform.tfvars"),
            "existing_ncc_id = \"ncc-12345\"\nother_var = \"hello\"\n",
        )
        .unwrap();
        assert_eq!(
            read_tfvar(dir.path(), "existing_ncc_id"),
            Some("ncc-12345".to_string())
        );
    }

    #[test]
    fn read_tfvar_not_present() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("terraform.tfvars"),
            "region = \"westus2\"\n",
        )
        .unwrap();
        assert_eq!(read_tfvar(dir.path(), "existing_ncc_id"), None);
    }

    #[test]
    fn read_tfvar_with_spaces() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("terraform.tfvars"),
            "  existing_ncc_id  =  \"ncc-abc\"  \n",
        )
        .unwrap();
        assert_eq!(
            read_tfvar(dir.path(), "existing_ncc_id"),
            Some("ncc-abc".to_string())
        );
    }

    #[test]
    fn read_tfvar_no_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_tfvar(dir.path(), "anything"), None);
    }

    // ── resolve_import_pair ─────────────────────────────────────────────

    #[test]
    fn resolve_import_pair_azurerm() {
        let resource = ImportableResource::Azurerm {
            tf_address: "azurerm_resource_group.main".to_string(),
            import_id: "/subscriptions/sub-1/resourceGroups/rg-1".to_string(),
        };
        let result = resolve_import_pair(&resource, &None);
        assert!(result.is_some());
        let (addr, id) = result.unwrap();
        assert_eq!(addr, "azurerm_resource_group.main");
        assert_eq!(id, "/subscriptions/sub-1/resourceGroups/rg-1");
    }

    #[test]
    fn resolve_import_pair_azurerm_ignores_ncc_id() {
        let resource = ImportableResource::Azurerm {
            tf_address: "azurerm_vnet.main".to_string(),
            import_id: "/subs/vnet-1".to_string(),
        };
        let ncc = Some("ncc-123".to_string());
        let result = resolve_import_pair(&resource, &ncc);
        assert!(result.is_some());
        let (_, id) = result.unwrap();
        assert_eq!(id, "/subs/vnet-1");
    }

    #[test]
    fn resolve_import_pair_pe_rule_with_ncc() {
        let resource = ImportableResource::DatabricksPeRule {
            tf_address: "databricks_pe_rule.this".to_string(),
            rule_id: "rule-abc".to_string(),
        };
        let ncc = Some("ncc-456".to_string());
        let result = resolve_import_pair(&resource, &ncc);
        assert!(result.is_some());
        let (addr, id) = result.unwrap();
        assert_eq!(addr, "databricks_pe_rule.this");
        assert_eq!(id, "ncc-456/rule-abc");
    }

    #[test]
    fn resolve_import_pair_pe_rule_without_ncc_returns_none() {
        let resource = ImportableResource::DatabricksPeRule {
            tf_address: "databricks_pe_rule.this".to_string(),
            rule_id: "rule-abc".to_string(),
        };
        assert!(resolve_import_pair(&resource, &None).is_none());
    }

    #[test]
    fn resolve_import_pair_databricks_generic() {
        let resource = ImportableResource::DatabricksGeneric {
            tf_address: "databricks_network_policy.this".to_string(),
            import_id: "policy-123".to_string(),
        };
        let result = resolve_import_pair(&resource, &None);
        assert!(result.is_some());
        let (addr, id) = result.unwrap();
        assert_eq!(addr, "databricks_network_policy.this");
        assert_eq!(id, "policy-123");
    }

    // ── build_import_env ────────────────────────────────────────────────

    #[test]
    fn build_import_env_injects_placeholder_urls() {
        let base = HashMap::new();
        let env = build_import_env(&base);

        assert_eq!(
            env.get("TF_VAR_hub_workspace_url_override"),
            Some(&PROVIDER_PLACEHOLDER_URL.to_string())
        );
        assert_eq!(
            env.get("TF_VAR_spoke_workspace_url_override"),
            Some(&PROVIDER_PLACEHOLDER_URL.to_string())
        );
        assert_eq!(
            env.get("TF_VAR_workspace_url_override"),
            Some(&PROVIDER_PLACEHOLDER_URL.to_string())
        );
    }

    #[test]
    fn build_import_env_preserves_existing_overrides() {
        let mut base = HashMap::new();
        base.insert(
            "TF_VAR_hub_workspace_url_override".to_string(),
            "https://custom.azuredatabricks.net".to_string(),
        );
        let env = build_import_env(&base);

        assert_eq!(
            env.get("TF_VAR_hub_workspace_url_override"),
            Some(&"https://custom.azuredatabricks.net".to_string()),
        );
        // Others still get the placeholder
        assert_eq!(
            env.get("TF_VAR_spoke_workspace_url_override"),
            Some(&PROVIDER_PLACEHOLDER_URL.to_string())
        );
    }

    #[test]
    fn build_import_env_preserves_base_env_vars() {
        let mut base = HashMap::new();
        base.insert("ARM_TENANT_ID".to_string(), "tid".to_string());
        base.insert("AWS_PROFILE".to_string(), "my-prof".to_string());
        let env = build_import_env(&base);

        assert_eq!(env.get("ARM_TENANT_ID"), Some(&"tid".to_string()));
        assert_eq!(env.get("AWS_PROFILE"), Some(&"my-prof".to_string()));
    }
}

