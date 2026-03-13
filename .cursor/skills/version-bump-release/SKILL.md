---
name: version-bump-release
description: Bump the Databricks Deployer app version and push a release. Use when creating a new release, bumping the version number, pushing a version tag, or preparing a release build.
---

# Version Bump and Release

Version is synced across three files via `scripts/sync-version.cjs`:
- `package.json` (source of truth)
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

## Workflow

### Step 1: Decide bump type

- `patch` — bug fixes (1.0.12 → 1.0.13)
- `minor` — new features (1.0.12 → 1.1.0)
- `major` — breaking changes (1.0.12 → 2.0.0)

### Step 2: Bump the version

```bash
npm version patch --no-git-tag-version
```

(Replace `patch` with `minor` or `major` as needed.)

This updates `package.json` and automatically runs `sync-version.cjs`, which copies the new version into `Cargo.toml` and `tauri.conf.json`.

The `--no-git-tag-version` flag prevents npm from committing — we commit separately.

### Step 3: Commit and tag

```bash
git add .
git commit -m "v{NEW_VERSION}"
git tag v{NEW_VERSION}
```

Replace `{NEW_VERSION}` with the actual version (e.g. `v1.0.13`).

### Step 4: Push

```bash
git push --follow-tags
```

### Step 5: CI builds the release

The `build-desktop.yml` workflow triggers on `v*` tags and:
1. Builds for macOS arm64, macOS x64, and Windows x64
2. Creates a GitHub Release with auto-generated release notes
3. Attaches DMG (macOS), MSI and EXE (Windows) installers

## Checklist

- [ ] Version bump type chosen (patch/minor/major)
- [ ] `npm version {type} --no-git-tag-version` run from repo root
- [ ] All three files have matching versions: `package.json`, `Cargo.toml`, `tauri.conf.json`
- [ ] If templates changed: `TEMPLATES_VERSION` in `src-tauri/src/commands/mod.rs` was bumped separately
- [ ] Committed with `v{VERSION}` message
- [ ] Tag created: `git tag v{VERSION}`
- [ ] Pushed with `git push --follow-tags`
- [ ] CI build passes on the tag

## Reference

- Sync script: `scripts/sync-version.cjs`
- CI workflow: `.github/workflows/build-desktop.yml`
- CI triggers: push of tags matching `v*`, or manual `workflow_dispatch`
- Build output: `src-tauri/target/release/bundle/` (DMG on macOS, MSI/EXE on Windows)
