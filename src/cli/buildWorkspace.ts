import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject, isString } from 'aidly';
import {
  getWorkspaceDependencyNames,
  resolveWorkspaceTargets,
} from '#auklet/workspace/targets';
import type { AukletEnvContext } from '#auklet/env';

type WorkspaceBuildPackageJson = {
  name?: string;
  private?: boolean;
  scripts?: unknown;
  dependencies?: unknown;
  optionalDependencies?: unknown;
  [key: string]: unknown;
};

export type WorkspaceBuildTarget = {
  packageRoot: string;
  packageName: string;
  packageJson: WorkspaceBuildPackageJson;
};

export async function resolveWorkspaceBuildTargets(
  cwd: string,
  filters: Array<string>,
  envContext: AukletEnvContext,
  options: {
    includePrivate?: boolean;
    includeDependencies?: boolean;
  } = {},
) {
  return resolveWorkspaceTargets({
    cwd,
    filters,
    env: envContext.normalizedValues,
    scope: 'build',
    emptyTargetMessage: '[build] no buildable workspace package found.',
    excludeRoot: true,
    includePrivate: options.includePrivate,
    readPackageJson: readBuildPackageJson,
    createTarget: (item, packageJson) => ({
      packageRoot: item.path,
      packageName: item.name,
      packageJson,
    }),
    getDependencies: getBuildWorkspaceDependencies,
    includeDependencies: options.includeDependencies,
  });
}

const readBuildPackageJson = (packageRoot: string) => {
  const file = path.join(packageRoot, 'package.json');
  const packageJson = JSON.parse(
    fs.readFileSync(file, 'utf8'),
  ) as WorkspaceBuildPackageJson;

  if (!isPlainObject(packageJson)) {
    throw new Error(`[build] package.json must be an object at ${file}.`);
  }
  return packageJson;
};

const getBuildWorkspaceDependencies = (target: WorkspaceBuildTarget) => {
  return [
    ...getWorkspaceDependencyNames(target.packageJson.dependencies),
    ...getWorkspaceDependencyNames(target.packageJson.optionalDependencies),
  ];
};

export function getWorkspacePackageScript(
  packageJson: WorkspaceBuildPackageJson,
  name: string,
) {
  if (!isPlainObject(packageJson.scripts)) return null;
  const script = packageJson.scripts[name];
  return isString(script) ? script : null;
}
