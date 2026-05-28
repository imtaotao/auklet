# Project Invariants

This document lists project rules that should not be broken casually. If a
change needs to break one of these rules, update the relevant docs and tests in
the same change and make the reason explicit.

## Public API Boundary

- Public API exports are defined by `src/index.ts`.
- Do not export internal classes or helpers only because CLI code or tests need
  them.
- Public names should describe user concepts. Mechanism-oriented names should
  stay inside submodules.

## Configuration Boundary

- `AukletConfig` is user-facing input.
- `NormalizedAukletConfig` is the internal stable shape.
- Defaults belong in `src/config.ts`.
- Core modules should consume normalized config unless they are explicitly
  loading or normalizing user input.
- Build configuration may come from `auklet.config.js` or CLI build overrides.
- CLI build overrides have higher priority than config files.
- Publish flags are one-shot operation controls and must not be added to
  `auklet.config.js`.
- Publish hooks are package lifecycle behavior and live in
  `package.json#auklet.publish`.

## CLI Boundary

- `bin/entry.mjs` stays a thin bootstrap into the built public API.
- Command registration belongs in `src/cli/main.ts`.
- Command-specific orchestration belongs in dedicated `src/cli/*` runners.
- Domain logic belongs in its domain package, such as `src/publish/*` or
  `src/css/*`, not in CLI glue.

## CSS Semantics Boundary

- CSS entry semantics are derived from `src/css/core/style/entries.ts`.
- Production writers and Vite dev graph must not invent independent entry order.
- Any production-only or dev-only behavior must be documented in `docs/css.md`.
- Broad CSS semantic changes need tests that compare production build structure
  and Vite/dev graph structure.
- auklet is a style entry generator, not a general CSS bundler. Do not add
  partial CSS transform behavior inside entry writers.
- CSS auto import inference only reads the supported source model. `.tsx` named
  imports/re-exports are supported; `.ts`, `.d.ts`, and `export * from` remain
  outside the inference model unless the model is intentionally changed.

## Workspace Discovery Boundary

- Shared workspace discovery belongs in `src/workspace/*`.
- CSS and publish modules should reuse shared workspace readers instead of
  parsing pnpm workspace data independently.
- Missing workspace files, invalid workspace data, and workspace command
  failures are distinct states and should not be collapsed silently.
- Monorepo package sources should filter the workspace root package.

## Publish Workflow Boundary

- Publish stage order is owned by `PublishRunner`.
- `beforeBuild` failure must not write versions.
- Later failures should still run `afterPublish` with failure metadata.
- Real `pnpm publish` must be serial across targets.
- Real `pnpm publish` should inherit stdio so npm authentication stays
  interactive.
- `--dry-run` must not write package versions, create git commit/tag, or publish
  to the registry.
- `--no-git` skips release commit/tag but keeps the clean-worktree check.
- `--allow-dirty` skips clean check, commit, and tag.
- Partial publish must never try to roll back registry publishes.

## Test Boundary

- Existing tests are behavior documentation. Do not relax them only to make an
  implementation pass.
- Add focused tests for new behavior before editing broad existing cases.
- File-system tests should use virtual project fixtures.
- CSS production/dev semantic changes should use `StyleStructure` comparisons
  when possible.
