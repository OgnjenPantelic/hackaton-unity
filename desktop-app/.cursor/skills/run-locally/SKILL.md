---
name: run-locally
description: Run the Databricks Deployer desktop app locally for development. Use when starting the dev server, building from source, or setting up the development environment.
---

# Running the App Locally

## Prerequisites

- **Node.js 18+**
- **Rust 1.70+**
- **Platform build tools**: Xcode Command Line Tools on macOS, Visual Studio Build Tools on Windows

## Setup

From `desktop-app/`:

```bash
npm install
```

## Development

### Full app (frontend + Rust backend)

```bash
npm run tauri dev
```

This is the primary development command. It starts the Vite dev server on port 1420 and launches the Tauri window with hot-reload on both frontend and backend changes.

### Frontend only

```bash
npm run dev
```

Starts only the Vite dev server (port 1420). No Rust backend — Tauri `invoke` calls will fail. Useful for pure UI work with mocked data.

### Production build

```bash
npm run tauri build
```

Output: `src-tauri/target/release/bundle/` — DMG on macOS, MSI/EXE on Windows.

## Testing

See the **run-tests** skill for full details on running and writing tests.

Quick commands:

```bash
npm run test:run                          # Frontend tests (single run)
cd src-tauri && cargo test                # Backend tests
npm run build                             # TypeScript compilation check
```

## Troubleshooting

- **Port 1420 in use**: Vite uses `strictPort: true`. Kill the existing process on port 1420 before starting.
- **Templates not loading in dev**: Dev builds load templates from `CARGO_MANIFEST_DIR/templates` (i.e. `src-tauri/templates/`), not the bundled resource directory.
- **Terraform not found after install**: The app installs Terraform to `~/.databricks-deployer/bin/`. Restart the app for it to be detected.
- **Rust compilation slow**: First build downloads and compiles all crates. Subsequent builds use the cache in `src-tauri/target/`. The `Swatinem/rust-cache` action handles this in CI.
- **macOS signing errors on build**: For local dev builds, signing is not required. Production builds in CI handle signing via the workflow.

## Reference

- Vite config: `vite.config.ts` (port 1420, React plugin, Vitest config)
- Tauri config: `src-tauri/tauri.conf.json` (window size, CSP, build commands, bundle resources)
- Dev URL: `http://localhost:1420` (configured in `tauri.conf.json` → `build.devUrl`)
- App data: `~/Library/Application Support/com.databricks.deployer/` (macOS)
