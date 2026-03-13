---
name: pre-commit-review
description: Prepare uncommitted changes for a clean commit. Runs tests, updates assistant context, READMEs, cursor rules, and skills — scoped to only what the diff actually touched. Use when the user says "pre-commit", "prepare for commit", "review before commit", or "make this commit-ready".
---

# Pre-Commit Review

Targeted review of uncommitted changes before committing. Each phase is scoped by the diff — skip phases that don't apply.

**Core rule: Do not rewrite files.** Make surgical edits to the specific sections that are stale. If a file needs zero changes, say so and move on. The goal is accuracy, not completeness — only update what the diff invalidated.

## Phase 1: Inventory

Always runs first. From the repo root:

```bash
git diff --stat HEAD
git status --short
```

Categorize every changed file into buckets:

| Bucket | Pattern |
|--------|---------|
| `rust` | `src-tauri/src/**/*.rs` |
| `frontend` | `src/**/*.{ts,tsx}` (excluding `src/test/`) |
| `templates` | `src-tauri/templates/**/*.tf` |
| `styles` | `src/styles.css` |
| `config` | `Cargo.toml`, `tauri.conf.json`, `package.json` |
| `tests` | `src/test/**`, inline `#[cfg(test)]` changes |

Print the bucket summary. This drives skip/run decisions for all subsequent phases.

## Phase 2: Tests

**Skip if:** No `rust` and no `frontend` files changed.

Run only what's needed:

| Condition | Command |
|-----------|---------|
| `frontend` changed | `npm run build && npm run test:run` |
| `rust` changed | `cd src-tauri && cargo check && cargo test` |

Fix any **new** test failures introduced by the diff. Pre-existing failures: note them but do not block.

## Phase 3: Assistant Context

**Skip if:** No frontend screen files (`src/components/screens/**`) and no `templates` changed.

### 3a. `src-tauri/resources/assistant-knowledge.md`

This is the embedded knowledge base the AI assistant uses at runtime.

1. Read the file
2. For each changed screen `.tsx`, check if the matching section in `assistant-knowledge.md` still accurately describes the current UX
3. Check the Wizard Flow list if screen order or skip logic changed
4. Check the Troubleshooting section if new error scenarios were added
5. Update only the stale sections — do not rewrite unrelated parts

### 3b. `src/constants/assistant.ts`

Contains `SCREEN_CONTEXT`, `ASSISTANT_SAMPLE_QUESTIONS`, and `ASSISTANT_PROVIDERS`.

1. For each screen `.tsx` that changed, read its current code and verify the corresponding `SCREEN_CONTEXT` paragraph still matches
2. If a genuinely new user-facing feature was added to a screen, add a relevant sample question to `ASSISTANT_SAMPLE_QUESTIONS`
3. Only touch `ASSISTANT_PROVIDERS` if provider configuration actually changed

## Phase 4: READMEs

Each README has its own skip condition. Do not update READMEs that aren't affected by the diff.

### 4a. `README.md` (repo root)

**Skip if:** No new Tauri commands, no new user-facing features, no template variable changes.

Sections to verify against the diff:
- Features list — new capabilities
- Adding Templates steps — workflow changes
- Project Structure tree — new files or renamed modules
- Troubleshooting — new error scenarios

### 4b. Template READMEs (`src-tauri/templates/*/README.md`)

**Skip if:** No `templates` files changed.

For each template whose `variables.tf` changed, verify the Variables table in its README matches the current variables.

## Phase 5: Cursor Rule and Skills

### 5a. `.cursor/rules/`

**Skip if:** No new commands registered in `lib.rs`, no new hooks created, no new constants exported, no new conventions introduced.

Check these sections against the diff:

| Section | Trigger |
|---------|---------|
| Rust Command Modules table | New `#[tauri::command]` functions |
| Supporting Rust Modules table | New public helper functions |
| Frontend Hooks table | New hooks or changed return interfaces |
| Frontend Constants table | New exports in `constants/index.ts` |
| Conventions (Rust / Frontend) | New patterns that should be codified |
| Do Not list | New anti-patterns identified |
| File Location Reference | New "where to put X" entries |

### 5b. Skills

Only update a skill if the diff changed something it documents:

| Skill | Update if... |
|-------|-------------|
| `terraform-template-updates/SKILL.md` | Template workflow, import/retry logic, or frontend constant maps changed |
| `run-tests/SKILL.md` | New test files added or test infrastructure changed |
| `run-locally/SKILL.md` | Dev workflow, prerequisites, or build commands changed |
| `version-bump-release/SKILL.md` | Version sync or CI workflow changed |
| `pre-commit-review/SKILL.md` | New documentation files or review targets added to the project |

## Phase 6: Final Summary

1. Run `git diff --stat` to show what this review updated
2. List each file touched with a one-line description of what changed
3. Flag files that should **not** be committed: `*.bak`, `.env`, `node_modules/`, `.DS_Store`
4. Report which phases were skipped and why
