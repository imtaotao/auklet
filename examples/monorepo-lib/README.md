# Monorepo Lib

A minimal monorepo for TypeScript-only packages.

There are no source CSS files and `modules` is not enabled, so `auk build` should only create bundled JavaScript output. CSS build should not create component style entries.

```bash
pnpm --dir examples/monorepo-lib build
pnpm --dir examples/monorepo-lib publish:dry-run
pnpm --dir examples/monorepo-lib publish:local
```

This example has its own `pnpm-workspace.yaml` so publish target discovery stays
inside this monorepo fixture. Package dry-run publishing points to a local
Verdaccio registry at `http://127.0.0.1:4873`. `publish:local` performs a real
local publish and requires a clean git working tree.
