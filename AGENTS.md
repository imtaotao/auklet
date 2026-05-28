# Agent Guide

This file is the short operating guide for AI agents working in this
repository. Start with `CONTRIBUTING.md`, then read the focused docs for the
area you are changing.

## Project Scope

auklet is a build tool for TypeScript packages. It wraps tsdown for JavaScript
output, builds CSS style entries, provides a Vite dev plugin, and includes pnpm
workspace publish helpers.

## Before Changing Code

- Read `CONTRIBUTING.md` before touching implementation code.
- Read `docs/architecture.md` before changing config, CLI, or build
  architecture.
- Read `docs/css.md` before changing CSS production output, Vite CSS behavior,
  or style dependency resolution.
- Read `docs/invariants.md` before changing project boundaries or cross-domain
  behavior.
- Read `docs/maintenance.md` for task-specific change checklists.
- Read `docs/publish.md` before changing publish, owner, git, npm auth, or hook
  behavior.
- Read `docs/testing.md` before adding or changing tests.

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

- Treat `docs/invariants.md` as the source of project-level hard rules.
- Treat `docs/maintenance.md` as the source of task-specific checklists.
- Code style rules live in `CONTRIBUTING.md`.
