# Maintenance Playbook

This document is task-oriented. Use it when you know what kind of change you are
making and need the files, tests, and docs that usually move together.

## Change A CLI Flag

Check:

- `docs/invariants.md` for CLI, config, and publish flag boundaries.
- `src/cli/main.ts` for command registration when adding a new command.
- `src/cli/help.ts` for command help text when adding or changing flags.
- `src/cli/parse/values.ts` when the flag supports `env:NAME` or deferred
  target-scoped resolution.
- `src/cli/parse/workspace.ts` for `--filter`, `--workspace`, `--deps`, and
  `--private`.
- `src/cli/parse/build.ts` for build override flags.
- `src/cli/parse/publish.ts` and `src/cli/parse/owner.ts` for publish/owner
  flags.
- `src/publish/types.ts` or build option types when the flag reaches runners.
- README command and option tables.
- `docs/architecture.md` for build/CLI architecture changes.
- `docs/publish.md` for publish flags.

Tests:

- Help metadata coverage belongs in `src/__tests__/cli.spec.ts`.
- Build override parsing belongs in `src/__tests__/cli.spec.ts`.
- Publish/owner parsing belongs in `src/__tests__/publish/cli.spec.ts`.
- Runner behavior belongs in the corresponding runner spec.

## Change Environment Loading Or CLI Value Resolution

Check:

- `docs/invariants.md` for environment priority and deferred value rules.
- `src/env.ts` for `.env` file loading, process env priority, and run-time env
  injection.
- `src/cli/parse/values.ts` for string, boolean, and deferred CLI value
  handling.
- `src/cli/parse/build.ts` when build overrides should support `env:NAME`.
- `src/cli/parse/publish.ts`, `src/cli/parse/owner.ts`, and
  `src/publish/publishEnv.ts` when publish or owner
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
- Less compile / `styles.prefix` / Vite `/@fs` rules stay in `StyleProcessor`
  and `styleCodeFactory` (not entry writers).
- CSS Modules changes belong in `src/css/modules` plus JS/Vite protocol
  consumers; do not compile Modules through `StyleProcessor` or entry writers.

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
- README configuration example and focused docs when the field needs more
  explanation.
- Examples if the field changes common usage.

Tests:

- Config normalization belongs near `config` or config loader specs.
- Build config mapping belongs in `src/__tests__/build/tsdownConfig/`.

## Change styles.shared Or Cross-Package Style Sources

Check:

- `docs/invariants.md` shared/output boundary (inner stays same-package;
  output compiles Modules to `dist/es|lib`; no global package `@import`).
- `src/types.ts` / `src/config.ts` for object-only `{ inner, output }` normalize.
- `src/css/core/style/shared.ts` (`fast-glob` + `resolveSharedOutputExcludeRoots`).
  Do not intersect `output` globs with `styleFiles` for Modules — they are
  already stripped; exclusion/allowlist for sibling helpers uses exclude roots.
- `src/css/core/style/sharedOutput.ts` entry/export/dist helpers.
- `src/css/production/sharedOutputWriter.ts` for Modules compile + JS shim +
  `*.scoped.css` (never emit published `*.module.css`).
- Cross-package sibling assets share `src/css/modules/cssModuleOutputPaths.ts`
  with `cssModulesPlugin` and `packageStyleImportPlugin`
  (`shared-package/<pkg>/...` + import rewrite).
- Plain package style resolve→CSS text lives in
  `src/css/core/packageStyleSource.ts` (build plugin + Vite); do not duplicate
  resolve gates or Less→CSS loading in glue layers.
- `createCssModulesPlugin` receives `sharedOutputPatterns` so JS imports of
  `shared.output` files emit `*.scoped.css` (aligned with `sharedOutputWriter`).
- Document `@tsdown/css` vs auklet Modules coexistence (`docs/css.md`).
- Scoped class hash: `generateScopedName` /
  `createGenerateScopedName` (`packageName + source-relative + local`).
  Keep the relative pathKey as a relative string — do not run
  `normalizeFileKey` on it (that resolves against cwd and breaks hash parity).
- Workspace shared.output HMR:
  `resolveWorkspaceSharedOutputModule` (Vite only; resolves exports→shim to
  producer source). Installed / prod stay on the published shim.
  Process-local cache of producer config+glob; invalidate on
  `auklet.config.*` change (`invalidateWorkspaceSharedOutputResolveCache`).
  Vite `resolveId` gates with `isExternalPackageSpecifier` +
  `isCssModuleSpecifier` before calling resolve.
- `shared.output` supports Modules + plain css/less (Less copied as-is; no
  prefix). `shared.inner` is plain css/less only (gets prefix). Document in
  `docs/css.md` / invariants / README.
