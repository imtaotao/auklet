# Testing Guide

This document explains how to add tests for future changes. The current test
suite is organized around "project-level e2e + module/API unit tests + shared
fixtures". New tests should follow the same layering, naming, and assertion
style.

## Test Goals

- Project-level e2e tests cover output structure and style dependency chains in
  realistic project shapes.
- Module/API tests cover stable behavior and edge cases for one module.
- Test data is built through virtual project fixtures instead of writing to
  system temp directories directly.
- Real build output and Vite/dev maps are normalized into `StyleStructure` before
  assertions when possible.
- Test helpers use `style` semantics to leave room for future style languages
  such as Less.

## Representative Test Entry Points

The list below is a map of the important test areas, not a complete file
inventory. Do not update this document every time a focused spec file is added.
Update it only when the test architecture or responsibilities change.

```text
src/__tests__/
  e2e/
    moduleStyleProject.spec.ts
    monorepoLibSmoke.spec.ts
    monorepoPackageSmoke.spec.ts
    singleLibSmoke.spec.ts
    singlePackageSmoke.spec.ts
  fixtures/
    virtualProject.ts
    styleProjectTemplate.ts
    styleStructure.ts
  css/
    styleProcessor.spec.ts
    workspaceStyleResolver.spec.ts
    styleImports/
      autoImportRules.spec.ts
      collectorDependencies.spec.ts
      collectorSource.spec.ts
      collectorSyntax.spec.ts
    resolvers/
      packageImports.spec.ts
      relative.spec.ts
      tsconfigPaths.spec.ts
    builder/
      dependencyStyles.spec.ts
      moduleOutput.spec.ts
      packageOutput.spec.ts
    moduleGraph/
      cache.spec.ts
      entries.spec.ts
      source.spec.ts
      packageSource/
        monorepo.spec.ts
        singlePackage.spec.ts
    watcher.spec.ts
    hmr.spec.ts
    path.spec.ts
    styleSpecifier.spec.ts
  build/
    cleanOutput.spec.ts
    runTsdown.spec.ts
    tsdownConfig/
      configFile.spec.ts
      configureTsdown.spec.ts
      iife.spec.ts
      options.spec.ts
  publish/
    cli.spec.ts
    pnpmApi.spec.ts
    runner.spec.ts
    targetResolver.spec.ts
    version.spec.ts
  workspace/
    packages.spec.ts
  cli.spec.ts
  cliBuild.spec.ts
  cliDev.spec.ts
  configLoader.spec.ts
  index.spec.ts
```

- `e2e/`: project-level tests using realistic virtual project structures. They
  call core APIs directly and do not execute the CLI.
- `fixtures/`: shared test infrastructure, including virtual projects, project
  templates, and structure normalization helpers.
- `css/`: CSS/style module unit tests.
- `build/`: tsdown/build config unit tests.
- `publish/`: publish option parsing, target resolution, version planning, and
  publish runner state tests.
- `workspace/`: shared pnpm workspace parsing and validation behavior.
- Root-level specs: lightweight smoke/boundary tests for cross-module APIs and
  CLI config override parsing, public API exports, and config loading.

## Choosing a Test Layer

When adding a feature, first decide whether the behavior is a complete user
scenario or a rule inside one module.

Write project-level e2e tests when:

- final output file structure changes;
- a style dependency chain across multiple modules changes;
- semantics must match between real build output and Vite/dev maps;
- module style, aggregate style, theme style, or external style output could be
  missed.

Write module/API unit tests when:

- only one class, function, or module has stable behavior to verify;
- edge cases need coverage, such as path normalization, empty styles, missing
  files, circular imports, or legacy path rewrites;
- failures should point directly to one module rather than a full project flow.

Do not put full project scenarios into module unit tests. If a large scenario is
already covered by e2e, module tests should keep only that module's own branches
and boundaries.

## Project-Level E2E

The main e2e file is `src/__tests__/e2e/moduleStyleProject.spec.ts`. It uses
`createStyleProject()` to build a realistic virtual project, then calls core
APIs:

