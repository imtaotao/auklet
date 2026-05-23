# Monorepo Lib

A minimal monorepo for TypeScript-only packages.

There are no source CSS files and `modules` is not enabled, so `auk build` should only create bundled JavaScript output. CSS build should not create component style entries.

```bash
cd ../../
pnpm i
pnpm --filter @demo/monorepo-lib build
```
