import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject, isString } from 'aidly';
import { readPnpmWorkspacePackageInfo } from '#auklet/workspace/packages';
import { findWorkspaceRoot } from '#auklet/workspace/root';
import { matchesWorkspacePackageFilter } from '#auklet/workspace/packageFilters';
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
) {
  const root = findWorkspaceRoot(cwd);
  if (!root) {
    throw new Error('[build] --filter requires a pnpm workspace root.');
  }

  const workspacePackages = await readPnpmWorkspacePackageInfo(root, {
    env: envContext.normalizedValues,
  });
  const matchedPackages = workspacePackages.filter((item) =>
    filters.some((filter) => matchesWorkspacePackageFilter(item.name, filter)),
  );

  if (!matchedPackages.length) {
    throw new Error(
      `[build] no workspace package matched filter: ${filters.join(', ')}`,
    );
  }

  const targets = matchedPackages
    .filter((item) => !item.private)
    .map((item) => {
      const packageJson = readBuildPackageJson(item.path);
      return {
        packageRoot: item.path,
        packageName: item.name,
        packageJson,
      };
    });

  if (!targets.length) {
    throw new Error('[build] no buildable workspace package found.');
  }

  return sortWorkspaceBuildTargets(targets);
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

const sortWorkspaceBuildTargets = (targets: Array<WorkspaceBuildTarget>) => {
  const targetNames = new Set(targets.map((target) => target.packageName));
  const targetMap = new Map(
    targets.map((target) => [target.packageName, target]),
  );
  const sorted: Array<WorkspaceBuildTarget> = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (target: WorkspaceBuildTarget) => {
    if (visited.has(target.packageName)) return;
    if (visiting.has(target.packageName)) {
      throw new Error(
        `[build] circular workspace dependency detected at ${target.packageName}.`,
      );
    }

    visiting.add(target.packageName);
    for (const dependency of getBuildWorkspaceDependencies(
      target.packageJson,
    )) {
      if (!targetNames.has(dependency)) continue;
      const dependencyTarget = targetMap.get(dependency);
      if (dependencyTarget) visit(dependencyTarget);
    }
    visiting.delete(target.packageName);
    visited.add(target.packageName);
    sorted.push(target);
  };

  for (const target of targets) {
    visit(target);
  }
  return sorted;
};

const getBuildWorkspaceDependencies = (
  packageJson: WorkspaceBuildPackageJson,
) => {
  return [
    ...getDependencyNames(packageJson.dependencies),
    ...getDependencyNames(packageJson.optionalDependencies),
  ];
};

const getDependencyNames = (value: unknown) => {
  return isPlainObject(value) ? Object.keys(value) : [];
};

export function getWorkspacePackageScript(
  packageJson: WorkspaceBuildPackageJson,
  name: string,
) {
  if (!isPlainObject(packageJson.scripts)) return null;
  const script = packageJson.scripts[name];
  return isString(script) ? script : null;
}