```ts
const aukletConfig = await loadAukletConfig(fixture.packageRoot, {
  cacheBust: true,
});

await new ModuleStyleBuilder({
  packageRoot: fixture.packageRoot,
  aukletConfig,
}).build();
```

E2E assertions focus on:

- whether `fixture.outputFiles()` contains the complete output structure;
- whether package-level `index.css` contains key style content;
- whether `style/index.css`, `style/external.css`, theme entries, and module
  style entries have correct `@import` order and paths;
- whether `ModuleStyleGraph` creates Vite/dev virtual entries with matching
  semantics;
- whether `buildStructure` and `graphStructure` have matching components/themes
  semantic keys.

Prefer extending the main e2e scenario when adding new e2e coverage. Create a
new test only when adding the case to the main scenario would make it hard to
read. Do not create e2e tests for every small branch.

Four target project-shape smoke tests live in separate e2e files: monorepo
package, monorepo lib, single package, and single lib. These tests validate
basic build/dev graph usability for each supported package mode without carrying
the full dependency-chain assertions from `moduleStyleProject.spec.ts`.

Example output tests are split by project shape under `examples/__tests__`:
monorepo package, monorepo lib, single package, and single lib. Each file keeps
the JavaScript, CSS, and output-structure assertions for that one shape together
so a failure points at the affected mode instead of a horizontal output layer.

## Module/API Test Responsibilities

- `StyleProcessor`: style import expansion, content merging, duplication
  handling, circular imports, and supported style extensions.
- `WorkspaceStyleResolver`: relative paths, package paths, package exports,
  node_modules fallback, output format rewrites, and external style specifiers.
- `ModuleStyleImportCollector` / `styleImports`: infer style imports from `.tsx`
  source imports and named re-exports, including package entry imports, deep
  imports, namespace imports, same-package imports, local re-export bindings,
  type-only skips, `.ts` file skips, and unsupported `export * from '...'`
  errors. Collector tests keep integration semantics; resolver boundaries live
  in `css/resolvers/*.spec.ts`; auto import rule matching and specifier
  generation live in `css/styleImports/*.spec.ts`.
- `css/core/resolvers`: test relative paths, `package.json#imports`, and
  `tsconfig.compilerOptions.paths` separately. Focus on returning only
  candidates inside the current `sourceRoot`, `package.json#imports` `source`
  condition, external/unknown specifiers, `tsconfig extends`, exact aliases, and
  more specific pattern priority.
- `ModuleStyleGraph`: Vite/dev virtual entries, graph structure, recursive
  package style dependencies, third-party CSS dependency `/@fs` dev resolution,
  theme order, source graph checks, watch roots, and module dependency order.
- `moduleGraph/packageSource`: package discovery, package name lists, watch
  roots, and source graph file boundaries for Vite/dev package sources.
  Monorepo and single-package sources should have focused tests. Do not put
  virtual CSS generation scenarios into package source tests.
- `ModuleStyleBuilder`: builder-specific branches and output boundaries, such
  as legacy output-format rewrites, no CSS modules, empty style entries, and
  default cwd.
- `ModuleStyleWatcher`: watch roots, debounce, logger, and builder invocation
  parameters.
- `cli.spec.ts`: build override parsing and guardrails shared by `build`,
  `build-js`, `build-css`, and `dev`.
- `publish/`: publish/owner CLI flag parsing, target selection, dry-run/version
  planning, and runner phase ordering.
- `configLoader`: config module shapes, TypeScript config loading, missing
  config, and temporary file cleanup.
- `cleanOutput`: `auk build` output cleanup boundaries, including default
  `dist` and custom `output`.
- `tsdownConfig`: build option mapping, package metadata, banner, externals, and
  config loading.
- `index.spec.ts`: root public API smoke tests. Do not expand it into behavior
  tests.

## Fixtures

### `createVirtualProject`

Base virtual project helper. Prefer it for all tests that need a temporary file
system project.

