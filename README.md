<div align="center">
<h2>auklet</h2>

[![NPM version](https://img.shields.io/npm/v/auklet.svg?style=flat-square)](https://www.npmjs.com/package/auklet)

</div>

auklet is a build tool for TypeScript packages. It wraps `tsdown` for
JavaScript output, generates CSS style entries for component packages, provides
a Vite dev plugin for virtual package CSS, and includes pnpm workspace publish
helpers.

It is intended for single-package libraries, component packages, and pnpm
monorepos.

## Requirements

- Node.js `>=22`
- pnpm `10.27.0`

## Commands

The package exposes both `auk` and `auklet`.

### Build And Dev

| Command                 | Description                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `auk build`             | Remove configured output, then build JavaScript and CSS.              |
| `auk build-js`          | Run tsdown with auklet's built-in config unless `--config` is passed. |
| `auk build-css`         | Generate CSS output only.                                             |
| `auk build-css --watch` | Watch source/config/style files and rebuild CSS.                      |
| `auk dev`               | Watch JavaScript and CSS output for the current package.              |

Build and dev flags:

| Flag                          | Commands                                               | Description                                        |
| ----------------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| `--source <dir>`              | `build`, `build-js`, `build-css`, `dev`, `inspect css` | Source directory.                                  |
| `--output <dir>`              | `build`, `build-js`, `build-css`, `dev`, `inspect css` | Output directory.                                  |
| `--modules`                   | `build`, `build-js`, `build-css`, `dev`, `inspect css` | Enable unbundled module output.                    |
| `--no-modules`                | `build`, `build-js`, `build-css`, `dev`, `inspect css` | Disable unbundled module output.                   |
| `--build.formats <formats>`   | `build`, `build-js`, `dev`, `inspect css`              | Comma-separated `cjs`, `esm`, and/or `iife`.       |
| `--build.target <target>`     | `build`, `build-js`, `dev`, `inspect css`              | JavaScript target passed to tsdown.                |
| `--build.platform <platform>` | `build`, `build-js`, `dev`, `inspect css`              | `node`, `neutral`, or `browser`.                   |
| `--build.tsconfig <file>`     | `build`, `build-js`, `dev`, `inspect css`              | TypeScript config file.                            |
| `--watch`, `-w`               | `build-css`                                            | Watch CSS output.                                  |
| `--filter <pattern>`          | `build`, `dev`                                         | Select workspace packages by package name.         |
| `--workspace`                 | `build`, `dev`                                         | Alias for `--filter '*'`.                          |
| `--deps`                      | `build`, `dev`                                         | Include selected packages' workspace dependencies. |
| `--private`                   | `build`, `dev`                                         | Include private workspace packages.                |

Notes:

- `build-js` and single-package `dev` pass unknown flags through to tsdown.
- Build override flags cannot be combined with tsdown `--config`, `-c`, or
  `--no-config`.
- Workspace `build` runs each target package's own `build` script.
- Workspace `dev` runs each target package's own `dev` script. Packages without
  a `dev` script fail fast.
- Workspace `build` and `dev` skip private packages by default. Use `--private`
  to include them.

### Publish

| Command       | Description                          |
| ------------- | ------------------------------------ |
| `auk publish` | Run the pnpm-based publish workflow. |

Publish flags:

| Flag                 | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `--filter <pattern>` | Select workspace packages by package name.                               |
| `--workspace`        | Alias for `--filter '*'`.                                                |
| `--version <value>`  | Publish version, such as `patch`, `minor`, `major`, or an exact version. |
| `--dry-run`          | Plan and validate without writing versions, git, or registry state.      |
| `--no-format`        | Disable auklet's publish output formatter for this run.                  |
| `--no-git`           | Skip release commit and tag.                                             |
| `--allow-dirty`      | Allow publishing from a dirty worktree.                                  |
| `--ignore-scripts`   | Skip publish lifecycle hooks.                                            |
| `--otp <code>`       | Forward an npm 2FA one-time password.                                    |
| `--token <value>`    | Set `NODE_AUTH_TOKEN` and `NPM_TOKEN` for publish subprocesses.          |

### Inspect

| Command               | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `auk inspect publish` | Check publish readiness without changing files or registry state. |
| `auk inspect pack`    | Check package entry/export files before publishing.               |
| `auk inspect css`     | Explain CSS plans; validate `styles.shared.output` exports/dist.  |

Inspect flags:

| Flag                 | Commands          | Description                                                  |
| -------------------- | ----------------- | ------------------------------------------------------------ |
| publish flags        | `inspect publish` | Uses the same selection/version/auth flags as `auk publish`. |
| `--filter <pattern>` | `inspect pack`    | Select workspace packages by package name.                   |
| `--workspace`        | `inspect pack`    | Alias for `--filter '*'`.                                    |
| build/dev flags      | `inspect css`     | Uses the same build override flags as `auk build`.           |

### Owner

| Command                | Description                  |
| ---------------------- | ---------------------------- |
| `auk owner add <user>` | Add npm owners through pnpm. |

Owner flags:

| Flag                 | Description                                |
| -------------------- | ------------------------------------------ |
| `--filter <pattern>` | Add owners to matching workspace packages. |
| `--package <name>`   | Add owners to explicit npm packages.       |
| `--otp <code>`       | Forward an npm owner-management 2FA code.  |

### Misc

| Command         | Description           |
| --------------- | --------------------- |
| `auk version`   | Print auklet version. |
| `auk --version` | Print auklet version. |
| `auk --help`    | Print CLI help.       |

## Parameter Notes

- `--filter` is a package-name filter, not pnpm's full filter syntax.
  Supported patterns are `*`, exact package names, and scoped globs such as
  `@scope/*`.
- Workspace publish, inspect pack, and owner filters skip the workspace root
  package and private packages.
- String and boolean CLI values can reference loaded environment variables with
  `env:NAME`, for example `auk build --source env:AUKLET_SOURCE` or
  `auk publish --token env:NODE_AUTH_TOKEN`.
- auklet loads `.env` and `.env.local` files by default. Shell environment
  values keep the highest priority; package `.env.local` overrides package
  `.env`; root `.env.local` overrides root `.env`.
- Config precedence is:

```text
CLI flags > auklet.config.js / auklet.config.mjs > auklet defaults
```

## Configuration

`auklet.config.js` or `auklet.config.mjs` is optional. Without it, auklet uses
`src` as source, `dist` as output, no module output, and default JavaScript
formats.

Config files must export a named `config` binding:

```js
import { defineConfig } from 'auklet';

export const config = defineConfig({
  source: 'src',
  output: 'dist',
  modules: true,
  build: {
    formats: ['esm', 'cjs'],
    target: 'es2022',
  },
  styles: {
    prefix: '#subapp',
    themes: {
      light: './src/themes/light.css',
      dark: './src/themes/dark.css',
    },
    shared: {
      inner: ['./src/internal/**/*.{css,less}'],
      output: ['./src/shared/**/*.module.{less,css}'],
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

Source styles may be `.css` or `.less` (compiled by auklet; outputs stay CSS).
`styles.prefix` is mount-point isolation for **this package's own** global
rules (host must provide a matching container for `:root` / `html` / `body`):

| Style surface                                                      | Gets this package's `styles.prefix`? |
| ------------------------------------------------------------------ | ------------------------------------ |
| Own global source styles / `styles.themes` / `styles.shared.inner` | Yes                                  |
| `styles.shared.output` (Modules + plain css/less)                  | No                                   |
| CSS Modules (`*.module.*`)                                         | No                                   |
| `styles.dependencies` / other-package built CSS                    | No                                   |

Full table (incl. Less `reference`): `docs/css.md` → `styles.prefix` rules.
`styles.shared` is `{ inner?, output? }` only. `inner` is same-package **plain**
`.css` / `.less` (fast-glob). `output` publishes into `{output}/es|lib`
(default `dist`): CSS Modules → `*.scoped.css` + JS shim (`modules: true` when
Modules are included); plain `.css` / `.less` → copy as-is (Less **not**
compiled — consume tokens with `@import (reference)`; a JS `import` of `.less`
still compiles). Export Modules shims or plain published assets from
`package.json#exports`. `auk inspect css` verifies those exports and files
(exit `1` on failure). Workspace consumers can resolve `shared.output` exports
back to producer source for HMR; installed packages load published artifacts.
Details: `docs/css.md`. Component-to-component style imports are rejected; built
package style entries still use `styles.dependencies`.

CSS Modules (`*.module.css` / `*.module.less`) import from JS/TS and compile
outside the global style entry graph. They skip `styles.prefix` and ship with
the JS build as `*.scoped.css` plus a locals shim (never published
`*.module.css`, so consumers do not re-module). That source naming pattern is
reserved for Modules — rename former global `*.module.*` files if needed.
Ambient TypeScript declarations live in the consuming package.

`@tsdown/css` is required for tsdown's CSS stack; auklet `modules: true` owns
`*.module.*` (do not also enable a second Modules pipeline on those files).
Details: `docs/css.md`.

## Style Pattern Kinds

Several style options use `*` / `**`, but they are **not the same kind of
pattern**. Treat them by what they match:

| Config                             | Example                                                 | Kind          | Engine / rules                                                                                             | Matches                                              |
| ---------------------------------- | ------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `styles.shared.inner`              | `'./src/internal/**/*.{css,less}'`                      | File glob     | `fast-glob` under the package root; plain css/less only; gets `styles.prefix`                              | Files on disk (same-package `@import` allowlist)     |
| `styles.shared.output`             | `'./src/shared/**/*.{module.css,module.less,css,less}'` | File glob     | Modules and/or plain css/less; no `styles.prefix`; Modules → shim+scoped; plain → copy (Less not compiled) | Files on disk under `{output}/es\|lib`               |
| `styles.dependencies.*.components` | `'/components/**.css'`                                  | Path template | Lightweight `*` / `**` rewrite from JS/TSX imports                                                         | Specifiers such as `@scope/ui/components/Button.css` |
| `styles.dependencies.*.entry`      | `'/style.css'`                                          | Literal path  | No wildcards                                                                                               | Fixed package style entry                            |
| `styles.dependencies.*.themes`     | `{ light: '/themes/light.css' }`                        | Literal path  | No wildcards                                                                                               | Fixed theme entry per theme name                     |

Notes:

- `shared.*` answers “which files exist under this package?”.
- `dependencies.components` answers “given `import { Button } from '@scope/ui'`,
  which CSS specifier should auto-import?” — it does **not** scan the
  dependency’s filesystem with `fast-glob`.
- Prefer documenting examples with the resulting import, not only the pattern
  string. Details: `docs/css.md`.

## CSS / Less / CSS Modules Import Limits

Global styles (plain `.css` / `.less`) and CSS Modules (`*.module.*`) are
separate pipelines. Cross imports are restricted as follows (`@import` /
module partial edges; CSS Modules themselves are imported from JS/TSX):

| Importer → imported | Plain `.css`                                                     | Plain `.less`                                                         | `*.module.css` / `*.module.less` |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------- |
| Plain `.css`        | Allowed                                                          | Rejected                                                              | Rejected                         |
| Plain `.less`       | Allowed                                                          | Allowed locally; exported package Less requires `@import (reference)` | Rejected                         |
| `*.module.css`      | Allowed (local or exported package CSS; sibling / tracked asset) | Rejected                                                              | Rejected                         |
| `*.module.less`     | Allowed (sibling / tracked asset)                                | Allowed locally; exported package Less requires `@import (reference)` | Rejected                         |

Additional rules:

| Rule                                      | Behavior                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `.css` → `.less`                          | Always rejected (including `@import (less)` on `.css`).                                                               |
| Module → module                           | Rejected; import each CSS Module from JS/TSX so locals maps stay independent.                                         |
| Global → module                           | Rejected; Modules stay out of the global entry graph and `styles.prefix`.                                             |
| Component ↔ component global CSS          | Rejected; reuse via TSX + `styles.dependencies`, or `styles.shared.inner`.                                            |
| Cross-package global CSS                  | Use `styles.dependencies` against **built CSS**, not raw Less sources.                                                |
| Cross-package CSS Modules                 | Producer: `styles.shared.output` + export the **JS shim** (`*.scoped.css`); consumer: `import styles from 'pkg/...'`. |
| Export source `.module.*` instead of shim | Consumer may recompile; class hashes can drift vs producer.                                                           |
| Producer shared source change             | Rebuild producer; consumer HMR across published shims is not provided.                                                |

Full protocol (Less options, exports, secondary Modules, HMR): `docs/css.md`.
