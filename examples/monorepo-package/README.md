# Monorepo Package

A component-oriented monorepo for module CSS output.

Packages:

- `@demo/theme`: shared theme CSS package.
- `@demo/ui`: component package with `Button`, `Card`, package themes, and external style dependencies on `@demo/theme`.
- `@demo/reexports`: component package demonstrating CSS auto import from `.tsx` named re-export syntax. Its `.ts` re-export file is intentionally ignored by CSS auto import.

```bash
pnpm --dir examples/monorepo-package build
pnpm --dir examples/monorepo-package publish:dry-run
pnpm --dir examples/monorepo-package publish:local
```

Expected CSS output includes package-level `dist/index.css` and module CSS entries under `dist/es` and `dist/lib` because `modules` is enabled for style packages.

This example has its own `pnpm-workspace.yaml` so publish target discovery stays
inside this monorepo fixture. Package dry-run publishing points to a local
Verdaccio registry at `http://127.0.0.1:4873`. `publish:local` performs a real
local publish and requires a clean git working tree.