```ts
let project: VirtualProject;

beforeEach(() => {
  project = createVirtualProject('auklet-feature-');
});

afterEach(() => {
  project.cleanup();
});
```

Capabilities:

- `project.root`
- `project.resolve(...)`
- `project.writeFile(...)`
- `project.writeFiles(...)`
- `project.writeJson(...)`
- `project.writePackageJson(...)`
- `project.writeAukletConfig(...)`
- `project.readFile(...)`
- `project.listFiles(...)`
- `project.exists(...)`
- `project.cleanup()`

Temporary files are created under `src/__tests__/.tmp/`, which is ignored by
git. Tests should call `cleanup()` for each concrete project directory after
normal completion.

Do not wrap pure forwarding helpers such as `writeFile/readFile/exists` inside a
single spec. Use `project.writeFile(...)` and `project.readFile(...)` directly.
Keep helpers only when they express test-domain semantics, such as
`writeSourceFile(...)` or `expectCollectedStyles(...)`.

### `createStyleProject`

High-level style project template for project-level e2e tests. It includes the
current package, internal modules, themes, external UI dependency, and external
theme dependency.

Default test data:

- virtual package: `@fixture/app`
- internal modules: `Card -> Button`
- external UI dependency: `@scope/ui`
- external theme dependency: `@scope/theme`
- themes: `light`, `dark`
- source directory: `source`
- output directory: `output`

Use the template escape hatches for special files or edge cases:

```ts
fixture.writeStyle('source/components/Card/extra.css', '.extra {}');
const files = fixture.outputFiles();
```

When adding template APIs, prefer `style` semantics and avoid exposing APIs that
hard-code `css` semantics.

## StyleStructure

`src/__tests__/fixtures/styleStructure.ts` normalizes real build output and
Vite/dev graph output into the same semantic structure:

```ts
type StyleStructure = {
  packageEntry: StyleEntry | null;
  entries: Record<string, StyleEntry>;
  themes: Record<string, StyleEntry>;
  components: Record<string, ComponentStyleStructure>;
};
```

Usage rules:

- Use `normalizeBuildStyleStructure(packageRoot, outputDir)` for real build
  output.
- Use `normalizeGraphStyleStructure(graph, packageName, packageRoot, stylePaths)`
  for Vite/dev graph output.
- Prefer assertions on `entries[id].imports`, `entries[id].content`,
  `components`, and `themes`.
- In `StyleStructure`, Vite virtual ids keep only semantic ids. Do not put
  internal prefixes such as `\0auklet-css:` into project-level assertions.
- Third-party CSS dependencies in dev graph should be asserted as Vite
  `/@fs/...` imports. Workspace style dependencies should keep virtual recursive
  semantics.
- Use posix `/` semantics for path assertions. Do not put absolute temporary
  paths into snapshots.

## Assertion Style

Keep tests tidy, direct, and low-noise.

- Treat existing tests as behavior documentation. Do not rewrite or relax an
  existing test just to make a new implementation pass.
- When an existing test fails, first decide whether the test describes the
  intended public behavior. If it does, fix the source code. Change the test
  only when the expected behavior has intentionally changed, the assertion was
  wrong, or the test is coupled to an implementation detail that no longer
  matters.
- Prefer adding focused tests for new behavior instead of editing broad existing
  cases. Editing existing tests is fine, but the diff should make the behavioral
  change explicit.
- Read the same file content once, assign it to a variable, then make multiple
  assertions.
- Use loops or table-driven tests for isomorphic output, such as
  `for (const format of ['es', 'lib'])`.
- Write single-line source strings as normal strings, not template strings.
- Use template strings only when multiline imports, config objects, or style
  structures need to be expressed.
- Put shared helpers at the top of the file, not at the bottom of `describe`.
- Do not write pure forwarding helpers. Helpers with domain semantics are fine.
- When a tested method name or call chain is so long that assertions become
  awkwardly wrapped, add a short helper local to that spec. For example, wrap
  `resolver.resolveStyleDependency(...)` as `resolve(...)`. Keep this helper
  local and small; do not move it to shared test utilities.
