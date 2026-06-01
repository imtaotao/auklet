# Contributing Guide

This document is the contributor entry point for auklet. Keep it short and link
to focused maintainer docs for deeper architecture, CSS, publish, and testing
details.

Before changing implementation code, read the relevant docs:

- `docs/architecture.md`: repository layout, config boundaries, CLI/build flow.
- `docs/css.md`: CSS module responsibilities and capability boundaries.
- `docs/invariants.md`: project rules that should not be broken casually.
- `docs/maintenance.md`: task-oriented change playbooks.
- `docs/publish.md`: publish state machine, CLI-only controls, hooks, failures.
- `docs/testing.md`: test architecture and test style guide.
- `README.md`: user-facing behavior and examples.

## Project Scope

auklet is a build tool for TypeScript packages. It provides:

- JavaScript/TypeScript builds through `tsdown`.
- CSS/style output for packages, modules, themes, external dependencies, and
  Vite dev virtual CSS entries.
- An auxiliary publish workflow built on top of auklet builds and pnpm publish.

Keep the capability boundary clear:

- Project-level boundaries are defined in `docs/invariants.md`.
- Task-specific change paths are listed in `docs/maintenance.md`.

## Repository Layout

```text
.
├── bin/                  # CLI bootstrap, exposed as auk / auklet
├── src/                  # Tool source
├── docs/                 # Maintainer documentation
├── examples/             # Real demos and example-level tests
├── README.md             # User-facing documentation
├── package.json          # Package metadata, scripts, exports/imports
└── tsconfig.json         # TypeScript config for this package
```

## Common Commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm test:examples
pnpm run format
```

Notes:

- `pnpm build` rewrites `dist`.
- `pnpm test:examples` builds examples before running example assertions.
- `pnpm run format` formats `bin`, `src`, `dist`, `examples`, and related
  project files.

## Change Checklist

- Config field changes: check `types.ts`, `config.ts`, `README.md`, fixtures,
  and examples.
- Build CLI override changes: check `src/cli/buildArgs.ts`,
  `src/build/cliOverrides.ts`, README CLI docs, and unit tests.
- CSS behavior changes: check `docs/css.md`, `docs/invariants.md`, and
  `docs/maintenance.md`.
- Publish behavior changes: check `docs/publish.md`, README CLI docs, and
  publish runner/CLI tests.
- Project boundary changes: check `docs/invariants.md` and update it if an
  invariant intentionally changes.
- Common task paths: check `docs/maintenance.md` before changing CLI flags, CSS
  semantics, publish flow, config fields, workspace discovery, or public API.
- New CLI behavior: check `bin/entry.mjs`, `src/cli/*`, README CLI docs, and
  necessary unit tests.
- New public API: check `src/index.ts` and README Programmatic API docs.

## Test Rules

See `docs/testing.md` for the full guide. Keep test-layer decisions there rather
than repeating them in this entry document.

## Code Style

- Exported normal functions should prefer `function` declarations.
- Non-exported local helpers may use arrow functions.
- Functions usually do not need explicit return type annotations; use
  `satisfies` on returned values when the return structure needs constraints.
- Prefer aidly type guards such as `isString`, `isArray`, `isPlainObject`, and
  `isBoolean` when they cover the check. Only write local type checks for cases
  aidly does not provide.
- Use posix `/` semantics for output and test assertions. Absolute file-system
  paths should only appear in internal resolution steps.
- Do not spread CSS-specific naming into generic modules that may support other
  style languages later. Generic layers should prefer `style` naming.
- Keep `bin/entry.mjs` a bootstrap file. Command implementation belongs in
  `src/cli/*` or the relevant subdomain such as `src/publish/*`.

## Documentation Boundaries

- Keep `README.md` focused on users.
- Keep `CONTRIBUTING.md` focused on contributor onboarding.
- Put detailed architecture notes in `docs/architecture.md`.
- Put CSS capability and implementation boundaries in `docs/css.md`.
- Put project-level non-negotiable rules in `docs/invariants.md`.
- Put task-oriented change playbooks in `docs/maintenance.md`.
- Put publish lifecycle details in `docs/publish.md`.
- Put test strategy and assertion style in `docs/testing.md`.
