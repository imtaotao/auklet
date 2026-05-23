<div align="center">
<h2>auklet</h2>

[![NPM version](https://img.shields.io/npm/v/auklet.svg?style=flat-square)](https://www.npmjs.com/package/auklet)

</div>

<h1></h1>

auklet is a build tool for TypeScript packages. It generates JavaScript and
TypeScript output through `tsdown`, and also provides CSS style entry builds,
module style auto imports, and a Vite dev plugin for virtual package CSS.

## Features

- Generate TypeScript package bundles, IIFE output, and unbundled module output.
- Generate package-level, module-level, theme, and external CSS entries.
- Infer module CSS dependencies from `.tsx` imports and re-exports.
- Turn package CSS imports into virtual CSS modules in Vite dev mode.
- Support single-package component libraries, single-package libraries,
  monorepo component packages, and monorepo libraries.
- Watch source/config/style changes and rebuild CSS output.

## Requirements

- Node.js `>=22`

## Project Shapes

auklet supports four project shapes:

- single-package component library;
- single-package TypeScript library;
- monorepo component packages;
- monorepo TypeScript libraries.

Production build commands always run from the **current package root**, whether
that package lives in a monorepo or not:

```bash
auk build
auk build-js
auk build-css
```

Vite dev mode is provided by `aukletStylePlugin`, which exposes virtual CSS
entries. The plugin defaults to single-package mode. If a workspace demo/app
needs to work with multiple packages at the same time, enable monorepo mode
explicitly.

## Quick Start

### Single-Package Component Library

Add `auklet.config.ts` in the package root:

```ts
import type { AukletConfig } from 'auklet';

export const config: AukletConfig = {
  source: 'src',
  output: 'dist',
  modules: true,
};
```

Then import CSS entries from the current package:

```ts
import '@scope/ui/style.css';
import '@scope/ui/components/Button.css';
```

See the "Vite Plugin" section for dev plugin setup.

## CLI

The package exposes both `auk` and `auklet` commands:

```bash
pnpm auk --help
pnpm auk dev
pnpm auk build
pnpm auk build-js
pnpm auk build-js --watch
pnpm auk build-css
pnpm auk build-css --watch
```

Commands:

- `dev`: starts JavaScript watch and CSS watch together.
- `build`: removes the configured `output` directory, then builds JavaScript and
  CSS output.
- `build-js`: runs tsdown. If no `--config` is passed, auklet uses its built-in
  tsdown config.
- `build-js --watch`: passes `--watch` through to tsdown and watches JS/TS
  builds.
- `build-css`: generates CSS output.
- `build-css --watch`: watches source/config/style files and rebuilds CSS.

## Configuration Example

Create `auklet.config.ts` in the package root:

```ts
import type { AukletConfig } from 'auklet';

export const config: AukletConfig = {
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
};
```

## Configuration Reference

The full `auklet.config.ts` shape is:

```ts
import type { UserConfig } from 'tsdown/config';

export interface AukletConfig {
  /**
   * Source directory, relative to the current package root.
   *
   * @default 'src'
   */
  source?: string;

  /**
   * Build output directory, relative to the current package root.
   *
   * `auk build` removes this directory before generating JavaScript and CSS
   * output again.
   *
   * @default 'dist'
   */
  output?: string;

  /**
   * Whether to generate unbundled module output.
   *
   * When enabled, auklet generates module output such as `dist/es` and
   * `dist/lib`. Module-level CSS output follows the same switch.
   *
   * @default false
   */
  modules?: boolean;

  /**
   * Style build configuration.
   *
   * @default { themes: {}, dependencies: {} }
   */
  styles?: {
    /**
     * Theme style entries for the current package.
     *
     * The key is the theme name, and the value is a style file path relative to
     * the current package root.
     *
     * @example
     * {
     *   light: './src/themes/light.css',
     *   dark: './src/themes/dark.css',
     * }
     *
     * @default {}
     */
    themes?: Record<string, string>;

    /**
     * External package style dependencies.
     *
     * The key is the dependency package name, and the value describes style
     * entry rules for that package.
     *
     * @default {}
     */
    dependencies?: Record<
      string,
      {
        /**
         * Package-level style entry from the dependency package.
         *
         * This participates in package style and external style generation for
         * the current package.
         *
         * @default undefined
         */
        entry?: string | string[];

        /**
         * Theme style entries from the dependency package.
         *
         * The key should match a theme name in the current package, and the
         * value is the corresponding theme entry in the dependency package.
         *
         * @default undefined
         */
        themes?: Record<string, string>;

        /**
         * Module CSS auto import rules.
         *
         * The field name remains `components` for compatibility with common
         * component-library usage. The rule itself is not limited to
         * components; paths such as `/pages/**.css` or `/blocks/**.css` are also
         * valid.
         *
         * @default undefined
         */
        components?: string | string[];
      }
    >;
  };

  /**
   * JavaScript/TypeScript build configuration.
   */
  build?: {
    /**
     * Package-level bundle formats.
     *
     * @default ['cjs', 'esm', 'iife']
     */
    formats?: Array<'cjs' | 'esm' | 'iife'>;

    /**
     * JavaScript compilation target passed to tsdown.
     *
     * Bundle, IIFE, and module output use the same target.
     *
     * @default 'es2020'
     */
    target?: string | string[] | false;

    /**
     * Runtime platform for the build target.
     *
     * @default 'neutral'
     */
    platform?: 'node' | 'neutral' | 'browser';

    /**
     * Custom bundle banner.
     *
     * When omitted, auklet generates one from package name/version/author.
     *
     * @default undefined
     */
    banner?: string;

    /**
     * Additional external package names.
     *
     * These are combined with package.json dependencies and peerDependencies
     * before being passed to tsdown.
     *
     * @default []
     */
    externals?: string[];

    /**
     * Path aliases passed to tsdown `alias`.
     *
     * This applies to both bundle output and module output.
     *
     * @default {}
     */
    alias?: Record<string, string>;

    /**
     * Package.json entry field resolution order for bundle output.
     *
     * This is passed to rolldown `resolve.mainFields`. When omitted, auklet
     * only sets `['browser', 'module', 'main']` for IIFE bundles.
     *
     * @default undefined
     */
    mainFields?: string[];

    /**
     * Global names for IIFE externals.
     *
     * This is passed to tsdown `output.globals` and overrides the global names
     * auklet infers from package names.
     *
     * @default {}
     */
    globals?: Record<string, string>;

    /**
     * TypeScript config file path, relative to the current package root.
     *
     * When omitted, auklet searches upward from the current package root for
     * the nearest `tsconfig.json`.
     *
     * @default undefined
     */
    tsconfig?: string;

    /**
     * Final tsdown config hook.
     *
     * auklet calls this after generating each tsdown config, allowing users to
     * make final adjustments.
     *
     * @default undefined
     */
    configureTsdown?: (
      config: UserConfig,
      context: {
        /**
         * Build output kind for the current config.
         *
         * `bundle` means package-level bundle/IIFE output.
         * `module` means unbundled module output generated by `modules: true`.
         */
        kind: 'bundle' | 'module';

        /**
         * Output format for the current config.
         */
        format: 'cjs' | 'esm' | 'iife';

        /**
         * Current package root.
         */
        packageRoot: string;

        /**
         * Current package build output directory.
         */
        output: string;

        /**
         * Current package.json name.
         */
        packageName?: string;
      },
    ) => UserConfig;
  };
}
```

A common component-library dependency rule looks like this:

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

## CSS Auto Import

CSS auto import only scans `.tsx` files. `.ts` and `.d.ts` files do not
participate in CSS auto import.

Supported syntax:

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

- Package-root named imports use the imported name. For example,
  `import { Button } from '@scope/ui'` tries to generate
  `@scope/ui/components/Button.css`.
- Local aliases do not affect package-root import inference. For example,
  `import { Button as UIButton } from '@scope/ui'` still uses `Button`.
- Deep imports use the import path. For example,
  `import { Anything } from '@scope/ui/components/Button'` tries to generate
  `@scope/ui/components/Button.css`.
- If the inferred CSS file does not exist, auklet skips it and does not generate
  an invalid import.
- If JavaScript auto inference and handwritten source CSS `@import` point to the
  same file, auklet dedupes the import.

Same-package source imports can be resolved through:

- relative paths, such as `../Button`;
- `package.json#imports`, preferring the `source` condition;
- `tsconfig.json` `compilerOptions.paths`.

