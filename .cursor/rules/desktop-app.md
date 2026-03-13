---
description: Always-on project context for the Databricks Deployer desktop app. Provides architecture, conventions, and file locations.
globs:
  - "**/*"
---

# Databricks Deployer — Desktop App

Tauri 2 desktop wizard that deploys Databricks workspaces via Terraform across AWS, Azure, and GCP.

## Tech Stack

- **Frontend**: React 18, TypeScript 5.3, Vite 5
- **Backend**: Rust 2021 edition, Tauri 2, Tokio
- **Testing**: Vitest + @testing-library/react (frontend), `cargo test` (backend)
- **Styling**: Single `src/styles.css` file — no Tailwind, no CSS modules
- **State**: React Context only — no Redux, Zustand, or other libraries
- **Routing**: Custom `WizardRouter` with screen-based switching — no React Router

## Architecture

Frontend calls Rust via `invoke()` from `@tauri-apps/api/core`. Commands are `#[tauri::command]` functions in `src-tauri/src/commands/*.rs`, registered in `lib.rs` via `generate_handler![]`.

```
Frontend invoke("command_name", { args })
  → lib.rs invoke_handler → commands::command_name
  → commands/{module}.rs #[tauri::command] fn
  → Returns Result<T, String> → serialized to frontend
```

## Wizard Flow

```
WelcomeScreen → CloudSelectionScreen → DependenciesScreen
  → [AwsCredentialsScreen | AzureCredentialsScreen | GcpCredentialsScreen]
  → DatabricksCredentialsScreen → TemplateSelectionScreen
  → ConfigurationScreen → UnityCatalogConfigScreen (skipped for GCP SRA)
  → DeploymentScreen
```

`AppScreen` union type in `types/wizard.ts`:
`welcome | cloud-selection | dependencies | aws-credentials | azure-credentials | gcp-credentials | databricks-credentials | template-selection | configuration | unity-catalog-config | deployment`

## Screens

| Screen | Path | Purpose | Tauri commands used |
|--------|------|---------|---------------------|
| **WelcomeScreen** | `screens/WelcomeScreen.tsx` | Intro, feature grid, "Get Started" | — |
| **CloudSelectionScreen** | `screens/CloudSelectionScreen.tsx` | Choose Azure/AWS/GCP | — |
| **DependenciesScreen** | `screens/DependenciesScreen.tsx` | Check Terraform, Git, cloud CLI, Databricks CLI; install Terraform; connectivity check | `check_dependencies`, `check_terraform_connectivity`, `install_terraform` |
| **AwsCredentialsScreen** | `screens/credentials/AwsCredentialsScreen.tsx` | AWS profile or access keys, SSO login, permission check | `get_aws_profiles`, `get_aws_identity`, `aws_sso_login`, `check_aws_permissions` |
| **AzureCredentialsScreen** | `screens/credentials/AzureCredentialsScreen.tsx` | Azure CLI or service principal, subscription selection | `get_azure_account`, `get_azure_subscriptions`, `azure_login`, `set_azure_subscription`, `check_azure_permissions` |
| **GcpCredentialsScreen** | `screens/credentials/GcpCredentialsScreen.tsx` | ADC or service account key, browser login, project dropdown, create SA, permission check | `validate_gcp_credentials`, `gcp_login`, `get_gcp_projects`, `create_gcp_service_account`, `check_gcp_permissions` |
| **DatabricksCredentialsScreen** | `screens/credentials/DatabricksCredentialsScreen.tsx` | Databricks profile or SP, GCP/Azure identity modes | `get_databricks_profiles`, `get_databricks_profile_credentials`, `validate_databricks_credentials`, `create_databricks_sp_profile` |
| **TemplateSelectionScreen** | `screens/TemplateSelectionScreen.tsx` | Pick template for selected cloud | `get_templates`, `get_template_variables` |
| **ConfigurationScreen** | `screens/ConfigurationScreen.tsx` | Terraform variables form, sections, validation, CIDR helpers, resource name conflict pre-check | `get_template_variables`, `get_azure_resource_groups`, `get_azure_vnets`, `check_resource_names_available`, `check_resource_names_available_sp` |
| **UnityCatalogConfigScreen** | `screens/UnityCatalogConfigScreen.tsx` | UC catalog/storage, metastore detection, permissions | `check_uc_permissions` |
| **DeploymentScreen** | `screens/DeploymentScreen.tsx` | Terraform init/plan/apply, review, rollback, Git integration | `save_configuration`, `run_terraform_command`, `get_deployment_status`, `reset_deployment_status`, `cancel_deployment`, `rollback_deployment`, `open_folder`, `get_deployments_folder` |

