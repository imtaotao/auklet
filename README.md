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
| `auk inspect css`     | Explain CSS output entry, theme, and module plans.                |

Inspect flags:

| Flag                 | Commands          | Description                                                  |
| -------------------- | ----------------- | ------------------------------------------------------------ |
| publish flags        | `inspect publish` | Uses the same selection/version/auth flags as `auk publish`. |
| `--filter <pattern>` | `inspect pack`    | Select workspace packages by package name.                   |
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
