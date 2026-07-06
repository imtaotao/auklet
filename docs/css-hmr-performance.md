# CSS HMR Performance Investigation

This document records the CSS HMR performance issue fixed in the dev CSS
pipeline. It focuses on the observed behavior, investigation method, root cause,
and final cache invalidation model.

## Background

auklet has two CSS development paths:

- `ModuleStyleWatcher` rebuilds package CSS during `auk dev`.
- `aukletStylePlugin` serves Vite virtual CSS modules such as `auklet-css:*`
  and sends CSS HMR updates for tracked style dependencies.

Both paths use `StylePackageContext` to describe one package's CSS build state.
The context owns:

- discovered source and style files;
- style dependency resolution;
- inferred module style imports from TSX imports and re-exports;
- module style entry planning;
- local CSS import validation state.

The expensive part is inferring module style imports from source modules. That
scan resolves TSX import and re-export relationships across the package. CSS
content changes do not change that TSX dependency graph, so they should not
force the graph to be recomputed.

## Symptoms

In a real Willa dev project, saving a component CSS file such as
`packages/willa-content/src/components/Badge/index.css` delayed the Vite HMR
summary log by several seconds:

```text
package css hmr ../packages/willa-content/src/components/Badge/index.css tracked=1 updates=1
```

Temporary timing logs showed CSS-only rebuilds repeatedly spending about
6.4-6.9 seconds in the module import scan:

```text
CSS module-imports scan files=68 imports=295 matches=2 total=6400-6900ms
```

The same rebuild then finished around 6.9-7.4 seconds. This was not primarily a
disk cache read/write issue. The slow section was CPU and resolver work in the
source module import scan.

After the fix, warm CSS-only rebuilds in the same project reused the package
context and skipped the source module import scan:

```text
CSS package-context module-imports total=0-1ms
CSS build finished 270-590ms
```

Vite HMR for a cached virtual CSS request was measured around 198ms after the
file watcher event reached Vite. Cold virtual CSS loads can still be slower
because they must build the package context and infer the source module import
graph for the first time.

## Investigation Method

The performance work used temporary timing logs around the highest-level phases
instead of guessing from the final HMR log:

- `ModuleStyleImportCollector.collect()` measured source file count, resolved
  import count, match count, total time, parse time, and resolver time.
- `StylePackageContext.getModuleStyleImports()` measured whether the module
  import graph was reused or recomputed.
- Vite watcher and HMR handlers measured watcher entry time, cache
  invalidation, virtual CSS regeneration, and update send time.
- The Willa project was used as the real regression target because it had a
  representative source graph and the slow CSS save behavior reproduced
  consistently.

The temporary phase logs were removed after the root cause was confirmed. The
normal HMR summary log remains.

## Root Cause

The previous CSS-only path invalidated too much state.

`StylePackageContext` already cached the TSX-derived module import graph through
`getModuleStyleImports()`, but the watcher recreated the whole context on every
CSS rebuild. That discarded the cached module import graph, so a plain CSS
content edit still recomputed source module imports.

The Vite request cache had a similar problem: CSS changes invalidated package
state broadly enough that the next virtual CSS request could rebuild more
context than necessary.

The correct invalidation boundary is different for CSS and source-module
changes:

| Change type              | Required invalidation                                  | State that should be reused           |
| ------------------------ | ------------------------------------------------------ | ------------------------------------- |
| CSS content change       | CSS entry planner, CSS import validation, load results | TSX-derived module import graph       |
| TSX source module change | TSX-derived module import graph and CSS entry planner  | Package discovery that is still valid |
| Config/add/unlink change | Full package context                                   | None from the old context             |

CSS content changes still need validation caches reset. Otherwise a valid CSS
graph could become invalid after a save, for example by adding a local CSS
import cycle, while the reused context incorrectly skipped validation.

## Solution

The fix separates package context reuse from CSS content cache invalidation.

### Package Context Reuse

`ModuleStyleBuilder` can now create a `StylePackageContext` separately from
`build()`. `ModuleStyleWatcher` keeps one context for the current package while
the watched file set remains structurally valid.

CSS-only changes reuse that context instead of rebuilding it. This keeps the
expensive TSX module import graph warm.

### Layered Context Invalidation

`StylePackageContext` now exposes two invalidation levels:

| Method                           | Used for                  | Clears                                               |
| -------------------------------- | ------------------------- | ---------------------------------------------------- |
| `invalidateStyleContentCaches()` | CSS content changes       | module entry planner and CSS import validation flags |
| `invalidateModuleStyleImports()` | TSX source module changes | module import graph and module entry planner         |

CSS content invalidation resets:

- `moduleStyleEntryPlanner`;
- `hasValidatedSourceRootLocalStyleImports`;
- `hasValidatedPreservedLocalStyleImports`.

This preserves performance without skipping newly introduced CSS import errors.

### Vite Request Cache Invalidation

The Vite request cache now distinguishes full package invalidation from CSS-only
load-result invalidation:

- `invalidatePackage(packageName)` removes the cached package context and load
  results. It is used for structural changes such as config changes, added
  files, removed files, and source module graph changes.
- `invalidatePackageLoadResults(packageName)` keeps the package context but
  invalidates virtual CSS load results and calls
  `packageContext.invalidateStyleContentCaches()`. It is used for CSS content
  changes.

`ModuleStyleGraph.invalidateFileLoadResults(file)` resolves a changed file to
its package and routes CSS-only invalidation through the lighter path.

### HMR Scope

The HMR dependency tracker still limits updates to virtual CSS modules that
actually watch the changed CSS file. Imported local/shared CSS and existing
external CSS files can update their dependent virtual CSS modules, while graph
external ordinary CSS files return control to Vite's native CSS HMR.

This keeps the previous correctness fixes:

- source CSS `@import` graphs remain tracked;
- local/shared imported CSS changes still refresh dependent virtual modules;
- source TSX dependency changes still use output comparison before sending CSS
  updates;
- CSS files outside auklet's tracked graph do not suppress Vite's own HMR or
  other plugin reload behavior.

## Verification

The fix was validated with unit tests and a real Willa dev regression.

Repository checks:

```bash
pnpm build
pnpm typecheck
pnpm test
```

The full test suite passed with 58 test files and 406 tests.

Relevant coverage includes:

- `src/__tests__/css/watcher.spec.ts`: CSS-only rebuilds reuse package context;
  TSX source changes invalidate module imports.
- `src/__tests__/css/moduleGraph/cache.spec.ts`: CSS-only virtual CSS
  invalidation keeps context reuse but reruns CSS import validation, including a
  cycle introduced after the first valid load.
- `src/__tests__/css/hmr.spec.ts` and
  `src/__tests__/css/vitePlugin.spec.ts`: tracked CSS HMR still updates
  dependent virtual CSS modules without taking over unrelated native Vite CSS
  updates.

Real-project regression result:

- warm CSS-only watcher rebuilds dropped from roughly 6.9-7.4 seconds to roughly
  270-590ms;
- cached Vite HMR for the tested Badge CSS change completed in roughly 198ms
  after Vite received the watcher event;
- cold virtual CSS loads can still pay the source module import scan cost.

## Remaining Performance Boundary

This fix targets warm CSS-only changes. It does not remove the cost of a cold
package context or first virtual CSS load.

Future cold-load optimization should focus on
`ModuleStyleImportCollector.collect()` and source import resolution, because
the Willa measurements showed that source-module resolution dominated the
initial scan time.
