# auklet

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
- pnpm `10.27.0`

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

- `build` removes `dist`, builds JavaScript output, then builds CSS output.
- `build-js` runs tsdown with the default auklet tsdown config unless a config flag is passed.
- `build-css` generates module CSS output.
- `build-css --watch` watches source/config files and rebuilds CSS.
- `dev` runs JavaScript and CSS watch tasks together.

## Configuration

Create `auklet.config.ts` in the package root:

```ts
import type { AukletConfig } from 'auklet';

export const config: AukletConfig = {
  sourceDir: 'src',
  outputDir: 'dist',
  themes: {
    light: './src/themes/light.css',
    dark: './src/themes/dark.css',
  },
  cssDependencies: {
    '@scope/ui': {
      global: '/style.css',
      component: ['/components/**.css'],
    },
    '@scope/theme': {
      global: '/style.css',
      themes: {
        light: '/themes/light.css',
        dark: '/themes/dark.css',
      },
    },
  },
  build: {
    formats: ['esm', 'cjs'],
    modules: true,
    tsconfig: 'tsconfig.json',
  },
};
```

### CSS Options

- `sourceDir`: source directory relative to the package root. Defaults to `src`.
- `outputDir`: build output directory relative to the package root. Defaults to `dist`.
- `themes`: package theme style entries.
- `cssDependencies`: external package style dependencies.

Each `cssDependencies` entry may define:

- `global`: package-level style dependency.
- `themes`: theme style dependency map.
- `component`: glob-like component style rules used to infer style imports from source imports.

### Build Options

- `formats`: package bundle formats: `esm`, `cjs`, or `iife`.
- `banner`: custom bundle banner.
- `externals`: additional external packages.
- `modules`: whether to generate unbundled `dist/es` and `dist/lib` output.
- `tsconfig`: TypeScript config path relative to the package root.

## CSS Output

`build-css` generates package and module style entries under the output directory.

Typical output includes:

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

Use `aukletCssPlugin` in Vite dev mode to load virtual package CSS entries.

```ts
import { aukletCssPlugin } from 'auklet';

export default {
  plugins: [aukletCssPlugin()],
};
```

The plugin resolves package CSS ids such as:

```ts
import '@scope/app/style.css';
import '@scope/app/components/Button.css';
import '@scope/app/themes/light.css';
```

## Programmatic API

```ts
import {
  ModuleCssBuilder,
  ModuleCssWatcher,
  aukletCssPlugin,
  loadAukletConfig,
  runTsdown,
} from 'auklet';

const aukletConfig = await loadAukletConfig(process.cwd());

await new ModuleCssBuilder({
  packageRoot: process.cwd(),
  aukletConfig,
}).build();
```

Public exports include:

- `ModuleCssBuilder`
- `ModuleCssWatcher`
- `aukletCssPlugin`
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
