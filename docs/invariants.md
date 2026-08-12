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
- Command help metadata belongs in `src/cli/help.ts` and should stay aligned
  with parser support.
- Command-specific orchestration belongs in dedicated `src/cli/*` runners.
- Domain logic belongs in its domain package, such as `src/publish/*` or
  `src/css/*`, not in CLI glue.
- CLI values that support `env:NAME` should resolve through
  `src/cli/parse/values.ts` and `AukletEnvContext`, not ad hoc per-flag logic.
- Target-scoped CLI values must stay deferred until the target package context
  is known.

## Environment Boundary

- Environment loading belongs in `src/env.ts`.
- Auklet loads `.env` and `.env.local`; `.env.local` has higher priority than
  `.env` at the same root.
- Environment priority:
  1. `process.env`
  2. target package `.env.local`
  3. target package `.env`
  4. root `.env.local`
  5. root `.env`
- Environment files provide process environment for config, user scripts,
  npmrc expansion, and explicit `env:NAME` CLI references. They must not imply
  publish credentials unless a CLI option explicitly references them.

## CSS Semantics Boundary

- CSS entry semantics are derived from `src/css/core/style/entries.ts`.
- Production writers and Vite dev graph must not invent independent entry order.
- Any production-only or dev-only behavior must be documented in `docs/css.md`.
- Broad CSS semantic changes need tests that compare production build structure
  and Vite/dev graph structure.
- auklet is a style entry generator, not a general CSS bundler. Do not add
  transform behavior inside entry writers.
- Global style transforms are only Less compilation and `styles.prefix`. Both
  run in `StyleProcessor` and must stay aligned for production and Vite/dev.
- CSS Modules (`*.module.css` / `*.module.less`) are a separate protocol under
  `src/css/modules`. They must not enter the global style entry/auto-import
  graph, must not use `styles.prefix`, and must not be compiled through
  `StyleProcessor.readStyleFile`. JS build and Vite consume Modules only via
  `compileCssModule` / `isCssModuleFile`.
- `styles.shared` is object-only (`{ inner?, output? }`). `inner` is the only
  same-package exception to component-local style imports. It is **plain
  `.css` / `.less` only** (not `*.module.*`), stays on the global path (gets
  `styles.prefix`), must stay under the source root, and must not permit
  component-to-component or package-to-package style imports. Nested shared
  imports must stay limited to non-module, non-theme helpers. When the shared
  file is CSS, preserve the `@import` relationship in module output and dev
  virtual CSS rather than duplicating shared rules into every importer.
- `styles.shared.output` publishes current-package shared styles into
  `{output}/es|lib` (configurable `output`, default `dist`) and must not use
  `styles.prefix`. Kinds:
  - CSS Modules: compile to `*.scoped.css` + JS shim (same hash formula as the
    JS Modules plugin); `modules: true` required when any Modules match;
    exports → shim under `{output}/es|lib`; workspace Vite may resolve to
    source for Modules HMR. Component JS Modules emit the same `*.scoped.css`
    contract (never published `*.module.css`).
  - Plain `.css` / `.less`: copy as-is (Less **not** compiled); exports →
    mirrored `{output}/es|lib` asset; workspace Vite remaps Modules / plain /
    Less `(reference)` to source for HMR (pre-warmed caches); installed / prod
    keep published artifacts.
    It must not open global component CSS `@import "other-package/..."`.
    `styles.dependencies` remains the path for built dependency CSS entries.
    Shared patterns use `fast-glob`. `auk inspect css` must validate export
    subpaths → accepted dist targets and dist presence (non-zero exit on failure).
- `@tsdown/css` enables tsdown CSS processing; auklet `modules: true` owns the
  `*.module.*` protocol. Do not run a second CSS Modules pipeline on the same
  files.
- CSS auto import inference only reads the supported source model. `.tsx` named
  imports/re-exports are supported; `.ts`, `.d.ts`, and `export * from` remain
  outside the inference model unless the model is intentionally changed.

## Workspace Discovery Boundary

- Shared workspace discovery belongs in `src/workspace/*`.
- Build, dev, CSS, and publish modules should reuse shared workspace readers or
  target resolvers instead of parsing pnpm workspace data independently.
- Missing workspace files, invalid workspace data, and workspace command
  failures are distinct states and should not be collapsed silently.
- Monorepo package sources should filter the workspace root package.
- Build/dev workspace commands exclude the workspace root package. They skip
  private workspace packages by default and include them only with `--private`.
- Publish and owner workspace selection skip the workspace root package and
  private packages.

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
