# Agent Guide

This file is the short operating guide for AI agents working in this
repository. For architecture details, read `CONTRIBUTING.md`. For test strategy,
read `TESTING.md`.

## Project Scope

auklet is a build tool for TypeScript packages. It wraps tsdown for JavaScript
output, builds CSS style entries, provides a Vite dev plugin, and includes pnpm
workspace publish helpers.

## Before Changing Code

- Read `CONTRIBUTING.md` before touching implementation architecture.
- Read `TESTING.md` before adding or changing tests.
- Keep public API changes in `src/index.ts` intentional and minimal.
- Prefer existing module boundaries over adding new cross-module shortcuts.

## Common Commands

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test:examples`

Run checks according to the change scope. Most code changes should run
`pnpm test` and `pnpm typecheck` before being considered complete. Run
`pnpm test:examples` when changing build output, Vite dev behavior, workspace
resolution, or publish flows.

## Maintenance Rules

- CLI command registration belongs in `src/cli/main.ts`; command-specific logic
  belongs in dedicated `src/cli/*` runners.
- Workspace package discovery belongs in `src/workspace/*`; do not duplicate
  pnpm workspace parsing in CSS or publish modules.
- Exported runtime functions should use `function` declarations; non-exported
  local helpers can use arrow functions.
- Do not manually annotate function return types unless the type is needed for
  clarity or API constraints.
- Do not silently swallow workspace, build, or publish errors.
- Keep `bin/entry.mjs` as a thin bootstrap into the built public API.
- Add focused tests for behavior changes, especially CLI flags, CSS graph
  behavior, workspace discovery, and publish failure handling.
