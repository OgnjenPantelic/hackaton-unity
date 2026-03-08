# Workspace Creator

Desktop app and tools for deploying Databricks workspaces across AWS, Azure, and GCP with Unity Catalog, automated Terraform setup, automatic validation and handling of errors, resource name conflict detection, and an embedded AI assistant.

The AI assistant provides context-aware help for each step of the deployment wizard. It supports GitHub Models (free), OpenAI, and Claude as providers. See [desktop-app/README.md](desktop-app/README.md#ai-assistant) for setup instructions.

## Components

| Directory | Description |
|-----------|-------------|
| `desktop-app/` | Tauri desktop app for guided workspace deployment (React + Rust) — includes auto-import/retry, resource conflict detection, and real-time resource timeline |
| `download-site/` | Flask-based download page for distributing the app |

## System Requirements

- **Runtime:** macOS 10.15+ or Windows 10+
- **Build:** Node.js 18+, Rust 1.70+, platform tools (Xcode/Visual Studio)
- **Deployment:** Git, Terraform (auto-installed), cloud CLIs (optional)

## Quick Start

### Desktop App

**Download:** Get pre-built binaries from [GitHub Releases](https://github.com/OgnjenPantelic/workspace-creator/releases)

**Build from source:**
```bash
cd desktop-app
npm install
npm run tauri dev
```

See [desktop-app/README.md](desktop-app/README.md) for full documentation.

### Download Site
```bash
cd download-site
pip install -r requirements.txt
python app.py
```

Runs on port 8080 by default. Deployed to Databricks Apps via `app.yaml`.

## CI/CD

**PR Validation** (`.github/workflows/ci.yml`)
- Runs TypeScript compilation and Vitest tests on pull requests
- Fast feedback (~3-5 minutes)

**Release Builds** (`.github/workflows/build-desktop.yml`)
- Triggers only on tag pushes (`v*`) or manual dispatch
- Builds for macOS ARM64, macOS x64, and Windows x64
- Includes Rust cargo caching for faster builds
- Automatically creates GitHub Release with all artifacts

**Releases:** [github.com/OgnjenPantelic/workspace-creator/releases](https://github.com/OgnjenPantelic/workspace-creator/releases)

## Troubleshooting

For detailed troubleshooting, see [desktop-app/README.md#troubleshooting](desktop-app/README.md#troubleshooting).

**Common issues:**
- **Terraform not found:** Restart the app after first run
- **Azure CLI not detected:** Run `az login` before starting the app
- **AWS SSO expired:** Run `aws sso login --profile <profile>` to refresh
- **"Resource already exists" errors:** The app auto-imports and retries up to 3 times. If it still fails, check the deployment logs for details.