Only candidates resolved into the current package `source` directory are treated
as same-package CSS dependencies.

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

### Single-Package Mode

The plugin defaults to single-package mode. Vite root is treated as the current
package root:

```ts
import { aukletStylePlugin } from 'auklet';

export default {
  plugins: [aukletStylePlugin()],
};
```

This is equivalent to:

```ts
aukletStylePlugin({ mode: 'package' });
```

Single-package mode is intended for running a Vite demo directly from a
component-library package root.

### Monorepo Mode

Use monorepo mode when a demo/app lives in a workspace and needs to work with
multiple workspace packages at the same time:

```ts
import { aukletStylePlugin } from 'auklet';

export default {
  plugins: [aukletStylePlugin({ mode: 'monorepo' })],
};
```

`mode: 'monorepo'` walks upward from Vite root to find `pnpm-workspace.yaml`,
then scans workspace packages.

### Plugin Options

```ts
export type AukletStylePluginOptions = {
  mode?: 'package' | 'monorepo';
  root?: string;
};
```

- `mode: 'package'`: default. Vite root is the current package root. This is
  intended for single-package component libraries.
- `mode: 'monorepo'`: walks upward from Vite root to find `pnpm-workspace.yaml`
  and scans workspace packages.
- `root`: custom graph root. This is usually unnecessary; use it only when a
  monorepo root cannot be inferred automatically.