## Rust Command Modules

| Module | Key commands |
|--------|-------------|
| `commands/deployment.rs` | `check_dependencies`, `check_terraform_connectivity`, `install_terraform`, `save_configuration`, `run_terraform_command`, `get_deployment_status`, `reset_deployment_status`, `cancel_deployment`, `rollback_deployment`, `get_cloud_credentials`, `get_deployments_folder`, `open_folder`, `open_url` |
| `commands/templates.rs` | `get_templates`, `get_template_variables`, `clear_templates_cache` |
| `commands/aws.rs` | `get_aws_profiles`, `get_aws_identity`, `aws_sso_login`, `check_aws_permissions` |
| `commands/azure.rs` | `get_azure_account`, `get_azure_subscriptions`, `azure_login`, `cancel_cli_login`, `set_azure_subscription`, `get_azure_resource_groups`, `get_azure_resource_groups_sp`, `get_azure_vnets`, `get_azure_vnets_sp`, `check_resource_names_available`, `check_resource_names_available_sp`, `check_azure_permissions` |
| `commands/gcp.rs` | `validate_gcp_credentials`, `gcp_login`, `get_gcp_projects`, `validate_gcp_databricks_access`, `validate_gcp_databricks_access_with_key`, `check_gcp_permissions`, `create_gcp_service_account`, `add_service_account_to_databricks` |
| `commands/databricks.rs` | `get_databricks_profiles`, `databricks_cli_login`, `get_databricks_profile_credentials`, `create_databricks_sp_profile`, `validate_databricks_credentials`, `validate_databricks_profile`, `check_uc_permissions`, `validate_azure_databricks_identity` |
| `commands/github.rs` | `git_get_status`, `preview_tfvars_example`, `git_init_repo`, `git_check_remote`, `git_push_to_remote`, `github_device_auth_start`, `github_device_auth_poll`, `github_get_auth`, `github_logout`, `github_create_repo` |
| `commands/assistant.rs` | `assistant_save_token`, `assistant_chat`, `assistant_get_settings`, `assistant_switch_provider`, `assistant_reconnect`, `assistant_delete_provider_key`, `assistant_delete_all_keys`, `assistant_get_available_models`, `assistant_update_model`, `assistant_save_history`, `assistant_clear_history` |

## Supporting Rust Modules

| File | Purpose |
|------|---------|
| `crypto.rs` | AES-256-GCM encryption for secrets at rest (`enc:v1:` format) |
| `dependencies.rs` | CLI detection and version checks for Terraform, Git, AWS, Azure, gcloud, Databricks |
| `terraform.rs` | `parse_variables_tf()`, `generate_tfvars()`, `run_terraform()`, `check_state_exists()`, `stream_and_wait()`, `parse_importable_errors()`, `run_terraform_import()`, `import_and_retry_apply()`, `resolve_ncc_id()`, `resolve_azure_role_assignment_id()`, `build_import_env()`, `run_import_batch()`, `DEPLOYMENT_STATUS` / `CURRENT_PROCESS` globals |
| `errors.rs` | `cli_not_found()`, `auth_expired()`, `not_logged_in()` helpers |
| `proxy.rs` | System proxy detection (macOS `scutil` / Windows registry), `get_proxy_env_vars()` for Terraform child processes, `get_https_proxy()` for `http_client()` |
| `commands/mod.rs` | `cancel_cli_login`; Module wiring, re-exports, `TEMPLATES_VERSION`, `INTERNAL_VARIABLES`, `CLI_LOGIN_PROCESS` (shared login PID), `acquire_login_slot()` / `release_login_slot()` for thread-safe login tracking, `silent_cmd()` (suppresses console windows on Windows), shared types (`Template`, `CloudCredentials`, `CloudPermissionCheck`, `MetastoreInfo`, `UCPermissionCheck`), helpers (`sanitize_deployment_name`, `http_client` (auto-injects proxy), `databricks_accounts_host`, `lock_or_recover`, etc.) |

