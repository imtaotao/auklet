# Maintenance Playbook

This document is task-oriented. Use it when you know what kind of change you are
making and need the files, tests, and docs that usually move together.

## Change A CLI Flag

Check:

- `docs/invariants.md` for CLI, config, and publish flag boundaries.
- `src/cli/main.ts` for command registration when adding a new command.
- `src/cli/values.ts` when the flag supports `env:NAME` or deferred
  target-scoped resolution.
- `src/cli/buildArgs.ts` for build override flags.
- `src/publish/cli.ts` for publish/owner flags.
- `src/publish/types.ts` or build option types when the flag reaches runners.
- README CLI examples and option tables.
- `docs/architecture.md` for build/CLI architecture changes.
- `docs/publish.md` for publish flags.

Tests:

- Build override parsing belongs in `src/__tests__/cli.spec.ts`.
- Publish/owner parsing belongs in `src/__tests__/publish/cli.spec.ts`.
- Runner behavior belongs in the corresponding runner spec.

## Change Environment Loading Or CLI Value Resolution

Check:

- `docs/invariants.md` for environment priority and deferred value rules.
- `src/env.ts` for `.env` file loading, process env priority, and run-time env
  injection.
- `src/cli/values.ts` for string, boolean, and deferred CLI value handling.
- `src/cli/buildArgs.ts` when build overrides should support `env:NAME`.
- `src/publish/cli.ts` and `src/publish/publishEnv.ts` when publish or owner
  values should resolve from environment files.
- README and `docs/publish.md` when user-visible env behavior changes.

Tests:

- Environment file priority belongs in `src/__tests__/env.spec.ts`.
- Build CLI value parsing belongs in `src/__tests__/cli.spec.ts`.
- Publish/owner env-backed parsing belongs in
  `src/__tests__/publish/cli.spec.ts`.
- Target-scoped publish value resolution belongs in
  `src/__tests__/publish/token.spec.ts`.

## Change CSS Entry Order Or Semantics

Check:

- `docs/invariants.md` for CSS semantics invariants.
- `src/css/core/style/entries.ts` first.
- Production writers under `src/css/production/format/`.
- Vite graph generation under `src/css/vite/moduleGraph/`.
- `docs/css.md` if the supported model or boundaries change.

Tests:

- Use project-level e2e when production and Vite/dev semantics must stay
  aligned.
- Use module tests only for one module's boundary behavior.
- Prefer `StyleStructure` helpers for production/dev semantic comparisons.

## Change Publish Flow

Check:

- `docs/invariants.md` for publish workflow invariants.
- `src/publish/publishRunner.ts` for stage order.
- `src/publish/runner/*` for stage-specific behavior.
- `src/publish/api/*` for git, pnpm, package.json, and hook adapters.
- `src/publish/types.ts` when option shapes change.
- README publish commands.
- `docs/publish.md` state order, git rules, hooks, and failures.

Tests:

- `src/__tests__/publish/runner.spec.ts` for phase order and failure behavior.
- `src/__tests__/publish/cli.spec.ts` for flags.
- `src/__tests__/publish/pnpmApi.spec.ts` for pnpm process behavior.
- Add a preview-style test only when terminal output needs manual visual review.

## Change Inspect Behavior

Check:

- `src/cli/inspect.ts` for inspect subcommand routing.
- `src/publish/inspect.ts` for publish readiness orchestration.
- `src/publish/inspectPack.ts` for local package file checks.
- `src/publish/inspectRegistry.ts` for registry auth and version checks.
- README CLI docs and `docs/publish.md` when user-visible behavior changes.

Tests:

- Package file checks belong in `src/__tests__/publish/inspectPack.spec.ts`.
- Registry readiness checks belong in
  `src/__tests__/publish/inspectRegistry.spec.ts`.
- Inspect publish orchestration belongs in
  `src/__tests__/publish/inspect.spec.ts`.

## Add Or Change Config Fields

Check:

- `docs/invariants.md` for configuration invariants.
- `src/types.ts` public and normalized config types.
- `src/config.ts` defaults and normalization.
- `src/configLoader.ts` only when config file loading behavior changes.
- README configuration reference.
- Examples if the field changes common usage.

Tests:

- Config normalization belongs near `config` or config loader specs.
- Build config mapping belongs in `src/__tests__/build/tsdownConfig/`.
- CSS config semantics need CSS builder or graph tests.

## Change Workspace Discovery

Check:

- `docs/invariants.md` for workspace discovery invariants.
- `src/workspace/*` shared workspace readers.
- `src/publish/targetResolver.ts` for publish package selection.
- `src/css/vite/moduleGraph/packageSource/` for dev package source behavior.
- `docs/architecture.md`, `docs/css.md`, or `docs/publish.md` depending on the
  affected consumer.

Tests:

- Workspace reader parsing gets direct unit coverage.
- Publish target selection belongs in `src/__tests__/publish/targetResolver.spec.ts`.
- Vite package source behavior belongs in
  `src/__tests__/css/moduleGraph/packageSource/`.

## Change Public API

Check:

- `docs/invariants.md` for public API invariants.
- `src/index.ts` exports.
- README Programmatic API docs.
- `src/__tests__/index.spec.ts`.
