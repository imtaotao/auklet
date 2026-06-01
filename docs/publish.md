# Publish Guide

Publish is an auxiliary workflow layered on top of auklet builds. Keep publish
orchestration in `src/publish/` rather than in `bin/entry.mjs`.

## Module Layout

```text
src/publish/
├── cli.ts                 # publish/owner subcommand flags and validation
├── inspect.ts             # inspect publish orchestration
├── inspectPack.ts         # package entry/export/file checks
├── inspectRegistry.ts     # registry auth and version checks for inspect
├── publishRunner.ts       # top-level publish state machine
├── targetResolver.ts      # package target discovery, filtering, and ordering
├── version.ts             # --version resolution
├── api/                   # git, package.json, pnpm, and hook command adapters
└── runner/                # build, format, preflight, git, version, publish stages
```

`src/cli/publish.ts` is only top-level CLI glue. `src/publish/cli.ts` owns
publish/owner subcommand argument parsing, pnpm setup, and handing typed options
to the runners.

`PublishRunner` owns the state machine. Other publish modules should keep a
single responsibility and avoid deciding cross-stage order.

## CLI Controls

Publish operation flags are CLI-only. The boundary is defined in
`docs/invariants.md`.

Keep these flags out of auklet config:

- `--filter`
- `--version`
- `--dry-run`
- `--otp`
- `--no-format`
- `--no-git`
- `--ignore-scripts`
- `--allow-dirty`

Publish hooks are the exception: they live in `package.json#auklet.publish`
because they are package lifecycle behavior.

## Inspect Commands

Inspect commands are read-only checks for publish readiness. They do not write
versions, run hooks, build, format, commit, tag, or publish packages.

- `auk inspect pack` checks `package.json` entry fields, `exports`, `bin`,
  `types`/`typings`, CSS entry fields, and declared `files` paths for selected
  targets.
- `auk inspect publish` resolves the publish plan, runs the same package file
  checks first, and stops before registry checks if local files are missing.
- If package file checks pass, `auk inspect publish` checks registry
  authentication and target version availability. Registry requests use a short
  timeout and two retries so network stalls fail clearly.
- Inspect publish accepts publish selection and version flags for plan
  compatibility. Side-effect flags such as `--dry-run`, `--no-git`, and
  `--no-format` only affect the displayed plan.

## State Order

Normal publish order:

```text
parse CLI flags
ensure pnpm
resolve publish plan
validate build scripts
initial git clean check unless `--dry-run` or `--allow-dirty`
verify npm authentication for each target with `pnpm whoami` unless `--dry-run`
verify target versions do not already exist unless `--dry-run`
log dry-run version plan when needed
beforeBuild hook
write package.json versions when `--version` and not `--dry-run`
pnpm run build for each target
afterBuild hook
format publish outputs unless `--no-format` is set
beforePublish hook
commit release changes and create tag when real publish can use git
pnpm publish for each target when not `--dry-run`
pnpm publish `--dry-run` for each target when `--dry-run`
afterPublish hook with success result
```

Dry-run runs the publish dry-run loop instead of release git operations and real
registry publish. It still resolves versions, runs build, runs hooks, and
formats outputs unless `--no-format` is set, but it does not write
`package.json#version`, create a git commit/tag, or perform a real registry
publish.

Real publish uses `stdio: inherit` for `pnpm publish` so npm browser
authentication and ENTER prompts stay attached to the user's terminal. Dry-run
publish uses piped output so auklet can inspect npm authentication errors.

## Version And Git Rules

- Without `--version`, publish uses the versions already in `package.json`.
- With `--version` and real publish, `VersionWriter` writes the root/current
  package version and every selected target version before build starts.
- In monorepo mode, `--version patch/minor/major` increments from the highest
  current version among the root and selected targets. This keeps retries after
  a partial publish moving forward instead of returning to the old root version.
- With `--version --dry-run`, versions are only calculated and logged. Build and
  pnpm dry-run still read the original package files.
- A real publish requires a clean git tree before build unless `--allow-dirty`
  is set.
- `--no-git` skips auklet's release commit and tag, but keeps the clean-worktree
  check.
