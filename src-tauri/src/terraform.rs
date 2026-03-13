use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
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

    let mut cmd = crate::commands::silent_cmd(&terraform_path);
    cmd.args(&args)
        .current_dir(working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    apply_standard_env(&mut cmd, &env_vars);

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
    /// Azure role assignment that returned 409 RoleAssignmentExists.
    /// The import ID must be resolved at import time via `az role assignment list`
    /// because the error message does not include the assignment GUID.
    AzureRoleAssignment {
        tf_address: String,
    },
}

impl ImportableResource {
    /// Return the Terraform address for any variant.
    pub fn tf_address(&self) -> &str {
        match self {
            ImportableResource::Azurerm { tf_address, .. }
            | ImportableResource::DatabricksPeRule { tf_address, .. }
            | ImportableResource::DatabricksGeneric { tf_address, .. }
            | ImportableResource::AzureRoleAssignment { tf_address } => tf_address,
        }
    }
}

/// Split Terraform output into error blocks and extract importable resources.
///
/// Supports four formats:
///   Format A (azurerm): `A resource with the ID "..." already exists`
///   Format B (databricks PE): `already exists under rule <uuid>`
///   Format C (databricks generic): `Network Policy <id> already existed for account <acct>`
///   Format D (azure role assignment): `RoleAssignmentExists` (409 Conflict, no ID in error)
pub fn parse_importable_errors(output: &str) -> Vec<ImportableResource> {
    lazy_static::lazy_static! {
        static ref AZURERM_RE: Regex =
            Regex::new(r#"(?i)a resource with the ID "([^"]+)" already exists"#).unwrap();
        static ref PE_RULE_RE: Regex =
            Regex::new(r"already exists under rule ([0-9a-f-]+)").unwrap();
        static ref NETWORK_POLICY_RE: Regex =
            Regex::new(r"Network Policy (\S+) already existed for account").unwrap();
        static ref ASSOCIATION_RE: Regex =
            Regex::new(r#"(?i)an association between "([^"]+)" and "([^"]+)" already exists"#).unwrap();
        static ref ROLE_ASSIGNMENT_RE: Regex =
            Regex::new(r"(?i)RoleAssignmentExists").unwrap();
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

        // Format E: association between subnet and NSG/route-table
        if let Some(caps) = ASSOCIATION_RE.captures(&block_text) {
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
            continue;
        }

        // Format D: azure role assignment (409 RoleAssignmentExists)
        if ROLE_ASSIGNMENT_RE.is_match(&block_text)
            && tf_address.contains("role_assignment")
        {
            results.push(ImportableResource::AzureRoleAssignment { tf_address });
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

    let mut cmd = crate::commands::silent_cmd(&terraform_path);
    cmd.args(["import", "-no-color", "-input=false", address, id])
        .current_dir(working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    apply_standard_env(&mut cmd, env_vars);

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

    // Step 1: list state entries and find the NCC resource
    let mut list_cmd = crate::commands::silent_cmd(&terraform_path);
    list_cmd
        .args(["state", "list", "-no-color"])
        .current_dir(working_dir);
    apply_standard_env(&mut list_cmd, env_vars);
    let list_output = list_cmd.output().ok()?;

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
    let mut show_cmd = crate::commands::silent_cmd(&terraform_path);
    show_cmd
        .args(["state", "show", "-json", "-no-color", &ncc_address])
        .current_dir(working_dir);
    apply_standard_env(&mut show_cmd, env_vars);
    let show_output = show_cmd.output().ok()?;

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

/// Resolve the Azure resource ID of an existing role assignment so it can be
/// imported into Terraform state.
///
/// 1. Runs `terraform show -json` to extract the planned `scope`,
///    `role_definition_name`, and `principal_id` for `tf_address`.
/// 2. Runs `az role assignment list` to look up the existing assignment GUID.
pub fn resolve_azure_role_assignment_id(
    tf_address: &str,
    working_dir: &Path,
    env_vars: &HashMap<String, String>,
) -> Option<String> {
    let terraform_path = get_terraform_path();

    // Step 1: get planned values from Terraform state/plan
    let mut show_cmd = crate::commands::silent_cmd(&terraform_path);
    show_cmd
        .args(["show", "-json", "-no-color"])
        .current_dir(working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_standard_env(&mut show_cmd, env_vars);
    let show_output = show_cmd.output().ok()?;

    if !show_output.status.success() {
        return None;
    }

    let json_text = String::from_utf8_lossy(&show_output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&json_text).ok()?;

    // Strip index suffix (e.g. "[0]") from the address for JSON traversal
    let base_address = tf_address
        .split('[')
        .next()
        .unwrap_or(tf_address);

    // Walk planned_values.root_module.resources (and child modules) to find our resource
    let (scope, role, principal) = extract_role_assignment_attrs(&parsed, base_address, tf_address)?;

    // Step 2: query Azure CLI for the existing assignment
    let az_path = crate::dependencies::find_azure_cli_path()?;

    let mut az_cmd = crate::commands::silent_cmd(&az_path);
    az_cmd
        .args([
            "role", "assignment", "list",
            "--scope", &scope,
            "--assignee", &principal,
            "--role", &role,
            "--query", "[0].id",
            "-o", "tsv",
        ])
        .current_dir(working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_standard_env(&mut az_cmd, env_vars);
    let az_output = az_cmd.output().ok()?;

    if !az_output.status.success() {
        return None;
    }

    let id = String::from_utf8_lossy(&az_output.stdout).trim().to_string();
    if id.is_empty() {
        None
    } else {
        Some(id)
    }
}

/// Walk the `terraform show -json` output to find the planned attributes for a
/// role assignment resource.  Returns `(scope, role_definition_name, principal_id)`.
fn extract_role_assignment_attrs(
    plan_json: &serde_json::Value,
    base_address: &str,
    full_address: &str,
) -> Option<(String, String, String)> {
    // Try planned_values first, then prior_state
    for root_key in &["planned_values", "values"] {
        if let Some(resources) = collect_resources(plan_json.get(root_key)?) {
            for res in resources {
                let addr = res["address"].as_str().unwrap_or("");
                if addr == full_address || addr == base_address
                    || addr.ends_with(base_address)
                {
                    let vals = &res["values"];
                    let scope = vals["scope"].as_str()?.to_string();
                    let role = vals["role_definition_name"].as_str()?.to_string();
                    let principal = vals["principal_id"].as_str()?.to_string();
                    return Some((scope, role, principal));
                }
            }
        }
    }
    None
}

/// Recursively collect all resources from a root_module JSON node (including
/// child modules).
fn collect_resources(root_module_container: &serde_json::Value) -> Option<Vec<&serde_json::Value>> {
    let root = root_module_container.get("root_module")?;
    let mut out = Vec::new();
    collect_resources_recursive(root, &mut out);
    Some(out)
}

fn collect_resources_recursive<'a>(
    module: &'a serde_json::Value,
    out: &mut Vec<&'a serde_json::Value>,
) {
    if let Some(resources) = module.get("resources").and_then(|r| r.as_array()) {
        for res in resources {
            out.push(res);
        }
    }
    if let Some(children) = module.get("child_modules").and_then(|c| c.as_array()) {
        for child in children {
            collect_resources_recursive(child, out);
        }
    }
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

/// Apply standard environment to a Command: credential env vars, extended
/// PATH, and proxy/networking settings detected from the OS.
fn apply_standard_env(cmd: &mut std::process::Command, env_vars: &HashMap<String, String>) {
    for (key, value) in env_vars {
        cmd.env(key, value);
    }
    cmd.env("PATH", build_extended_path());
    for (key, value) in crate::proxy::get_proxy_env_vars() {
        if !env_vars.contains_key(&*key) {
            cmd.env(&key, &value);
        }
    }
}

/// Placeholder URL injected into Terraform env so providers can initialise
/// before workspaces exist in state (used during auto-import flows).
pub const PROVIDER_PLACEHOLDER_URL: &str = "https://placeholder.azuredatabricks.net";

/// Resolve the `(tf_address, import_id)` pair for an [`ImportableResource`],
/// returning `None` when the ID cannot be determined statically (NCC missing
/// or role-assignment requiring deferred Azure CLI lookup).
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
        ImportableResource::AzureRoleAssignment { .. } => {
            // Resolved at import time via Azure CLI; see run_import_batch
            None
        }
    }
}

/// Name of the temporary HCL file used for config-driven import blocks.
const AUTO_IMPORT_FILENAME: &str = "_auto_import.tf";

/// Group importable resources into `for_each` sibling groups.
///
/// Two resources are siblings when they share the same base address up to the
/// last `["` segment -- that trailing `["key"]` is the `for_each` map key.
/// Module-index brackets like `module.hub[0]` are NOT treated as sibling keys.
///
/// Returns `(sibling_groups, standalone)` where each sibling group has 2+
/// resources and standalone contains resources with no siblings.
pub fn group_for_each_siblings(
    resources: &[ImportableResource],
) -> (Vec<Vec<&ImportableResource>>, Vec<&ImportableResource>) {
    let mut groups: HashMap<String, Vec<&ImportableResource>> = HashMap::new();

    for res in resources {
        let addr = res.tf_address();
        let base = match addr.rfind("[\"") {
            Some(pos) => &addr[..pos],
            None => addr,
        };
        groups.entry(base.to_string()).or_default().push(res);
    }

    let mut sibling_groups = Vec::new();
    let mut standalone = Vec::new();

    for (_base, members) in groups {
        if members.len() >= 2 {
            sibling_groups.push(members);
        } else {
            standalone.extend(members);
        }
    }

    (sibling_groups, standalone)
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

/// Write a temporary `_auto_import.tf` file containing HCL `import` blocks for
/// a group of sibling resources. Returns the path to the generated file.
///
/// Each block has the form:
/// ```hcl
/// import {
///   to = <tf_address>
///   id = "<import_id>"
/// }
/// ```
pub fn write_import_blocks(
    pairs: &[(String, String)],
    working_dir: &Path,
) -> std::io::Result<PathBuf> {
    let mut hcl = String::new();
    for (addr, id) in pairs {
        hcl.push_str(&format!(
            "import {{\n  to = {}\n  id = \"{}\"\n}}\n\n",
            addr, id
        ));
    }
    let path = working_dir.join(AUTO_IMPORT_FILENAME);
    fs::write(&path, &hcl)?;
    Ok(path)
}

/// Remove the temporary import file if it exists.
fn cleanup_import_file(working_dir: &Path) {
    let path = working_dir.join(AUTO_IMPORT_FILENAME);
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
}

/// Apply import blocks for a group of `for_each` sibling resources using
/// `terraform apply -target=<addr>` for each sibling.
///
/// This approach writes HCL `import {}` blocks to a temp file, then runs a
/// single targeted `terraform apply` that processes all siblings atomically,
/// avoiding "Invalid index" errors that occur when siblings are imported
/// individually.
///
/// Returns `true` if the import apply succeeded.
pub fn apply_import_blocks(
    pairs: &[(String, String)],
    working_dir: &Path,
    import_env: &HashMap<String, String>,
    log: &mut dyn FnMut(&str),
) -> bool {
    let import_path = match write_import_blocks(pairs, working_dir) {
        Ok(p) => p,
        Err(e) => {
            log(&format!("Failed to write import blocks: {}\n", e));
            return false;
        }
    };

    log(&format!(
        "Wrote {} import block(s) to {}\n",
        pairs.len(),
        import_path.display()
    ));

    let terraform_path = get_terraform_path();

    let mut args = vec![
        "apply".to_string(),
        "-auto-approve".to_string(),
        "-no-color".to_string(),
        "-input=false".to_string(),
    ];
    for (addr, _) in pairs {
        args.push(format!("-target={}", addr));
    }

    log(&format!(
        "Running terraform apply with {} target(s) for import...\n",
        pairs.len()
    ));

    let mut cmd = crate::commands::silent_cmd(&terraform_path);
    cmd.args(&args)
        .current_dir(working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_standard_env(&mut cmd, import_env);
    let output = cmd.output();

    cleanup_import_file(working_dir);

    match output {
        Ok(out) => {
            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            log(&combined);
            log("\n");

            if out.status.success() {
                log("Import-block apply succeeded.\n");
                for (addr, _) in pairs {
                    log(&format!("[IMPORTED] {}\n", addr));
                }
                true
            } else {
                log("Import-block apply failed.\n");
                false
            }
        }
        Err(e) => {
            log(&format!("Failed to run terraform apply: {}\n", e));
            false
        }
    }
}

/// Run a batch of `terraform import` commands for the given resources.
///
/// Sibling `for_each` resources (resources sharing the same base address with
/// different map keys) are imported together via HCL import blocks and a
/// targeted `terraform apply`, avoiding "Invalid index" errors from
/// interdependent outputs.
///
/// Standalone resources are imported individually via `terraform import`.
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

    // Phase 1: Resolve (address, id) pairs for every resource up-front.
    let mut resolved: Vec<(String, String)> = Vec::new();
    let mut resolved_indices: Vec<usize> = Vec::new();

    for (i, res) in resources.iter().enumerate() {
        let pair = match res {
            ImportableResource::AzureRoleAssignment { tf_address } => {
                log(&format!("Resolving Azure role assignment ID for {} ...\n", tf_address));
                match resolve_azure_role_assignment_id(tf_address, working_dir, import_env) {
                    Some(id) => Some((tf_address.clone(), id)),
                    None => {
                        log(&format!(
                            "Skipping import of {}: could not resolve role assignment ID via Azure CLI\n",
                            tf_address
                        ));
                        all_ok = false;
                        None
                    }
                }
            }
            _ => match resolve_import_pair(res, ncc_id) {
                Some(pair) => Some(pair),
                None => {
                    log(&format!("Skipping import of {}: could not resolve import ID\n", res.tf_address()));
                    all_ok = false;
                    None
                }
            },
        };

        if let Some(p) = pair {
            resolved.push(p);
            resolved_indices.push(i);
        }
    }

    // Phase 2: Group resolved resources into for_each sibling sets.
    // Build lightweight ImportableResource::Azurerm wrappers keyed by resolved address
    // so we can reuse group_for_each_siblings.
    let wrappers: Vec<ImportableResource> = resolved
        .iter()
        .map(|(addr, id)| ImportableResource::Azurerm {
            tf_address: addr.clone(),
            import_id: id.clone(),
        })
        .collect();

    let (sibling_groups, standalone) = group_for_each_siblings(&wrappers);

    // Phase 3a: Import sibling groups atomically via import blocks.
    for group in &sibling_groups {
        let pairs: Vec<(String, String)> = group
            .iter()
            .map(|r| match r {
                ImportableResource::Azurerm { tf_address, import_id } => {
                    (tf_address.clone(), import_id.clone())
                }
                _ => unreachable!(),
            })
            .collect();

        let addrs: Vec<&str> = pairs.iter().map(|(a, _)| a.as_str()).collect();
        log(&format!(
            "Importing {} for_each siblings together: {}\n",
            pairs.len(),
            addrs.join(", ")
        ));

        if !apply_import_blocks(&pairs, working_dir, import_env, log) {
            all_ok = false;
        }
    }

    // Phase 3b: Import standalone resources individually.
    for res in &standalone {
        let (address, id) = match res {
            ImportableResource::Azurerm { tf_address, import_id } => {
                (tf_address.clone(), import_id.clone())
            }
            _ => unreachable!(),
        };

        log(&format!("Importing {} ...\n", address));

        match run_terraform_import(&address, &id, working_dir, import_env) {
            Ok(msg) => {
                log(&msg);
                log("\n");
                log(&format!("[IMPORTED] {}\n", address));
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

    cleanup_import_file(working_dir);

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

    // ── parse_importable_errors: Format D (RoleAssignmentExists) ──────

    #[test]
    fn parse_role_assignment_exists() {
        let output = r#"Error: unexpected status 409 (409 Conflict) with error: RoleAssignmentExists: The role assignment already exists.

  with azurerm_role_assignment.uc_storage_access[0],
  on catalog.tf line 64, in resource "azurerm_role_assignment" "uc_storage_access":
  64: resource "azurerm_role_assignment" "uc_storage_access" {
"#;
        let results = parse_importable_errors(output);
        assert_eq!(results.len(), 1);
        match &results[0] {
            ImportableResource::AzureRoleAssignment { tf_address } => {
                assert_eq!(tf_address, "azurerm_role_assignment.uc_storage_access[0]");
            }
            _ => panic!("Expected AzureRoleAssignment variant"),
        }
    }

    #[test]
    fn parse_role_assignment_exists_module_path() {
        let output = r#"Error: unexpected status 409 (409 Conflict) with error: RoleAssignmentExists: The role assignment already exists.
  with module.catalog.azurerm_role_assignment.blob_data_contrib[0],
  on modules/catalog/storage_account.tf line 22
"#;
        let results = parse_importable_errors(output);
        assert_eq!(results.len(), 1);
        match &results[0] {
            ImportableResource::AzureRoleAssignment { tf_address } => {
                assert_eq!(tf_address, "module.catalog.azurerm_role_assignment.blob_data_contrib[0]");
            }
            _ => panic!("Expected AzureRoleAssignment variant"),
        }
    }

    #[test]
    fn parse_role_assignment_not_matched_for_non_role_resource() {
        let output = r#"Error: unexpected status 409 (409 Conflict) with error: RoleAssignmentExists: The role assignment already exists.
  with azurerm_storage_account.this[0],
  on main.tf line 5
"#;
        let results = parse_importable_errors(output);
        assert!(results.is_empty());
    }

    #[test]
    fn parse_mixed_with_role_assignment() {
        let output = r#"Error: a resource with the ID "/subscriptions/x/resourceGroups/rg" already exists
  with azurerm_resource_group.this[0],
  on main.tf line 1

Error: unexpected status 409 (409 Conflict) with error: RoleAssignmentExists: The role assignment already exists.
  with azurerm_role_assignment.uc_storage_access[0],
  on catalog.tf line 64

Error: cannot create mws ncc private endpoint rule: already exists under rule aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.
  with module.cat.module.ncc_blob.databricks_mws_ncc_private_endpoint_rule.this,
  on modules/self-approving-pe/main.tf line 16
"#;
        let results = parse_importable_errors(output);
        assert_eq!(results.len(), 3);
        assert!(matches!(&results[0], ImportableResource::Azurerm { .. }));
        assert!(matches!(&results[1], ImportableResource::AzureRoleAssignment { .. }));
        assert!(matches!(&results[2], ImportableResource::DatabricksPeRule { .. }));
    }

    // ── parse_importable_errors: Format E (NSG association) ─────────────

    #[test]
    fn parse_nsg_association_error() {
        let output = r#"Error: an association between "/subscriptions/edd4cc45/resourceGroups/rg-hub/providers/Microsoft.Network/virtualNetworks/vnet-hub/subnets/snet-hub-container" and "/subscriptions/edd4cc45/resourceGroups/rg-hub/providers/Microsoft.Network/networkSecurityGroups/nsg-hub" already exists - to be managed via Terraform this association needs to be imported into the State. Please see the resource documentation for "azurerm_subnet_network_security_group_association" for more information

  with module.hub[0].module.hub_network.azurerm_subnet_network_security_group_association.workspace_subnets["container"],
  on modules/virtual_network/subnets.tf line 25, in resource "azurerm_subnet_network_security_group_association" "workspace_subnets":
  25: resource "azurerm_subnet_network_security_group_association" "workspace_subnets" {
"#;
        let results = parse_importable_errors(output);
        assert_eq!(results.len(), 1);
        match &results[0] {
            ImportableResource::Azurerm { tf_address, import_id } => {
                assert_eq!(
                    tf_address,
                    r#"module.hub[0].module.hub_network.azurerm_subnet_network_security_group_association.workspace_subnets["container"]"#
                );
                assert_eq!(
                    import_id,
                    "/subscriptions/edd4cc45/resourceGroups/rg-hub/providers/Microsoft.Network/virtualNetworks/vnet-hub/subnets/snet-hub-container"
                );
            }
            other => panic!("expected Azurerm, got {:?}", other),
        }
    }

    #[test]
    fn parse_mixed_azurerm_and_nsg_association() {
        let output = r#"Error: a resource with the ID "/subscriptions/x/resourceGroups/rg" already exists
  with azurerm_resource_group.this[0],
  on main.tf line 1

Error: an association between "/subscriptions/x/subnets/snet-host" and "/subscriptions/x/nsg/nsg-1" already exists
  with module.net.azurerm_subnet_network_security_group_association.workspace_subnets["host"],
  on subnets.tf line 25

Error: an association between "/subscriptions/x/subnets/snet-container" and "/subscriptions/x/nsg/nsg-1" already exists
  with module.net.azurerm_subnet_network_security_group_association.workspace_subnets["container"],
  on subnets.tf line 25
"#;
        let results = parse_importable_errors(output);
        assert_eq!(results.len(), 3);
        match &results[0] {
            ImportableResource::Azurerm { import_id, .. } => {
                assert_eq!(import_id, "/subscriptions/x/resourceGroups/rg");
            }
            other => panic!("expected Azurerm, got {:?}", other),
        }
        match &results[1] {
            ImportableResource::Azurerm { import_id, .. } => {
                assert_eq!(import_id, "/subscriptions/x/subnets/snet-host");
            }
            other => panic!("expected Azurerm, got {:?}", other),
        }
        match &results[2] {
            ImportableResource::Azurerm { import_id, .. } => {
                assert_eq!(import_id, "/subscriptions/x/subnets/snet-container");
            }
            other => panic!("expected Azurerm, got {:?}", other),
        }
    }

    #[test]
    fn nsg_association_siblings_grouped_together() {
        let output = r#"Error: an association between "/subscriptions/x/subnets/snet-host" and "/subscriptions/x/nsg/nsg-1" already exists
  with module.hub[0].module.hub_network.azurerm_subnet_network_security_group_association.workspace_subnets["host"],
  on subnets.tf line 25

Error: an association between "/subscriptions/x/subnets/snet-container" and "/subscriptions/x/nsg/nsg-1" already exists
  with module.hub[0].module.hub_network.azurerm_subnet_network_security_group_association.workspace_subnets["container"],
  on subnets.tf line 25
"#;
        let results = parse_importable_errors(output);
        assert_eq!(results.len(), 2);

        let (sibling_groups, standalone) = group_for_each_siblings(&results);
        assert_eq!(sibling_groups.len(), 1);
        assert!(standalone.is_empty());
        assert_eq!(sibling_groups[0].len(), 2);
    }

    // ── resolve_import_pair: AzureRoleAssignment ────────────────────────

    #[test]
    fn resolve_import_pair_role_assignment_returns_none() {
        let resource = ImportableResource::AzureRoleAssignment {
            tf_address: "azurerm_role_assignment.uc_storage_access[0]".to_string(),
        };
        assert!(resolve_import_pair(&resource, &None).is_none());
        assert!(resolve_import_pair(&resource, &Some("ncc-123".to_string())).is_none());
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

    // ── tf_address helper ─────────────────────────────────────────────

    #[test]
    fn tf_address_returns_address_for_all_variants() {
        let azurerm = ImportableResource::Azurerm {
            tf_address: "azurerm_subnet.main".into(),
            import_id: "/subs/123".into(),
        };
        assert_eq!(azurerm.tf_address(), "azurerm_subnet.main");

        let pe = ImportableResource::DatabricksPeRule {
            tf_address: "databricks_pe.rule".into(),
            rule_id: "rule-1".into(),
        };
        assert_eq!(pe.tf_address(), "databricks_pe.rule");

        let generic = ImportableResource::DatabricksGeneric {
            tf_address: "databricks_network_policy.this".into(),
            import_id: "p-1".into(),
        };
        assert_eq!(generic.tf_address(), "databricks_network_policy.this");

        let role = ImportableResource::AzureRoleAssignment {
            tf_address: "azurerm_role_assignment.uc[0]".into(),
        };
        assert_eq!(role.tf_address(), "azurerm_role_assignment.uc[0]");
    }

    // ── group_for_each_siblings ───────────────────────────────────────

    #[test]
    fn group_for_each_siblings_groups_map_keyed_resources() {
        let resources = vec![
            ImportableResource::Azurerm {
                tf_address: r#"module.hub[0].azurerm_subnet.workspace_subnets["host"]"#.into(),
                import_id: "/subs/host".into(),
            },
            ImportableResource::Azurerm {
                tf_address: r#"module.hub[0].azurerm_subnet.workspace_subnets["container"]"#.into(),
                import_id: "/subs/container".into(),
            },
        ];

        let (siblings, standalone) = group_for_each_siblings(&resources);
        assert_eq!(siblings.len(), 1);
        assert_eq!(siblings[0].len(), 2);
        assert!(standalone.is_empty());
    }

    #[test]
    fn group_for_each_siblings_does_not_group_count_indexes() {
        let resources = vec![
            ImportableResource::Azurerm {
                tf_address: "module.hub[0].azurerm_resource_group.rg".into(),
                import_id: "/subs/rg0".into(),
            },
            ImportableResource::Azurerm {
                tf_address: "module.hub[1].azurerm_resource_group.rg".into(),
                import_id: "/subs/rg1".into(),
            },
        ];

        let (siblings, standalone) = group_for_each_siblings(&resources);
        assert!(siblings.is_empty());
        assert_eq!(standalone.len(), 2);
    }

    #[test]
    fn group_for_each_siblings_mixed() {
        let resources = vec![
            ImportableResource::Azurerm {
                tf_address: r#"azurerm_subnet.sn["a"]"#.into(),
                import_id: "/subs/a".into(),
            },
            ImportableResource::Azurerm {
                tf_address: r#"azurerm_subnet.sn["b"]"#.into(),
                import_id: "/subs/b".into(),
            },
            ImportableResource::Azurerm {
                tf_address: "azurerm_resource_group.rg".into(),
                import_id: "/subs/rg".into(),
            },
        ];

        let (siblings, standalone) = group_for_each_siblings(&resources);
        assert_eq!(siblings.len(), 1);
        assert_eq!(siblings[0].len(), 2);
        assert_eq!(standalone.len(), 1);
        assert_eq!(standalone[0].tf_address(), "azurerm_resource_group.rg");
    }

    #[test]
    fn group_for_each_siblings_single_for_each_goes_standalone() {
        let resources = vec![ImportableResource::Azurerm {
            tf_address: r#"azurerm_subnet.sn["only_one"]"#.into(),
            import_id: "/subs/only".into(),
        }];

        let (siblings, standalone) = group_for_each_siblings(&resources);
        assert!(siblings.is_empty());
        assert_eq!(standalone.len(), 1);
    }

    // ── write_import_blocks ───────────────────────────────────────────

    #[test]
    fn write_import_blocks_creates_valid_hcl() {
        let dir = tempfile::tempdir().unwrap();
        let pairs = vec![
            (
                r#"module.hub[0].azurerm_subnet.workspace_subnets["host"]"#.to_string(),
                "/subs/host-id".to_string(),
            ),
            (
                r#"module.hub[0].azurerm_subnet.workspace_subnets["container"]"#.to_string(),
                "/subs/container-id".to_string(),
            ),
        ];

        let path = write_import_blocks(&pairs, dir.path()).unwrap();
        assert!(path.exists());

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains(r#"to = module.hub[0].azurerm_subnet.workspace_subnets["host"]"#));
        assert!(content.contains(r#"id = "/subs/host-id""#));
        assert!(content.contains(r#"to = module.hub[0].azurerm_subnet.workspace_subnets["container"]"#));
        assert!(content.contains(r#"id = "/subs/container-id""#));
        assert_eq!(content.matches("import {").count(), 2);
    }

    #[test]
    fn cleanup_import_file_removes_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(AUTO_IMPORT_FILENAME);
        fs::write(&path, "import {}").unwrap();
        assert!(path.exists());

        cleanup_import_file(dir.path());
        assert!(!path.exists());
    }

    #[test]
    fn cleanup_import_file_noop_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        cleanup_import_file(dir.path());
    }
}