- Assertion helper names should express test intent, such as
  `expectEntryImports`, `expectCollectedStyles`, or `expectWatchFile`.
- Put large expected data near the top of the file as constants so test bodies
  keep clear arrange/act/assert structure.
- Do not use broad snapshots for generated content. Assert structure through
  file lists and imports; assert content only for key CSS.

Recommended style:

```ts
const styleEntry = fixture.readFile('output/es/style/index.css');

expect(styleEntry).toBe(
  '@import "./themes/light.css";\n' + '@import "./module.css";\n',
);
```

Isomorphic formats:

```ts
for (const format of ['es', 'lib']) {
  const rendererStyle = fixture.readFile(
    `output/${format}/components/Renderer/style/index.css`,
  );

  expect(rendererStyle).toBe(expectedRendererStyle);
}
```

Single-line source:

```ts
writeSourceFile(
  project,
  'routes/App.tsx',
  "import { Button } from '@scope/ui';",
);
```

## Import Parsing

Use PostCSS to parse generated CSS `@import` rules in tests. Do not scan the
whole CSS string with a regex.

Current helper:

```ts
const collectStyleImports = (code: string) => {
  const imports: Array<string> = [];
  const root = postcss.parse(code);

  root.walkAtRules('import', (rule) => {
    const match = rule.params.match(/^["']([^"']+)["']/);
    if (match) imports.push(match[1]);
  });

  return imports;
};
```

Reasons:

- The project already depends on PostCSS.
- PostCSS is more appropriate than regex for generated CSS.
- If Less support lands later, test-side structure is easier to extend.

## New Feature Test Checklist

After implementing or changing behavior, add tests in this order:

1. Decide whether final output structure or cross-module dependency chains are
   affected. If yes, add e2e first.
2. Decide whether a module boundary behavior is affected. If yes, add unit tests
   in the corresponding module spec.
3. If temporary files are needed, use `createVirtualProject` or
   `createStyleProject`.
4. If asserting real output or Vite/dev maps, prefer normalizing into
   `StyleStructure` first.
5. If adding a style language, entry type, or dependency type, verify helper
   names still use `style` semantics.
6. Avoid reading the same file repeatedly. Avoid copying the same assertions
   across formats.
7. Run `pnpm run test`, `pnpm run typecheck`, `pnpm run build`, and
   `pnpm run format`.

## Current Non-Goals And Extension Points

The current test architecture still does not cover:

- full spawned CLI command behavior;
- real Vite dev server;
- published package tarball.

CLI tests should stay focused unless a full process boundary is required.
Prefer parser/runner unit tests for behavior such as build overrides and publish
flag validation. Add spawned command smoke tests only for process-level behavior,
such as:

- `auk --help` prints usage;
- `auk build-css` triggers the build flow;
- unknown command returns a failing exit code.

If other style languages are added through hooks later:

- do not add long-term pending/skipped tests;
- first decide whether the hook only converts source styles to CSS, or also
  participates in auklet's dependency graph;
- then extend fixtures, `StyleStructure`, and real output assertions.

## Current Structure

The current test suite has completed these structural changes:

- Base virtual project helper lives in `fixtures/virtualProject.ts`.
- High-level style project template lives in `fixtures/styleProjectTemplate.ts`.
- Structured assertion helpers for real build output and Vite/dev graph live in
  `fixtures/styleStructure.ts`.
- Project-level e2e tests cover the complete style dependency chain and four
  package-mode smoke scenarios.
- Large specs for `ModuleStyleBuilder`, `ModuleStyleGraph`, and `styleImports`
  have been split into semantic directories.
- CSS unit tests keep module-boundary responsibilities and do not carry complete
  project scenarios.
- Non-CSS temporary-project tests such as `configLoader`, `tsdownConfig`, and
  `cleanOutput` use the shared virtual project fixture.