### Supported CSS Imports

The plugin resolves package CSS ids such as:

```ts
import '@scope/app/style.css';
import '@scope/app/external.css';
import '@scope/app/module.css';
import '@scope/app/components/Button.css';
import '@scope/app/themes/light.css';
```

### Dependency Resolution

In dev mode, workspace package style dependencies keep using auklet virtual CSS
recursion so style changes across packages can be tracked. Third-party CSS
dependencies are resolved from the package root that declares them and emitted
as Vite `/@fs/...` imports, avoiding lost `node_modules` resolution context from
virtual modules.

## Build Constants

`auk build` injects these compile-time constants into bundles:

- `__DEV__`: `true` when `process.env.NODE_ENV !== 'production'`, otherwise
  `false`.
- `__TEST__`: always `false` in package builds.
- `__VERSION__`: current package version.

Vitest uses test-friendly values with the same names: `__DEV__` is `true`,
`__TEST__` is `true`, and `__VERSION__` is `'unknown'`.

## Programmatic API

```ts
import {
  ModuleStyleBuilder,
  ModuleStyleWatcher,
  aukletStylePlugin,
  loadAukletConfig,
  runTsdown,
} from 'auklet';

const aukletConfig = await loadAukletConfig(process.cwd());

await new ModuleStyleBuilder({
  packageRoot: process.cwd(),
  aukletConfig,
}).build();
```

Public exports include:

- `ModuleStyleBuilder`
- `ModuleStyleWatcher`
- `aukletStylePlugin`
- `loadAukletConfig`
- `resolveAukletConfigModule`
- `createTsdownArgs`
- `runTsdown`
- related TypeScript types

## Development

```bash
pnpm i
pnpm run test
pnpm run typecheck
pnpm run build
pnpm run format
```

Notes:

- `pnpm run build` rewrites `dist`.
- `pnpm run format` formats `bin`, `src`, `dist`, `examples`, and related files.
- Read `TESTING.md` before changing tests.

## Testing

Tests are organized into:

- `src/__tests__/e2e`: project-level output structure and dependency-chain tests.
- `src/__tests__/css`: CSS/style module and API tests.
- `src/__tests__/fixtures`: shared virtual project and style structure helpers.
- `src/__tests__/build`: tsdown/build config tests.

Temporary test projects are created under `src/__tests__/.tmp/` and ignored by
git.