## Templates

Templates live in `src-tauri/templates/{cloud}-{type}/` and are bundled as Tauri resources.

| Template | Purpose |
|----------|---------|
| `aws-simple` | AWS Standard BYOVPC — secure baseline with customer-managed VPC |
| `aws-sra` | AWS Security Reference Architecture — PrivateLink, CMK, compliance |
| `azure-simple` | Azure Standard VNet — secure baseline with VNet injection |
| `azure-sra` | Azure Security Reference Architecture — hub-spoke, Private Endpoints, CMK |
| `gcp-simple` | GCP Standard BYOVPC — secure baseline with customer-managed VPC |
| `gcp-sra` | GCP Security Reference Architecture — PSC, CMEK, hardened network |

## Frontend Hooks

| Hook | Purpose |
|------|---------|
| `useWizard` | Main wizard state, screen navigation, cloud/template/credentials management |
| `useDeployment` | Terraform deployment lifecycle (init → plan → apply), status polling |
| `useAwsAuth` | AWS profiles, identity verification, SSO login, `loginInProgress` state, `cancelSsoLogin` |
| `useAzureAuth` | Azure account, subscriptions, resource groups, VNets, `loginInProgress` state, `cancelLogin` |
| `useGcpAuth` | GCP credential validation, browser login, project listing, service account creation |
| `useDatabricksAuth` | Databricks profiles, SP creation, OAuth |
| `useUnityCatalog` | UC config, metastore check, permission validation |
| `useGitHub` | GitHub device auth, Git init/push, repo creation |
| `useAssistant` | AI assistant chat, settings, provider management |
| `useSsoPolling` | SSO device code polling loop |
| `usePersistedCollapse` | Boolean state persisted in `sessionStorage` (resets on app close, persists during navigation) |

## Frontend Constants

| File | Exports |
|------|---------|
| `constants/cloud.ts` | `CLOUDS`, `CLOUD_DISPLAY_NAMES`, `AWS_REGIONS`, `AZURE_REGIONS`, `GCP_REGIONS` |
| `constants/templates.ts` | `VARIABLE_DISPLAY_NAMES`, `VARIABLE_DESCRIPTION_OVERRIDES`, `PLACEHOLDER_OVERRIDES`, `EXCLUDE_VARIABLES`, `OBJECT_FIELD_DECOMPOSITION`, `LIST_FIELD_DECOMPOSITION`, `CONDITIONAL_FIELD_VISIBILITY`, `CONDITIONAL_SELECT_VISIBILITY`, `COMPLIANCE_STANDARDS`, `FQDN_GROUPS`, `FIELD_GROUPS` |
| `constants/assistant.ts` | `ASSISTANT`, `ASSISTANT_PROVIDERS`, `SCREEN_CONTEXT`, `ASSISTANT_SAMPLE_QUESTIONS` |
| `constants/ui.ts` | `POLLING`, `UI`, `DEFAULTS` |

## Frontend Utils

| File | Purpose |
|------|---------|
| `utils/variables.ts` | `groupVariablesBySection()`, `formatVariableName()`, `initializeFormDefaults()`, `generateRandomSuffix()` |
| `utils/cidr.ts` | `computeSubnets()`, `computeAwsSubnets()`, `computeAwsSraSubnets()`, `cidrsOverlap()`, `parseCidr()`, `getUsableNodes()` |
| `utils/cloudValidation.ts` | `validateAwsCredentials()`, `validateAzureCredentials()` |
| `utils/databricksValidation.ts` | `validateDatabricksCredentials()`, `getDatabricksValidationCommand()` |

