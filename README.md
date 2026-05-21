<div align="center">
<h2>auklet</h2>

[![NPM version](https://img.shields.io/npm/v/auklet.svg?style=flat-square)](https://www.npmjs.com/package/auklet)

</div>

<h1></h1>

Build utilities for TypeScript packages and module CSS output.

## Features

- Build JavaScript/TypeScript package output with the bundled tsdown config.
- Generate package-level and module-level CSS entries.
- Infer component style dependencies from source imports.
- Generate theme and external style entry files.
- Provide a Vite dev plugin for virtual package CSS entries.
- Watch source/config changes and rebuild module CSS output.

## Requirements

- Node.js `>=22`

## CLI

The package exposes both `auk` and `auklet` commands.

```bash
pnpm auk --help
pnpm auk build
pnpm auk build-js
pnpm auk build-css
pnpm auk build-css --watch
pnpm auk dev
```

Commands:

- `build` removes the configured `output` directory, builds JavaScript output, then builds CSS output.
- `build-js` runs tsdown with the default auklet tsdown config unless a config flag is passed.
- `build-css` generates module CSS output.
- `build-css --watch` watches source/config files and rebuilds CSS.
- `dev` runs JavaScript and CSS watch tasks together.

## Configuration

Create `auklet.config.ts` in the package root:

```ts
import type { AukletConfig } from 'auklet';

export const config: AukletConfig = {
  source: 'src',
  output: 'dist',
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
      '@scope/theme': {
        entry: '/style.css',
        themes: {
          light: '/themes/light.css',
          dark: '/themes/dark.css',
        },
      },
    },
  },
  modules: true,
  build: {
    formats: ['esm', 'cjs'],
    target: 'es2020',
    tsconfig: 'tsconfig.json',
  },
};
```

### Style Options

- `source`: source directory relative to the package root. Defaults to `src`.
- `output`: build output directory relative to the package root. Defaults to `dist`. `auk build` removes this directory before writing JavaScript and CSS output.
- `styles.themes`: package theme style entries. Defaults to `{}`.
- `styles.dependencies`: external package style dependencies. Defaults to `{}`.

Each `styles.dependencies` entry may define:

- `entry`: package-level style dependency.
- `themes`: theme style dependency map.
- `components`: glob-like component style rules used to infer style imports from source imports.

Component style inference only scans source `.tsx` files. Component imports or
re-exports in `.ts` files are ignored for CSS auto import, so component barrel
files that should drive component CSS must be `.tsx`.

Supported value forms include named imports, named re-exports, and local
re-exports that can be traced back to an import binding:

```tsx
import { Button } from '@scope/ui';
export { Card } from '@scope/ui/components/Card';

import { Dialog as BaseDialog } from '@scope/ui';
export { BaseDialog as Dialog };
```

`export * from '...'` is intentionally not supported for CSS auto import because
the exported component names cannot be inferred reliably.

Style configuration should use the grouped `styles` field.

```ts
export const config: AukletConfig = {
  styles: {
    dependencies: {
      '@scope/ui': {
        entry: '/style.css',
        components: ['/components/**.css'],
      },
    },
  },
};
```

### Build Options

- `modules`: whether to generate unbundled `dist/es` and `dist/lib` output. Defaults to `false`. CSS module style entries also follow this flag.
- `build.formats`: package bundle formats: `esm`, `cjs`, or `iife`. Defaults to `['cjs', 'esm', 'iife']`.
- `build.target`: JavaScript compilation target passed to tsdown. Defaults to `es2020` and is shared by bundle, global, and module output.
- `build.platform`: build target runtime platform: `neutral`, `node`, or `browser`. Defaults to `neutral`.
- `build.banner`: custom bundle banner. Defaults to a package name/version banner.
- `build.externals`: additional external packages. Defaults to `[]`.
- `build.tsconfig`: TypeScript config path relative to the package root. Defaults to the nearest `tsconfig.json` found from the package root upward.

### Build Constants

`auk build` injects these compile-time constants into bundled output:

- `__DEV__`: `true` when `process.env.NODE_ENV !== 'production'`, otherwise `false`.
- `__TEST__`: always `false` in package builds.
- `__VERSION__`: current package version from `package.json`.

Vitest uses the same names with test-friendly values: `__DEV__` is `true`, `__TEST__` is `true`, and `__VERSION__` is `'unknown'`.

## CSS Output

`build-css` always generates the package-level `index.css` when source styles exist.

Module style entries under `dist/es` and `dist/lib` are generated only when `modules` is `true`, matching the JavaScript module output.

Typical module output includes:

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

Important entry semantics:

- `index.css`: package-level aggregate CSS.
- `style/index.css`: package style entry for a specific output format.
- `style/module.css`: current package module styles.
- `style/external.css`: external style entries.
- `components/*/style/index.css`: component-level style entry.
- `themes/*.css`: theme style entry.

## Vite Plugin

Use `aukletStylePlugin` in Vite dev mode to load virtual package CSS entries.

```ts
import { aukletStylePlugin } from 'auklet';

export default {
  plugins: [aukletStylePlugin()],
};
```

The plugin resolves package CSS ids such as:

```ts
import '@scope/app/style.css';
import '@scope/app/components/Button.css';
import '@scope/app/themes/light.css';
```

In dev mode, workspace package style dependencies keep using auklet virtual CSS
entries so changes can be tracked recursively. Third-party CSS dependencies are
resolved from the package that declares the dependency and emitted as Vite
`/@fs/...` imports, so packages such as `katex/dist/katex.min.css` do not need
to be installed by the consuming app.

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
- `pnpm run format` formats `bin`, `src`, and `dist`.
- `TESTING.md` defines the testing architecture and style rules for future changes.

## Testing

Tests are organized into:

- `src/__tests__/e2e`: project-level output structure and dependency-chain tests.
- `src/__tests__/css`: module/API tests for CSS and style logic.
- `src/__tests__/fixtures`: shared virtual project and style structure helpers.
- `src/__tests__/build`: tsdown/build config tests.

Temporary test projects are created under `src/__tests__/.tmp/` and ignored by git.

Read `TESTING.md` before adding or changing tests.
