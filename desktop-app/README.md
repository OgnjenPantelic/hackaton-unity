# Databricks Deployer

Desktop app for deploying Databricks workspaces on AWS, Azure, and GCP using Terraform.

**Download:** See [GitHub Releases](https://github.com/OgnjenPantelic/workspace-creator/releases) for the latest builds.

## Features

- Guided deployment wizard for AWS, Azure, and GCP
- Template-based deployments with per-cloud template selection
- VNet injection (Azure) / BYOVPC (AWS) / Customer-managed VPC (GCP)
- Unity Catalog metastore auto-detection and assignment
- Catalog creation with isolated storage (S3 / Azure Storage / GCS)
- Auto-installs Terraform if missing (v1.9.8)
- Supports CLI profiles, SSO, and service principal authentication
- Azure identity for Databricks (no service principal needed with Azure CLI + Account Admin)
- GCP service account creation with custom IAM role and impersonation setup
- Cloud-specific permission validation before deployment
- Auto-import and retry when Terraform hits "resource already exists" errors (Azure resource groups, Databricks network policies, Private Endpoint rules)
- Resource name conflict detection for Azure — warns before deployment if resource groups already exist
- Real-time resource timeline during deployment showing creation/destruction progress per resource
- Rollback support (terraform destroy with resource cleanup)
- Git integration with `terraform.tfvars.example` generation, GitHub OAuth device flow, repo creation, and push
- AI Assistant with contextual help for each screen (GitHub Models free, OpenAI, Claude)
- Settings menu on welcome screen (open deployments folder)
- Single-instance enforcement (prevents running multiple copies)

## Prerequisites

| Requirement | Status | Notes |
|-------------|--------|-------|
| Git | Required | For Terraform module downloads |
| Terraform | Required | Auto-installed if missing (v1.9.8) |
| Databricks CLI | Optional | Enables profile-based auth |
| AWS CLI | Optional | For AWS deployments, SSO supported |
| Azure CLI | Optional | For Azure deployments |
| Google Cloud CLI | Optional | For GCP deployments (ADC and impersonation) |

## Quick Start

1. Download from Releases or build from source
2. Select cloud provider (AWS, Azure, or GCP)
3. Verify dependencies (Terraform, Git, cloud CLIs)
4. Enter cloud credentials (CLI profile, service principal, or ADC)
5. Enter Databricks credentials (profile, service principal, or Azure identity)
6. Select deployment template
7. Configure workspace (name, region, networking)
8. Configure Unity Catalog (optional -- auto-detects existing metastore)
9. Review and deploy

## AI Assistant

The app includes an embedded AI assistant that provides contextual help for each screen.

### Features
- Context-aware responses based on current screen and app state
- Markdown-formatted answers with code blocks and links
- Remembers conversation history (last 20 messages)
- Privacy-first: your data goes directly to your chosen provider, never through our servers

### Supported Providers

| Provider | Cost | Notes |
|----------|------|-------|
| GitHub Models | Free | Recommended. Rate-limited. Requires GitHub PAT with `models:read` permission |
| OpenAI | Paid | Requires OpenAI API key |
| Claude | Paid | Requires Anthropic API key |

### Setup

1. Click the chat icon in the bottom-right corner
2. Select a provider
3. Click "Get API Key" to open the provider's key creation page in your browser
4. Paste your API key and click "Connect"

**GitHub Models (Free):**
- Create a Fine-grained Personal Access Token at https://github.com/settings/personal-access-tokens/new
- Set permissions: Account permissions → Models → Read-only
- Copy and paste the `github_pat_...` token

**OpenAI:**
- Create an API key at https://platform.openai.com/api-keys
- Copy and paste the `sk-proj-...` key

**Claude:**
- Create an API key at https://console.anthropic.com/settings/keys
- Copy and paste the `sk-ant-...` key

### Model Selection (GitHub Models Only)

GitHub Models users can choose from multiple models:
1. Click the settings gear icon in the chat header
2. Select your preferred model (e.g., GPT-4o, Llama, Phi-4)
3. Click "Save"

The model list is fetched dynamically and cached for 24 hours.

### Rate Limits

**GitHub Models (Free):**
- Rate limited by requests per minute/day
- Limits vary by model (larger models have stricter limits)
- Switch to OpenAI/Claude if you hit limits

**OpenAI/Claude:**
- Rate limits based on your account tier
- Check provider documentation for details

## Deployment Storage

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/com.databricks.deployer/deployments/` |
| Windows | `%APPDATA%\com.databricks.deployer\deployments\` |
| Linux | `~/.local/share/com.databricks.deployer/deployments/` |

## Auto-Import and Retry

When `terraform apply` fails because cloud resources already exist (e.g. after a partial deployment), the app automatically:

1. Parses the error output for "already exists" patterns
2. Runs `terraform import` for each detected resource
3. Retries `terraform apply` (up to 3 rounds)

Supported resource types:
- **Azure resources** — resource groups, VNets, NSGs, etc. (detected via Azure Resource Manager IDs)
- **Databricks Private Endpoint rules** — matched by rule ID
- **Databricks network connectivity** — NCC and network policies matched by name/ID

This eliminates the need to manually run `terraform import` when re-deploying to the same environment.

## Resource Name Conflict Detection

For Azure deployments, the app checks whether resource group names already exist before starting `terraform apply`. If conflicts are found with resources **not** created by a previous Deployer run, a warning dialog appears with options to proceed or go back and rename.

## Build from Source

### Requirements
- Node.js 18+
- Rust 1.70+
- Platform build tools (Xcode on macOS, Visual Studio on Windows)

### Commands
```bash
npm install
npm run dev            # Frontend only (Vite dev server)
npm run tauri dev      # Full app with Rust backend
npm run build          # Build frontend
npm run tauri build    # Production build
npm run test           # Run tests (watch mode)
npm run test:run       # Run tests once
npm run test:coverage  # Run tests with coverage report
```

Output: `src-tauri/target/release/bundle/` (macOS: `.dmg`, Windows: `.msi`/`.exe`)

## Version Management & Releases

The project uses automated version syncing across all configuration files (`package.json`, `Cargo.toml`, `tauri.conf.json`).

### Creating a New Release

From the `desktop-app/` directory:

```bash
# Bump version (pick one)
npm version patch --no-git-tag-version   # 1.0.10 → 1.0.11
npm version minor --no-git-tag-version   # 1.0.10 → 1.1.0
npm version major --no-git-tag-version   # 1.0.10 → 2.0.0

# Commit and tag from the repo root
cd ..
git add .
git commit -m "v1.0.11"
git tag v1.0.11
git push --follow-tags
```

The `npm version` command automatically syncs the version to `Cargo.toml` and `tauri.conf.json` via the `version` lifecycle hook.

GitHub Actions will then build macOS (arm64 + x64) and Windows installers and create a GitHub release.

## Authentication

### Databricks
**Option 1: CLI Profile** (recommended)
```bash
databricks auth login --account-id <ACCOUNT_ID>
```

**Option 2: Service Principal**
- Account ID
- Client ID
- Client Secret

**Azure users:** Can use Azure identity if authenticated via Azure CLI and have Account Admin role (see Azure authentication).

### AWS
- CLI profiles (`~/.aws/credentials`) including SSO
- Or manual: Access Key ID, Secret Access Key
- Required IAM permissions: EC2, VPC, S3, IAM, STS (for cross-account roles)

### Azure
- CLI auth (`az login`)
- Or service principal: Tenant ID, Subscription ID, Client ID, Client Secret

**Option 3: Azure Identity (Azure CLI only)**
- Requires Azure CLI (`az login`) and Databricks Account Admin privileges
- Uses Azure AD token directly (no Databricks service principal needed)
- Terraform auth type: `azure-cli`

### GCP
**Option 1: ADC with Service Account Impersonation** (recommended)
```bash
gcloud auth application-default login
```
The app can create a service account with a custom IAM role and configure impersonation automatically.

**Option 2: Service Account Key**
- Paste a JSON key file for a service account with the required permissions
- Required GCP permissions: Compute, Service Networking, IAM, Service Account Admin, Storage

## Development

### Running Tests
```bash
# Frontend (Vitest + React Testing Library)
npm run test           # Watch mode
npm run test:run       # Single run
npm run test:coverage  # Run with coverage report

# Backend (Rust)
cd src-tauri && cargo test
```

Frontend tests use Vitest with React Testing Library. Tauri commands are automatically mocked in `src/test/setup.ts`. Backend tests use inline `#[cfg(test)]` modules covering validation, encryption, Terraform parsing, env var building, and template integration.

### Code Quality
```bash
npm run build          # TypeScript compilation check
```

### CI

Pull requests targeting `main` are automatically validated by the `ci.yml` GitHub Actions workflow, which runs TypeScript compilation, the frontend test suite, and backend checks (`cargo check`, `cargo test`).

### Adding Features
- Template changes require incrementing `TEMPLATES_VERSION` in `src-tauri/src/commands/mod.rs`
- Variable display names go in `src/constants/templates.ts`
- See `.cursor/rules/` for project conventions

## Templates

### Available Templates

| ID | Name | Cloud | Description |
|----|------|-------|-------------|
| `aws-simple` | AWS Standard BYOVPC | AWS | Standard workspace with customer-managed VPC ([README](src-tauri/templates/aws-simple/README.md)) |
| `aws-sra` | AWS Security Reference Architecture | AWS | Enterprise-grade security with PrivateLink, CMK encryption, and compliance controls |
| `azure-simple` | Azure Standard VNet | Azure | Standard workspace with VNet injection ([README](src-tauri/templates/azure-simple/README.md)) |
| `azure-sra` | Azure Security Reference Architecture | Azure | Enterprise-grade hub-spoke deployment with Private Endpoints and CMK encryption |
| `gcp-simple` | GCP Standard BYOVPC | GCP | Standard workspace with customer-managed VPC ([README](src-tauri/templates/gcp-simple/README.md)) |
| `gcp-sra` | GCP Security Reference Architecture | GCP | Enterprise-grade security with Private Service Connect, CMEK, and hardened firewall ([README](src-tauri/templates/gcp-sra/readme.md)) |

Each template creates Unity Catalog metastore/catalog, workspace, networking, and required cloud resources.

### Adding Templates

1. Create `src-tauri/templates/{cloud}-{name}/` with Terraform files (`variables.tf` required)
2. Register in `src-tauri/src/commands/templates.rs` -> `get_templates()`
3. Add variable display names to `VARIABLE_DISPLAY_NAMES` in `src/constants/templates.ts`
4. Add variable descriptions to `VARIABLE_DESCRIPTION_OVERRIDES` in `src/constants/templates.ts`
5. Add credential/internal variables to `EXCLUDE_VARIABLES` (in `src/constants/templates.ts`) or `INTERNAL_VARIABLES`
6. Add section mappings in `groupVariablesBySection()` in `src/utils/variables.ts`
7. If the template's Databricks provider references a workspace URL that doesn't exist during import, add a `workspace_url_override` variable (see `azure-simple` for an example) and handle it in `build_import_env()` in `terraform.rs`
8. Increment `TEMPLATES_VERSION` in `src-tauri/src/commands/mod.rs`
9. Rebuild

## Project Structure

```
src/
  App.tsx                # Main application entry
  main.tsx               # Vite entry point
  styles.css             # Global styles
  constants/
    cloud.ts             # Cloud providers, region lists, display names
    ui.ts                # Polling intervals, UI timing, default values
    templates.ts         # Variable display names, descriptions, exclusions
    assistant.ts         # AI assistant providers, screen context, sample questions
    index.ts             # Barrel re-export
  types/
    cloud.ts             # Cloud credential and auth types (AWS, Azure, GCP)
    databricks.ts        # Databricks profiles, Unity Catalog types
    wizard.ts            # Wizard flow types (templates, deployment, screens)
    assistant.ts         # AI assistant types (chat, settings, models)
    github.ts            # Git/GitHub integration types
    index.ts             # Barrel re-export
  context/
    WizardContext.tsx    # Wizard state management and shared context
    AssistantContext.tsx # AI assistant state with wizard integration
  hooks/
    useAwsAuth.ts        # AWS authentication (profiles, SSO, access keys)
    useAzureAuth.ts      # Azure authentication (CLI, service principals)
    useGcpAuth.ts        # GCP authentication (ADC, impersonation, SA keys)
    useDatabricksAuth.ts # Databricks account authentication (profiles, SP)
    useDeployment.ts     # Deployment orchestration (init, plan, apply, rollback)
    useUnityCatalog.ts   # Unity Catalog metastore detection and configuration
    useWizard.ts         # Wizard navigation and step management
    useAssistant.ts      # AI assistant chat, auth, model selection
    useGitHub.ts         # Git init, GitHub OAuth device flow, repo creation
    useSsoPolling.ts     # SSO login polling
    usePersistedCollapse.ts # Persistent collapse state for UI sections
  utils/
    variables.ts         # Variable grouping, formatting, suffix generation
    cloudValidation.ts   # Cloud permission validation
    databricksValidation.ts # Databricks credential validation
  components/
    WizardRouter.tsx     # Main wizard routing logic
    GitIntegrationCard.tsx  # Git init, GitHub auth, repo creation/push
    ui/
      ErrorBoundary.tsx  # React error boundary
      Alert.tsx          # Alert and StatusMessage components
      AuthModeSelector.tsx    # Radio-button auth mode selector
      AzureAdminDialog.tsx    # Azure admin consent flow dialog
      FormGroup.tsx           # FormGroup and collapsible FormSection
      LoadingSpinner.tsx      # Spinner and LoadingOverlay
      PermissionWarningDialog.tsx  # Cloud permission warnings
    screens/
      WelcomeScreen.tsx
      CloudSelectionScreen.tsx
      DependenciesScreen.tsx
      TemplateSelectionScreen.tsx
      ConfigurationScreen.tsx
      UnityCatalogConfigScreen.tsx
      DeploymentScreen.tsx
      credentials/
        AwsCredentialsScreen.tsx
        AzureCredentialsScreen.tsx
        GcpCredentialsScreen.tsx
        DatabricksCredentialsScreen.tsx
    assistant/
      AssistantPanel.tsx      # Floating chat panel
      AssistantSetup.tsx      # Provider selection and API key input
      AssistantMessage.tsx    # Message rendering with markdown
      AssistantSettingsModal.tsx  # GitHub model selection dialog
  test/
    setup.ts             # Vitest global setup (mocks @tauri-apps/api)
    hooks/               # Hook unit tests
    utils/               # Utility function tests

src-tauri/
  src/
    lib.rs               # Tauri app setup, plugin registration, template extraction
    main.rs              # Application entry point
    commands/
      mod.rs             # Shared types, helpers, constants, template version, CLI_LOGIN_PROCESS mutex
      aws.rs             # AWS-specific commands
      azure.rs           # Azure-specific commands
      gcp.rs             # GCP-specific commands and SA creation
      databricks.rs      # Databricks authentication
      deployment.rs      # Deployment orchestration and tfvars generation
      templates.rs       # Template listing and variable parsing
      github.rs          # Git init, GitHub OAuth, repo creation, push
      assistant.rs       # AI assistant API integration (GitHub/OpenAI/Claude)
    terraform.rs         # Terraform execution, auto-import, retry logic, output streaming
    dependencies.rs      # CLI detection, version checks, Terraform auto-install
    errors.rs            # Standardized error message helpers
  resources/
    assistant-knowledge.md   # Embedded knowledge base for AI assistant
  templates/
    aws-simple/          # AWS BYOVPC template (see template README)
    aws-sra/             # AWS Security Reference Architecture template
    azure-simple/        # Azure VNet injection template (see template README)
    azure-sra/           # Azure Security Reference Architecture template
    gcp-simple/          # GCP customer-managed VPC template (see template README)
    gcp-sra/             # GCP Security Reference Architecture template
```

## Troubleshooting

### Terraform not found after install
Restart the app. Terraform is installed to `~/.databricks-deployer/bin/`.

### Azure CLI not detected
Run `az login` in terminal first, then restart the app.

### AWS SSO session expired
Run `aws sso login --profile <profile>` to refresh.

### GCP ADC not working
Run `gcloud auth application-default login` in terminal, then restart the app. If using impersonation, ensure the service account exists and your user has the `Service Account Token Creator` role on it.

### GCP service account missing permissions
The app creates a custom role with the required permissions. If validation reports missing permissions, some (like `storage.buckets.setIamPolicy`) are bucket-level and cannot be validated at the project level -- they are still present in the role.

### Deployment stuck
Check the logs in the deployment folder. You can run `terraform apply` manually from there.

### Unity Catalog permissions error
Ensure your identity has metastore admin or the required grants (`CREATE CATALOG`, `CREATE EXTERNAL LOCATION`) on the existing metastore.

### GCP destroy fails on VPC deletion
Databricks creates firewall rules in the VPC that are not managed by Terraform. Delete them manually with `gcloud compute firewall-rules list --filter="network:<vpc-name>" --format="value(name)" | xargs -I {} gcloud compute firewall-rules delete {} --quiet`, then re-run destroy.

### AI Assistant not responding
Check the error message displayed. Common issues:
- **GitHub Models:** Token missing `models:read` permission. Create a new Fine-grained PAT with correct permissions.
- **Rate limit exceeded:** Wait for the limit to reset, or switch to a different provider.
- **Invalid API key:** Disconnect and reconnect with a fresh key.

### AI Assistant shows "Loading models..." indefinitely
Disconnect and reconnect. The models list is cached for 24 hours; disconnecting clears the cache.

### Azure identity validation fails
Run `az login` and verify you have Databricks Account Admin. Test with:
```bash
az account get-access-token --resource 2ff814a6-3304-4ab8-85cb-cd0e6f879c1d
```

### Databricks token cache issues
Delete `~/.databricks/token-cache.json` and re-run `databricks auth login`.
