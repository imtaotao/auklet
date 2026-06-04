import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject, isString } from 'aidly';
import {
  resolveWorkspaceTargets,
  getWorkspaceDependencyNames,
} from '#auklet/workspace/targets';
import type { AukletEnvContext } from '#auklet/env';

type WorkspaceScriptPackageJson = {
  name?: string;
  private?: boolean;
  scripts?: unknown;
  dependencies?: unknown;
  optionalDependencies?: unknown;
  [key: string]: unknown;
};

export type WorkspaceScriptTarget = {
  packageRoot: string;
  packageName: string;
  packageJson: WorkspaceScriptPackageJson;
};

export async function resolveWorkspaceScriptTargets(
  cwd: string,
  filters: Array<string>,
  envContext: AukletEnvContext,
  options: {
    scope?: string;
    emptyTargetMessage?: string;
    includePrivate?: boolean;
    includeDependencies?: boolean;
  } = {},
) {
  return resolveWorkspaceTargets({
    cwd,
    filters,
    excludeRoot: true,
    env: envContext.normalizedValues,
    scope: options.scope ?? 'workspace',
    includePrivate: options.includePrivate,
    readPackageJson: readWorkspaceScriptPackageJson,
    getDependencies: getWorkspaceScriptDependencies,
    includeDependencies: options.includeDependencies,
    emptyTargetMessage:
      options.emptyTargetMessage ?? '[workspace] no workspace package found.',
    createTarget: (item, packageJson) => ({
      packageRoot: item.path,
      packageName: item.name,
      packageJson,
    }),
  });
}

const readWorkspaceScriptPackageJson = (packageRoot: string) => {
  const file = path.join(packageRoot, 'package.json');
  const packageJson = JSON.parse(
    fs.readFileSync(file, 'utf8'),
  ) as WorkspaceScriptPackageJson;

  if (!isPlainObject(packageJson)) {
    throw new Error(`[workspace] package.json must be an object at ${file}.`);
  }
  return packageJson;
};

const getWorkspaceScriptDependencies = (target: WorkspaceScriptTarget) => {
  return [
    ...getWorkspaceDependencyNames(target.packageJson.dependencies),
    ...getWorkspaceDependencyNames(target.packageJson.optionalDependencies),
  ];
};

export function getWorkspacePackageScript(
  packageJson: WorkspaceScriptPackageJson,
  name: string,
) {
  if (!isPlainObject(packageJson.scripts)) return null;
  const script = packageJson.scripts[name];
  return isString(script) ? script : null;
}