- `--allow-dirty` skips the initial clean check, the post-build dirty check, the
  release commit, and the tag. It can still write versions and publish.
- Release commit/tag happens after build, formatting, and `beforePublish`, but
  before real per-package publish. This keeps version/build/format changes
  committed before anything is pushed to the registry.

## Hooks And Failures

Publish hooks are read from `package.json#auklet.publish`. In monorepo publish,
only the workspace root publish config is used for orchestration hooks.

- `beforeBuild` runs after the plan is valid and before any version write.
- If `beforeBuild` fails, publish stops immediately and does not run
  `afterPublish`.
- `afterBuild` runs after all package builds complete and before output
  formatting.
- `beforePublish` runs after build and formatting complete, but before release
  git operations and registry publish.
- `afterPublish` runs once after publish/dry-run finishes or after a later
  failure. It receives `AUKLET_PUBLISH_RESULT=success` or `failure`.
- If `afterBuild`, formatting, `beforePublish`, git commit/tag, or real publish
  fails, `afterPublish` still runs with failure metadata.
- If real publish partially succeeds, `PackagePublisher` stops on the first
  failed target and `publishFailureReporter` logs already-published packages.
  Auklet never rolls back package versions or registry publishes.
- npm authentication challenges during target authentication, dry-run publish,
  or real publish are reported through the publish logger. Users with publish
  2FA can retry with `--otp <code>` added to the original command; CI should use
  an npm automation token.

## Recovery Playbook

Use this section when a publish run stops after side effects have started.

### npm Authentication Failure

- If `pnpm whoami` fails before build, no package versions have been written.
  Log in with `pnpm login` or configure a token, then retry.
- If npm asks for browser or OTP verification during real publish, complete the
  current package's authentication in the terminal. Real publish is serial, so
  later packages should not start until the current `pnpm publish` exits.
- If publish 2FA is enabled and an OTP is available, retry the original command
  with `--otp <code>`.
- CI should use an npm automation token instead of interactive 2FA.

### Version Files Written But Publish Failed

- With `--version`, auklet may have written package versions before build and
  publish. Auklet does not roll these files back.
- Check the publish summary and npm output before retrying.
- If no package was published, either keep the written version and retry or
  manually revert the package files.
- If one or more packages were published, do not roll package versions back.
  Retry from a version that is greater than the published version.

### Partial Publish

- Partial publish means at least one target package was published before a later
  target failed.
- auklet stops on the first failed target and reports the published and failed
  packages.
- Registry publishes are not reversible by auklet.
- Fix the failure, keep versions moving forward, and retry only when the target
  versions are valid for the registry.

### Version Already Exists

- The pre-build version existence check runs before version writes.
- If a target version already exists, publish stops before build and before
  package version files are written.
- Choose a new version or adjust the target selection before retrying.

### Git Commit Or Tag Failure

- Release commit/tag happens before real registry publish.
- If commit or tag creation fails, no package should have been published by that
  run.
- Fix the git state, remove or rename conflicting tags if needed, then retry.
- Use `--no-git` only when the release commit/tag should be managed outside
  auklet.

### Dirty Tree

- A dirty tree before build stops real publish unless `--allow-dirty` is set.
- Build or formatting changes after version write require `--version`; without
  it, auklet stops and asks the user to commit changes before publishing.
- `--allow-dirty` skips clean checks and release git operations, but it can
  still publish packages.

## Target And Formatting Rules

- No `--filter`: publish the current package root.
- With `--filter`: require a pnpm workspace root, select matching workspace
  packages, skip private packages, and publish selected packages in workspace
  dependency order.
- Owner commands use the same target selection rules: without `--filter` or
  `--package`, `auk owner add <user...>` targets the current package. `--otp`
  is passed to `pnpm owner add` when provided.
- Selected workspace packages must depend on each other with `workspace:*`;
  non-workspace ranges are rejected before build.
- Built-in output formatting is controlled by the CLI option, not package
  config. Default is enabled; `--no-format` disables only auklet's output
  formatter and does not affect user build scripts or publish lifecycle scripts.
- Release git operations are enabled by default. `--no-git` skips auklet's
  release commit and tag but still keeps the clean-worktree check;
  `--allow-dirty` skips the clean check, commit, and tag.
