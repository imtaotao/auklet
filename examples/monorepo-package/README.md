# Monorepo Package

A component-oriented monorepo for module CSS output.

Packages:

- `@demo/theme`: shared theme CSS package.
- `@demo/ui`: component package with `Button`, `Card`, package themes, and
  external style dependencies on `@demo/theme`. Plain `Button/index.less` and
  `Tag.module.less` both consume `@demo/theme/tokens.less` via
  `@import (reference)`. Also publishes `styles.shared.output`: chip Modules
  (`…/chip.module.less` → shim + `*.scoped.css`), plain `helpers.css`, and
  `tokens.less` (copied as-is for reference).
- `@demo/dashboard`: consumes `@demo/ui` styles and the shared chip Modules
  export (library package, not a Vite app).
- `@demo/reexports`: component package demonstrating CSS auto import from `.tsx` named re-export syntax. Its `.ts` re-export file is intentionally ignored by CSS auto import.

App (outside `packages/`):

- `@demo/app`: private Vite app for hand-checking workspace
  `styles.shared.output` HMR (`aukletStylePlugin({ mode: 'monorepo' })`).

```bash
pnpm --dir examples/monorepo-package build
pnpm --dir examples/monorepo-package publish:dry-run
pnpm --dir examples/monorepo-package publish:local
```

### Shared.output HMR (manual)

`@demo/app` is `private` so `auk build --workspace` / publish skip it.

```bash
# from repo root (after pnpm install)
pnpm build
pnpm --filter @demo/ui build
pnpm --dir examples/monorepo-package dev:app
```

Open the printed local URL, then edit
`packages/ui/src/shared/chip.module.less` (e.g. chip background). The page
should hot-update without rebuilding `@demo/ui`. The on-page `chip class:`
string should match the producer hash used in
`packages/ui/dist/es/shared/chip.module.less.js` after a ui build.

Expected CSS output includes package-level `dist/index.css` and module CSS entries under `dist/es` and `dist/lib` because `modules` is enabled for style packages.

This example has its own `pnpm-workspace.yaml` so publish target discovery stays
inside this monorepo fixture. Package dry-run publishing points to a local
Verdaccio registry at `http://127.0.0.1:4873`.

Before running `publish:local`, start and log in to the local registry:

```bash
pnpm run dev:registry
pnpm run dev:registry-login
```

`publish:local` performs a real local publish and uses `--allow-dirty` so it can
be used while developing publish behavior.

To publish a new local version while skipping git operations:

```bash
pnpm --dir examples/monorepo-package publish:local -- --version patch
```