- Plain `shared.output` workspace resolve:
  `resolveWorkspaceSharedOutputPlainStyle` + Less
  `remapWorkspaceSharedOutputLessFile`. Do **not** hardcode `dist/` — use
  producer `normalizedConfig.output` + CSS `outputFormats` (`es`/`lib`);
  resolve mirrors export subpath under `sourceRoot`.
- Vite `configureServer` / config reload:
  `ModuleStyleGraph.warmSharedOutputRemapCaches` →
  `warmWorkspaceSharedOutputCaches` (graph packages + workspace-editable
  deps) so Less `(reference)` sync remap does not rely on a prior JS
  `shared.output` import. Cold cache → published path (no `src/` guess).
  Config change currently re-warms the full graph (correct; can later narrow
  to the invalidated `packageRoot` + its workspace deps).
- Plain package CSS JS import uses `\0auklet-package-style:` virtuals; hotUpdate
  must include `collectDirectPackageStyleHotUpdateModules` (tracker only covers
  `auklet-css:*`). Vite Less does not use user `resolveId` — remap + HMR live
  in `viteLessPlugin` (Less FileManager via `css.preprocessorOptions.less.plugins`).
  Resolve must stay on `tryResolveExternalLessFile` →
  `resolveExternalLessImport` (same as production external Less / shared.output
  remap; do not invent a Vite-only resolve). HMR tracks only concrete entry
  `.less` (`options.filename`); do **not** track Vite `${dir}/*` / `dir:`
  pseudo ids. Collect: owner track first, source-scan only when track empty
  (package `@import` via same resolve — no basename match).
  `handleCombinedHotUpdate` exits only when the merged list is empty (include
  `safeNativeModules`; never return the changed Less partial alone).
  Cold-start integration: `src/__tests__/css/vite/sharedOutputPlainHmr.spec.ts`.
- One resolve cache only (`sharedOutputResolveCache` in `sharedOutput.ts`);
  Modules / plain / Less remap share it. It caches a **glob snapshot**, not live
  FS: invalidate/re-warm on `auklet.config.*` only. File add/remove under an
  unchanged glob may leave the membership list stale until config reload /
  restart (accepted; document in `docs/css.md`). `SharedOutputEntry` uses
  `assetRelative`/`assetFiles` (no mirrored `cssRelative`/`cssFiles`).
  Dep helpers + `STYLE_PACKAGE_EXPORT_CONDITIONS` live in
  `resolvers/packageDependency.ts`.
- `resolveSharedOutputExcludeRoots` rejects globs whose exclude root is the
  source root (too wide).
- `src/css/inspect.ts` shared output listing and export/dist checks
  (`findPathInExports` must use `exportSubpath` with a `./` prefix; accepted
  targets are `{output}/{format}/...` only, not bare `jsRelative`).
- Prefer exporting the published JS shim (not source `.module.*`); shims load as
  JS and import `*.scoped.css`. Hash is stable either way, but source exports
  skip the publish contract.
- Docs must stay aligned: compile (not mirror), secondary Modules + `*.scoped.css`,
  inspect export validation, workspace source HMR vs installed shim rebuild,
  `{output}/es|lib` (not a literal `dist/` only).
- Examples that publish or consume shared Modules.

Tests:

- Config object-only and invalid values.
- Producer compile into `{output}/es|lib` with hash parity and `*.scoped.css`.
- JS import + `shared.output` dual path: scoped CSS only (`cssModulesTsdown`).
- Hash formula + cwd stability (`generateScopedName.spec.ts`).
- Workspace exports→source + Modules HMR; plain resolve / Less remap with
  `output: 'build'`; Less `(reference)` after Vite warm without prior JS
  import; installed stays on dist (`resolveWorkspaceSharedOutputModule.spec.ts`).
- Resolve cache: same package loads config once; invalidate reloads
  (`resolveWorkspaceSharedOutputModule.spec.ts`).
- Example monorepo: shim content / hash assertions for published chip.
- `checkSharedOutputExports` positive/negative (`sharedOutputExports.spec.ts`).
- exports → JS shim → `resolveCssModuleImport` null / plugin `external: true`.
- Consumer import `pkg/...`: locals match scoped CSS (`publishedSharedOutputVite`).
- Inspect shared output: `runInspectCssCli` exit `1` / `0`.
- `packageStyleImportPlugin` resolve/load/renderChunk (`packageStyleImportPlugin.spec.ts`).
- `styles.shared.output` trees excluded from global `styleFiles` / `style/module.css`.
- Consumer package Modules / plain CSS / Less when still relevant.

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
- `docs/architecture.md` when the public API boundary or exported concepts
  change.
- `src/__tests__/index.spec.ts`.