## Types

| File | Key types |
|------|-----------|
| `types/wizard.ts` | `AppScreen`, `DependencyStatus`, `Template`, `TerraformVariable`, `DeploymentStatus` |
| `types/cloud.ts` | `CloudCredentials`, `AwsProfile`, `AwsIdentity`, `AzureSubscription`, `AzureAccount`, `AzureVnet`, `GcpProject`, `GcpValidation`, `CloudPermissionCheck` |
| `types/databricks.ts` | `DatabricksProfile`, `UnityCatalogConfig`, `MetastoreInfo`, `UCPermissionCheck` |
| `types/assistant.ts` | `ChatMessage`, `AssistantSettings`, `ModelOption` |
| `types/github.ts` | `GitRepoStatus`, `GitOperationResult`, `TfVarPreviewEntry`, `DeviceCodeResponse`, `DeviceAuthPollResult`, `GitHubAuthStatus`, `GitHubRepo` |

## UI Components

| Component | Path | Purpose |
|-----------|------|---------|
| **Alert** | `ui/Alert.tsx` | Info/warning/error/success alerts |
| **FormGroup** | `ui/FormGroup.tsx` | Label + input wrapper |
| **PasswordInput** | `ui/PasswordInput.tsx` | Password field with show/hide |
| **LoadingSpinner** | `ui/LoadingSpinner.tsx` | Loading indicator |
| **ErrorBoundary** | `ui/ErrorBoundary.tsx` | Error boundary |
| **PermissionWarningDialog** | `ui/PermissionWarningDialog.tsx` | Cloud permission warning |
| **AuthModeSelector** | `ui/AuthModeSelector.tsx` | Auth mode radio group |
| **AzureAdminDialog** | `ui/AzureAdminDialog.tsx` | Azure admin consent dialog |

## Other Components

| Component | Path | Purpose |
|-----------|------|---------|
| **WizardRouter** | `components/WizardRouter.tsx` | Screen router, step indicator, CSS transitions |
| **GitIntegrationCard** | `components/GitIntegrationCard.tsx` | Git init, push, GitHub repo creation, tfvars preview |
| **AssistantPanel** | `components/assistant/AssistantPanel.tsx` | AI side panel, chat UI, sample questions |
| **AssistantMessage** | `components/assistant/AssistantMessage.tsx` | Chat message rendering (markdown) |
| **AssistantSetup** | `components/assistant/AssistantSetup.tsx` | API key setup flow |
| **AssistantSettingsModal** | `components/assistant/AssistantSettingsModal.tsx` | Provider/model settings |

## Context Providers

| Context | Path | Purpose |
|---------|------|---------|
| **WizardContext** | `context/WizardContext.tsx` | Wizard state, credentials, cloud selection, templates, screen navigation, `goBack` |
| **AssistantContext** | `context/AssistantContext.tsx` | Assistant open/close, messages, send, provider/model selection |

## Conventions

### Rust (src-tauri/)

- Command functions: `snake_case` names, `#[tauri::command]` attribute
- Types: `PascalCase`, derive `Serialize` + `Deserialize`
- Errors: always `Result<T, String>`, never `unwrap()` or `expect()` in commands
- Error helpers: `crate::errors::cli_not_found()`, `auth_expired()`, `not_logged_in()`
- Internal helpers: `pub(crate)` visibility
- Debug output: `debug_log!()` macro (only emits in debug builds)
- Input validation: private `validate_*` functions before use
- Shared types and helpers live in `commands/mod.rs`
- **Mutex access**: Use `lock_or_recover()` from `commands/mod.rs` for safe mutex access — it recovers from poisoned mutexes and logs a warning instead of panicking
- **Shared login PID**: `CLI_LOGIN_PROCESS` in `commands/mod.rs` is shared between `aws.rs`, `azure.rs`, and `gcp.rs` — do not declare per-module duplicates. Use `acquire_login_slot()` / `release_login_slot()` to register and release login processes
- **Regex compilation**: Use `lazy_static!` for `Regex::new()` — never compile regex patterns per function call
- **Terraform helpers**: Keep Terraform I/O, import, and retry logic in `terraform.rs` — `deployment.rs` should call high-level helpers like `stream_and_wait()` and `import_and_retry_apply()`

