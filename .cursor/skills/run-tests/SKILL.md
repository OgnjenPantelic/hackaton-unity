---
name: run-tests
description: Run frontend and backend tests for the Databricks Deployer desktop app. Use when running tests, writing new tests, debugging test failures, or checking test coverage.
---

# Running Tests

All commands run from the repo root.

## Quick Reference

```bash
npm run test:run                          # Frontend — single run
cd src-tauri && cargo test                # Backend — all tests
npm run test:run && (cd src-tauri && cargo test)  # Both
```

## Frontend Tests (Vitest + React Testing Library)

### Commands

```bash
npm run test            # Watch mode (re-runs on file changes)
npm run test:run        # Single run (CI mode)
npm run test:coverage   # Single run with v8 coverage report
```

### Run a single test file

```bash
npx vitest run src/test/hooks/useAwsAuth.test.ts
```

### Run tests matching a pattern

```bash
npx vitest run -t "loads profiles"
```

### Configuration

- **Config**: `vite.config.ts` → `test` block
- **Environment**: jsdom (browser-like DOM)
- **Globals**: `true` — `describe`, `it`, `expect`, `vi` are available without imports
- **Setup file**: `src/test/setup.ts` — globally mocks `@tauri-apps/api/core` so `invoke()` returns `vi.fn()`
- **Coverage**: v8 provider, reports to `text`, `text-summary`, `lcov`; covers `src/**/*.{ts,tsx}`, excludes `src/test/**`, `src/main.tsx`, `src/vite-env.d.ts`

### Test file locations

```
src/test/
  setup.ts                          # Global mock setup
  hooks/
    useAwsAuth.test.ts
    useAzureAuth.test.ts
    useGcpAuth.test.ts
    useDatabricksAuth.test.ts
    useDeployment.test.ts
    useWizard.test.ts
    useUnityCatalog.test.ts
    useGitHub.test.ts
    useSsoPolling.test.ts
    useAssistant.test.ts
  utils/
    variables.test.ts
    cidr.test.ts
    cloudValidation.test.ts
    databricksValidation.test.ts
```

### Writing a new frontend test

1. Create `src/test/{category}/{name}.test.ts` mirroring the source path
2. Import the hook or utility under test
3. Use `vi.mocked(invoke)` to control Tauri IPC responses
4. For hooks, use `renderHook` + `act` from `@testing-library/react`

```typescript
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useMyHook } from "../../hooks/useMyHook";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("useMyHook", () => {
  it("does something on success", async () => {
    mockInvoke.mockResolvedValueOnce({ /* mock data */ });
    const { result } = renderHook(() => useMyHook());

    await act(async () => {
      await result.current.someMethod();
    });

    expect(mockInvoke).toHaveBeenCalledWith("command_name", { arg: "value" });
    expect(result.current.someState).toBe("expected");
  });
});
```

## Backend Tests (cargo test)

### Commands

```bash
cd src-tauri
cargo test                            # All tests
cargo test -- --nocapture             # Show println! output
cargo test terraform::tests           # Tests in a specific module
cargo test parse_importable           # Tests matching a name pattern
cargo check                           # Compile check only (faster, no test execution)
```

### Test module locations

Rust tests use inline `#[cfg(test)] mod tests` blocks inside each source file:

| File | What's tested |
|------|--------------|
| `terraform.rs` | Variable parsing, tfvars generation, importable error parsing, env var building |
| `crypto.rs` | AES-256-GCM encryption/decryption round-trips |
| `dependencies.rs` | CLI detection and version parsing |
| `errors.rs` | Error message formatting |
| `commands/mod.rs` | Sanitization, validation, shared helpers |
| `commands/aws.rs` | AWS-specific validation |
| `commands/azure.rs` | Azure-specific validation |
| `commands/databricks.rs` | Databricks credential validation |
| `commands/deployment.rs` | Deployment config, tfvars writing |
| `commands/templates.rs` | Template listing, variable exclusion |
| `commands/github.rs` | Git operations, tfvars preview |
| `commands/assistant.rs` | Assistant provider/model handling |

### Writing a new backend test

Add tests inside the source file using an inline test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn my_new_test() {
        let result = some_function("input");
        assert_eq!(result, "expected");
    }
}
```

## CI Parity

CI (`.github/workflows/ci.yml`) runs on PRs targeting `main`/`master`:

| Job | What it runs |
|-----|-------------|
| `test-frontend` | `npm run build` (TS check) → `npm run test:run` |
| `test-backend` | `cargo check` → `cargo test` |

To replicate CI locally before pushing:

```bash
npm run build && npm run test:run && (cd src-tauri && cargo check && cargo test)
```

## Troubleshooting

- **`invoke` is not a function**: The global mock in `src/test/setup.ts` should handle this. Ensure your test file doesn't import a different `invoke` path.
- **Test hangs on `act()`**: Make sure the mocked `invoke` resolves or rejects — an unresolved promise will hang the test.
- **Rust test fails with linker errors on Linux**: Install system dependencies: `sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev`
- **Rust tests pass locally but fail in CI**: CI uses a clean environment. Check for tests that depend on filesystem state, environment variables, or installed CLIs.
- **Coverage report not generating**: Run `npm run test:coverage` (not `npm run test`). Output goes to stdout (`text`) and `coverage/lcov.info`.
