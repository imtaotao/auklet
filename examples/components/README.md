# Components

A component-oriented monorepo for module CSS output.

Packages:

- `@demo/theme`: shared theme CSS package.
- `@demo/ui`: component package with `Button`, `Card`, package themes, and external style dependencies on `@demo/theme`.
- `@demo/reexports`: component package demonstrating CSS auto import from `.tsx` named re-export syntax. Its `.ts` re-export file is intentionally ignored by CSS auto import.

```bash
cd ../../
pnpm i
pnpm --filter @demo/components build
```

Expected CSS output includes package-level `dist/index.css` and module CSS entries under `dist/es` and `dist/lib` because `modules` is enabled for style packages.
