---
name: terraform-template-updates
description: Update Terraform templates bundled with the Databricks Deployer app. Use when modifying template .tf files, adding new Terraform variables, creating new deployment templates, or changing template infrastructure code.
---

# Updating Terraform Templates

## Template locations

Templates live in `src-tauri/templates/{cloud}-{type}/`:

```
src-tauri/templates/
├── aws-simple/
├── aws-sra/
├── azure-simple/
├── azure-sra/
├── gcp-simple/
└── gcp-sra/
```

Each template is a Terraform module with at minimum `variables.tf` and `providers.tf`.

## Workflow

### Step 1: Modify the template files

Edit `.tf` files under the target template directory. The `variables.tf` file is parsed at runtime by the Rust backend to generate the configuration form.

Variable blocks must follow this structure for the parser to extract them:

```hcl
variable "name" {
  description = "Human-readable description"
  type        = string
  default     = "optional-default"
  sensitive   = true  # optional
  validation {        # optional
    condition     = length(var.name) > 0
    error_message = "Name cannot be empty."
  }
}
```

The parser extracts: name, description, type, default, required (no default = required), sensitive, and validation.

### Step 2: Bump TEMPLATES_VERSION

In `src-tauri/src/commands/mod.rs`, increment the version string:

```rust
pub(crate) const TEMPLATES_VERSION: &str = "x.y.z";  // bump this
```

This triggers cache invalidation — existing app installs will re-extract templates on next launch.

### Step 3: Update frontend constants (if variables changed)

In `src/constants/templates.ts`, update any relevant maps:

- **`VARIABLE_DISPLAY_NAMES`** — human-readable label for new variables
- **`VARIABLE_DESCRIPTION_OVERRIDES`** — custom descriptions (overrides what's in `variables.tf`)
- **`EXCLUDE_VARIABLES`** — variables hidden from the form (credentials, internal vars)
- **`OBJECT_FIELD_DECOMPOSITION`** — split complex object variables into sub-fields
- **`LIST_FIELD_DECOMPOSITION`** — split list variables into indexed fields
- **`CONDITIONAL_FIELD_VISIBILITY`** — boolean toggle that shows/hides other fields
- **`CONDITIONAL_SELECT_VISIBILITY`** — select-based show/hide logic
- **`COMPLIANCE_STANDARDS`** — compliance standard options per template (e.g. HIPAA, PCI-DSS)
- **`FQDN_GROUPS`** — FQDN URL groups for firewall/network templates
- **`FIELD_GROUPS`** — visually group multiple standalone variables under a styled subsection box (label + description + field list). Used for related fields that aren't part of a single Terraform object (e.g. "Existing Databricks Account Resources" groups `existing_ncc_id`, `existing_ncc_name`, `existing_network_policy_id`)

If the variable has a new section grouping, also update `groupVariablesBySection()` in `src/utils/variables.ts`.

### Step 4: Adding a brand-new template

If you're adding an entirely new template (not just modifying an existing one):

1. Create the directory `src-tauri/templates/{cloud}-{name}/` with `.tf` files
2. Register it in `src-tauri/src/commands/templates.rs` inside `get_templates()` — add a new entry with id, name, cloud, description, and features list
3. Follow steps 2-3 above

### Checklist

- [ ] Template `.tf` files modified
- [ ] `TEMPLATES_VERSION` bumped in `src-tauri/src/commands/mod.rs`
- [ ] `VARIABLE_DISPLAY_NAMES` updated for any new variables
- [ ] Variables that should be hidden added to `EXCLUDE_VARIABLES`
- [ ] Complex variables handled via `OBJECT_FIELD_DECOMPOSITION` or `LIST_FIELD_DECOMPOSITION`
- [ ] Related standalone variables grouped via `FIELD_GROUPS` if applicable
- [ ] Conditional visibility configured if needed
- [ ] `COMPLIANCE_STANDARDS` updated if template supports compliance options
- [ ] `FQDN_GROUPS` updated if template uses firewall/FQDN filtering
- [ ] If new "already exists" error patterns: update `ImportableResource` enum, regex, and `resolve_import_pair()` in `terraform.rs`

## Auto-import and retry (for "already exists" errors)

When `terraform apply` fails because resources already exist, the backend automatically:

1. Parses the error output with `parse_importable_errors()` in `terraform.rs`
2. Detects four resource types: `Azurerm` (Azure resource IDs), `AzureRoleAssignment` (409 RoleAssignmentExists — ID resolved at import time via Azure CLI), `DatabricksPeRule` (Private Endpoint rule IDs), `DatabricksGeneric` (NCC / network policies)
3. Runs `terraform import` for each detected resource
4. Retries `terraform apply` (up to 3 rounds)

This logic lives entirely in `terraform.rs` — the helpers are:

- `parse_importable_errors(output)` → `Vec<ImportableResource>` — regex-based error parser
- `resolve_import_pair(resource, ncc_id)` → `(tf_address, import_id)` — maps a resource to its import arguments (returns `None` for `AzureRoleAssignment`)
- `resolve_azure_role_assignment_id(tf_address, dir, env)` → runs `terraform show -json` + `az role assignment list` to look up the assignment GUID at import time
- `build_import_env(base_env)` → injects placeholder provider URLs needed during import
- `run_import_batch(resources, ncc_id, dir, env, log)` → runs all imports, returns success (handles deferred `AzureRoleAssignment` resolution inline)
- `import_and_retry_apply(dir, env, status, process)` → full orchestration: parse → import → retry

### Adding support for a new "already exists" pattern

If a Terraform provider returns a new "already exists" error format:

1. Add a new variant to the `ImportableResource` enum in `terraform.rs`
2. Add a new `lazy_static!` regex in `parse_importable_errors()`
3. Handle the new variant in `resolve_import_pair()` (or defer resolution in `run_import_batch()` if the import ID isn't in the error message)
4. Add test cases in the `parse_importable_errors` test section

### Provider overrides for import

Some Databricks resources require a placeholder workspace URL during `terraform import` because the provider config references a workspace that doesn't exist yet. The `build_import_env()` helper injects `DATABRICKS_HOST` with a placeholder URL (`https://placeholder.azuredatabricks.net`) so imports don't fail on provider initialization.

## Reference

- Variable parser: `parse_variables_tf()` in `src-tauri/src/terraform.rs`
- Import/retry logic: `import_and_retry_apply()` in `src-tauri/src/terraform.rs`
- Auto-set variables (hidden from UI): `INTERNAL_VARIABLES` in `src-tauri/src/commands/mod.rs`
- Template setup and cache logic: `setup_templates()` in `src-tauri/src/commands/templates.rs`