### Frontend (src/)

- **Hooks**: export a `UseXxxReturn` interface, use `invoke` for IPC, expose `cleanup()` for teardown, barrel-export from `hooks/index.ts` with `export type` for type-only exports
- **Types**: domain-specific files in `types/` (cloud, wizard, databricks, assistant, github), re-exported via `export type` from `types/index.ts`
- **Screens**: `React.FC` using `useWizard()` for all state, no props, `container` layout class, `default` export
- **UI components**: barrel-exported from `components/ui/index.ts`
- **Constants**: barrel-exported from `constants/index.ts`
- **Wizard flow**: `AppScreen` union type in `types/wizard.ts`, switch-routed in `WizardRouter.tsx`, back-navigation in `WizardContext.tsx` `goBack`
- **Tests**: Vitest with jsdom, `renderHook` + `act` for hooks, global `invoke` mock in `test/setup.ts`, test files under `src/test/` mirroring `src/`
- **Race condition prevention**: Use `useRef` request IDs in `WizardContext` to discard stale async results when the user rapidly switches templates or triggers overlapping requests
- **Cancel/cleanup**: Auth hooks (`useAwsAuth`, `useAzureAuth`) must reset `loginInProgress` on cancel — call `setLoginInProgress(false)` after `invoke("cancel_cli_login")`

## File Location Reference

| Task | Where |
|------|-------|
| Add a Tauri command | `src-tauri/src/commands/{module}.rs` → re-export in `commands/mod.rs` → register in `lib.rs` `generate_handler![]` |
| Add a wizard screen | `types/wizard.ts` (AppScreen union) → `components/screens/` → `WizardRouter.tsx` → `WizardContext.tsx` (goBack) |
| Add a custom hook | `hooks/use{Name}.ts` → barrel in `hooks/index.ts` |
| Add shared types | `types/{domain}.ts` → barrel in `types/index.ts` |
| Add styling | `styles.css` (everything goes here) |
| Add/modify templates | `src-tauri/templates/{cloud}-{type}/` → bump `TEMPLATES_VERSION` in `commands/mod.rs` |
| Template UI metadata | `constants/templates.ts` (display names, descriptions, exclusions, decompositions, visibility) |
| Rust shared types/helpers | `src-tauri/src/commands/mod.rs` |
| Terraform import/retry/streaming | `src-tauri/src/terraform.rs` (helpers called by `deployment.rs`) |
| Shared mutex (CLI login PID) | `CLI_LOGIN_PROCESS` in `src-tauri/src/commands/mod.rs` |
| Variable grouping/sections | `utils/variables.ts` |
| Cloud regions | `constants/cloud.ts` |
| Assistant config | `constants/assistant.ts` (providers, screen context, sample questions) |
| CIDR/subnet logic | `utils/cidr.ts` |

## Do Not

- Add new CSS files or CSS modules — all styles go in `src/styles.css`
- Add state management libraries (Redux, Zustand, Jotai, etc.)
- Add a router library — use the `WizardRouter` pattern
- Use `unwrap()` or `expect()` in Rust command functions
- Use `mutex.lock().unwrap()` directly — use `lock_or_recover()` helper
- Declare `CLI_LOGIN_PROCESS` in individual command modules — it lives in `commands/mod.rs`
- Compile `Regex::new()` inside function bodies — use `lazy_static!` blocks
- Put Terraform I/O streaming or import/retry logic in `deployment.rs` — it belongs in `terraform.rs`
- Add dependencies without justification — the app is intentionally minimal
- Add comments that merely narrate what code does
