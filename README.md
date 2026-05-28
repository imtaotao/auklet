<div align="center">
<h2>auklet</h2>

[![NPM version](https://img.shields.io/npm/v/auklet.svg?style=flat-square)](https://www.npmjs.com/package/auklet)

</div>

auklet is a build tool for TypeScript packages. It wraps `tsdown` for
JavaScript output, generates CSS style entries for package/module/theme output,
provides module CSS auto imports, and includes a Vite dev plugin for virtual
package CSS.

It is designed for:

- single-package TypeScript libraries;
- single-package component libraries;
- pnpm monorepo TypeScript libraries;
- pnpm monorepo component packages.

Requirements:

- Node.js `>=22`
- pnpm for publish and owner workflows

## Quick Start

`auklet.config.js` or `auklet.config.mjs` is optional. Without it, auklet uses
`src` as source, `dist` as output, no module output, and default JavaScript
formats.

For a component package, a minimal config usually looks like this:

```js
import { defineConfig } from 'auklet';

export const config = defineConfig({
  modules: true,
});
```

Build JavaScript and CSS output:

```bash
auk build
```

Import generated CSS entries from the package:

```ts
import '@scope/ui/style.css';
import '@scope/ui/components/Button.css';
```

Use the Vite plugin during local development:

```ts
import { aukletStylePlugin } from 'auklet';

export default {
  plugins: [aukletStylePlugin()],
};
```

## CLI

The package exposes both `auk` and `auklet`.

| Command                 | Description                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `auk dev`               | Watch JavaScript and CSS output together.                             |
| `auk build`             | Remove configured output, then build JavaScript and CSS.              |
| `auk build-js`          | Run tsdown with auklet's built-in config unless `--config` is passed. |
| `auk build-js --watch`  | Pass watch mode through to tsdown.                                    |
| `auk build-css`         | Generate CSS output only.                                             |
| `auk build-css --watch` | Watch source/config/style files and rebuild CSS.                      |
| `auk publish`           | Run the pnpm-based publish workflow.                                  |
| `auk owner add <user>`  | Add npm owners through pnpm.                                          |

Build and dev commands can override package config for one run:

```bash
auk build --source source --output build --modules
auk build --build.formats esm,cjs
auk build --build.target es2022
auk build --build.platform node
auk build --build.tsconfig tsconfig.build.json
```

Supported build override flags:

| Flag                          | Description                                  |
| ----------------------------- | -------------------------------------------- |
| `--source <dir>`              | Source directory.                            |
| `--output <dir>`              | Output directory.                            |
| `--modules`                   | Enable unbundled module output.              |
| `--no-modules`                | Disable unbundled module output.             |
| `--build.formats <formats>`   | Comma-separated `cjs`, `esm`, and/or `iife`. |
| `--build.target <target>`     | JavaScript target passed to tsdown.          |
| `--build.platform <platform>` | `node`, `neutral`, or `browser`.             |
| `--build.tsconfig <file>`     | TypeScript config file.                      |

Config precedence:

```text
CLI flags > auklet.config.js / auklet.config.mjs > auklet defaults
```

`build-js` passes unknown flags through to tsdown. Auklet build override flags
cannot be combined with tsdown custom config flags:

```bash
# not allowed
auk build-js --source source --config tsdown.config.ts
auk build-js --output build -c tsdown.config.ts
auk build-js --modules --no-config
```

When `--config`, `-c`, or `--no-config` is used, tsdown owns the full build
config. Use auklet config files or tsdown config code directly instead of
auklet CLI overrides.

Publish controls stay on CLI flags:

```bash
auk publish
auk publish --filter @scope/ui
auk publish --version patch --dry-run
auk publish --no-format
auk publish --no-git
auk publish --otp 123456
auk owner add alice
auk owner add alice --filter @scope/ui --otp 123456
```

Target selection:

```text
auk publish
├─ --filter <pattern>      publish matching workspace packages
└─ no --filter             publish the current package
   └─ private monorepo root -> fail; use --filter

auk owner add <user...>
├─ --filter <pattern>      add owners to matching workspace packages
├─ --package <name>        add owners to explicit npm packages
└─ no selector             add owners to the current package
   └─ private package -> fail
```

`--no-format` disables auklet's publish output formatter for that run. It is not
configured in `package.json`.
`--no-git` skips auklet's release commit and tag for that run. The publish flow
still checks that the git worktree is clean unless `--allow-dirty` is also set.
Before writing versions, auklet checks npm authentication from each target
package directory. Package-local `.npmrc` files and
`package.json#publishConfig.registry` are respected.
`--otp` is forwarded to `pnpm publish` for npm accounts or organizations that
require publish 2FA, and to `pnpm owner add` for owner management 2FA. In CI,
prefer an npm automation token.

## Configuration

`auklet.config.js` or `auklet.config.mjs` is loaded from the current package
root. Config files must export a named `config` binding:

```js
import { defineConfig } from 'auklet';

export const config = defineConfig({
  source: 'src',
  output: 'dist',
  modules: true,
  build: {
    formats: ['esm', 'cjs'],
  },
  styles: {
    themes: {
      light: './src/themes/light.css',
      dark: './src/themes/dark.css',
    },
    dependencies: {
      '@scope/ui': {
        entry: '/style.css',
        components: ['/components/**.css'],
      },
    },
  },
});
```

Configuration reference:

| Path                                  | Default                  | Description                                                                                                                 |
| ------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `source`                              | `'src'`                  | Source directory relative to the current package root.                                                                      |
| `output`                              | `'dist'`                 | Build output directory. `auk build` removes it before rebuilding.                                                           |
| `modules`                             | `false`                  | Generate unbundled module JS output and module-level CSS output.                                                            |
| `styles.themes`                       | `{}`                     | Current package theme entries, keyed by theme name. Values are paths relative to the current package root.                  |
| `styles.dependencies`                 | `{}`                     | External package style rules, keyed by dependency package name.                                                             |
| `styles.dependencies[pkg].entry`      | `undefined`              | Package-level style entry or entries from the dependency package.                                                           |
| `styles.dependencies[pkg].themes`     | `undefined`              | Theme entries from the dependency package, keyed by current package theme name.                                             |
| `styles.dependencies[pkg].components` | `undefined`              | Module CSS auto import rules. The name is historical; rules can point to paths such as `/pages/**.css` or `/blocks/**.css`. |
| `build.formats`                       | `['cjs', 'esm', 'iife']` | Package-level bundle formats.                                                                                               |
| `build.target`                        | `'es2020'`               | JavaScript target passed to tsdown.                                                                                         |
| `build.platform`                      | `'neutral'`              | Runtime platform: `node`, `neutral`, or `browser`.                                                                          |
| `build.banner`                        | generated                | Custom bundle banner.                                                                                                       |
| `build.externals`                     | `[]`                     | Extra external package names combined with package dependencies.                                                            |
| `build.alias`                         | `{}`                     | Path aliases passed to tsdown.                                                                                              |
| `build.mainFields`                    | IIFE only                | Package entry field resolution order for bundle output.                                                                     |
| `build.globals`                       | `{}`                     | Global names for IIFE externals.                                                                                            |
| `build.tsconfig`                      | nearest `tsconfig.json`  | TypeScript config path relative to package root.                                                                            |
| `build.configureTsdown`               | `undefined`              | Final hook for each generated tsdown config.                                                                                |

Common dependency rule:

```ts
{
  entry: '/style.css',
  components: ['/pages/**.css', '/components/**.css'],
  themes: {
    dark: '/themes/dark.css',
    light: '/themes/light.css',
  },
}
```

`configureTsdown` receives the generated tsdown config and a context:

```ts
type ConfigureTsdownContext = {
  kind: 'bundle' | 'module';
  format: 'cjs' | 'esm' | 'iife';
  packageRoot: string;
  output: string;
  packageName?: string;
};
```

## CSS Conventions And Limits

CSS auto import only scans `.tsx` files. `.ts` and `.d.ts` files do not
participate.

Supported source syntax:

```tsx
import { Button } from '@scope/ui';
import { Card as UICard } from '@scope/ui';
import { Dialog } from '@scope/ui/components/Dialog';

export { Button } from '@scope/ui';
export { Card } from '@scope/ui/components/Card';

import { Dialog as BaseDialog } from '@scope/ui';
export { BaseDialog as Dialog };
```

Unsupported:

```ts
export * from '@scope/ui/components/Button';
```

`export *` is intentionally unsupported because auklet cannot reliably infer the
final exported component names, so it cannot infer CSS paths safely.

Inference rules:

- Package-root named imports use the imported name. For example, `Button` from
  `@scope/ui` tries `@scope/ui/components/Button.css`.
- Local aliases do not affect package-root inference. `Button as UIButton`
  still uses `Button`.
- Deep imports use the import path. `@scope/ui/components/Button` tries
  `@scope/ui/components/Button.css`.
- Missing inferred CSS files are skipped.
- Duplicate imports inferred from JS and handwritten source CSS are deduped.

Same-package source imports can be resolved through:

- relative paths such as `../Button`;
- `package.json#imports`, preferring the `source` condition;
- `tsconfig.json` `compilerOptions.paths`.

Only candidates resolved into the current package `source` directory are treated
as same-package CSS dependencies.

`build-css` handles CSS entry generation and simple `@import` expansion. It does
not aim to replace a full CSS toolchain. In particular, keep these boundaries in
mind:

- It does not process preprocessors such as Sass or Less.
- It does not implement CSS Modules.
- It does not perform URL rebasing.
- It does not evaluate conditional CSS import semantics beyond auklet's style
  entry rules.
- It expects source CSS files and package/style paths to exist on disk.

## CSS Output

`build-css` generates package-level `index.css` when source styles exist.

When `modules: true` is enabled, auklet also generates module-level CSS output
under `dist/es` and `dist/lib`, aligned with JavaScript module output.

Typical output structure:

```text
dist/
  index.css
  es/
    style/
      index.css
      module.css
      external.css
      themes/
        light.css
        dark.css
    components/
      Button/
        index.css
        style/index.css
  lib/
    ...
```

Entry semantics:

- `index.css`: package-level aggregate CSS.
- `style/index.css`: style entry for the current format.
- `style/module.css`: module styles from the current package.
- `style/external.css`: external style entry.
- `themes/*.css`: theme style entry.
- `components/*/style/index.css`: module-level style entry. `components/` is a
  common output path, not a restriction that the internal model only supports
  components.

If a generated CSS file is empty, auklet writes a placeholder comment so the
output is not a completely empty file.

## Vite Plugin

`aukletStylePlugin` is the Vite dev entry point. It turns package CSS imports
into virtual CSS modules. It only applies to the Vite dev server; production
builds still use `auk build` or `auk build-css`.

Single-package mode is the default:

```ts
import { aukletStylePlugin } from 'auklet';

export default {
  plugins: [aukletStylePlugin()],
};
```

Use monorepo mode when a workspace demo/app needs to work with multiple
workspace packages:

```ts
import { aukletStylePlugin } from 'auklet';

export default {
  plugins: [aukletStylePlugin({ mode: 'monorepo' })],
};
```

Primary options:

| Option | Default     | Description                                                                                                                                         |
| ------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode` | `'package'` | `'package'` treats Vite root as the package root. `'monorepo'` finds `pnpm-workspace.yaml` upward from Vite root and reads pnpm workspace packages. |
| `root` | inferred    | Custom graph root. Usually unnecessary.                                                                                                             |

Supported dev CSS imports:

```ts
import '@scope/app/style.css';
import '@scope/app/external.css';
import '@scope/app/module.css';
import '@scope/app/components/Button.css';
import '@scope/app/themes/light.css';
```

In dev mode, workspace package style dependencies keep using auklet virtual CSS
recursion so style changes across packages can be tracked. Third-party CSS
dependencies are resolved from the package root that declares them and emitted
as Vite `/@fs/...` imports.

## Build Constants

`auk build` injects these compile-time constants into bundles:

- `__DEV__`: `true` when `process.env.NODE_ENV !== 'production'`, otherwise
  `false`.
- `__TEST__`: always `false` in package builds.
- `__VERSION__`: current package version.

Vitest uses test-friendly values with the same names: `__DEV__` is `true`,
`__TEST__` is `true`, and `__VERSION__` is `'unknown'`.

## Programmatic API

The root package entry exposes the Vite plugin, configuration helpers, and a
small set of build helpers used by projects that need to compose auklet
programmatically. Publish and owner workflows remain CLI/internal implementation
details.

Public exports include:

- `aukletStylePlugin`
- `loadAukletConfig`
- `runTsdown`
- `defineKernelPackageConfigFromFile`
- `defineKernelPackageConfigFromOptions`
- `runAukletCli`
- `AukletStylePluginOptions`
- `AukletConfig`
- `PackageBuildOptions`
- `StyleOptions`
- related user-facing TypeScript types

## Development

```bash
pnpm i
pnpm test
pnpm typecheck
pnpm build
pnpm run format
```

Notes:

- `pnpm build` rewrites `dist`.
- `pnpm run format` formats `bin`, `src`, `dist`, `examples`, and related files.
- Read `docs/testing.md` before changing tests.
