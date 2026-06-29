import path from 'node:path';
import { isPlainObject } from 'aidly';
import { findWorkspaceRoot } from '#auklet/workspace/root';
import { readPnpmWorkspacePackageInfo } from '#auklet/workspace/packages';
import type { WorkspacePackageInfo } from '#auklet/workspace/packages';

type WorkspaceTargetBase<T> = {
  private?: boolean;
  packageJson: T;
  packageName: string;
};

type ResolveWorkspaceTargetsOptions<T, TTarget> = {
  cwd: string;
  scope: string;
  filters: Array<string>;
  emptyTargetMessage: string;
  excludeRoot?: boolean;
  includePrivate?: boolean;
  readErrorMessage?: string;
  includeDependencies?: boolean;
  env?: Record<string, string | undefined>;
  readPackageJson: (packageRoot: string) => T;
  getDependencies: (target: TTarget) => Array<string>;
  createTarget: (item: WorkspacePackageInfo, packageJson: T) => TTarget;
  onPrivatePackage?: (
    item: WorkspacePackageInfo,
    context: { exact: boolean },
  ) => void;
};

export async function resolveWorkspacePackageInfos(
  cwd: string,
  filters: Array<string>,
  options: {
    excludeRoot?: boolean;
    env?: Record<string, string | undefined>;
    scope: string;
    readErrorMessage?: string;
  },
) {
  const root = requireWorkspaceRoot(cwd, options.scope);
  const packages = filterWorkspaceRootPackage(
    await readWorkspacePackageInfo(root, options),
    root,
    options,
  );
  return filterWorkspacePackages(packages, filters, options.scope);
}

export async function resolveWorkspaceTargets<
  T,
  K extends WorkspaceTargetBase<T>,
>(options: ResolveWorkspaceTargetsOptions<T, K>) {
  const root = requireWorkspaceRoot(options.cwd, options.scope);
  const packages = filterWorkspaceRootPackage(
    await readWorkspacePackageInfo(root, options),
    root,
    options,
  );
  const matchedPackages = filterWorkspacePackages(
    packages,
    options.filters,
    options.scope,
  );
  const targetFactory = createWorkspaceTargetFactory(options);
  const targets = options.includeDependencies
    ? includeWorkspaceDependencies(
        matchedPackages,
        packages,
        targetFactory,
        options,
      )
    : matchedPackages
        .map((item) => targetFactory.create(item))
        .filter(isWorkspaceTarget);

  if (!targets.length) {
    throw new Error(options.emptyTargetMessage);
  }

  return sortWorkspaceTargets(targets, {
    getDependencies: options.getDependencies,
    scope: options.scope,
  });
}

export function getWorkspaceDependencyNames(value: unknown) {
  return isPlainObject(value) ? Object.keys(value) : [];
}

const filterWorkspaceRootPackage = (
  packages: Array<WorkspacePackageInfo>,
  root: string,
  options: { excludeRoot?: boolean },
) => {
  if (!options.excludeRoot) return packages;
  const normalizedRoot = path.resolve(root);
  return packages.filter((item) => path.resolve(item.path) !== normalizedRoot);
};

const isWorkspaceTarget = <T>(target: T | null): target is T => {
  return target !== null;
};

const createWorkspaceTargetFactory = <T, K extends WorkspaceTargetBase<T>>(
  options: ResolveWorkspaceTargetsOptions<T, K>,
) => {
  const cache = new Map<string, K | null>();

  const create = (item: WorkspacePackageInfo) => {
    const cached = cache.get(item.name);
    if (cached !== undefined) return cached;

    if (!options.includePrivate && item.private) {
      options.onPrivatePackage?.(item, {
        exact: options.filters.includes(item.name),
      });
      cache.set(item.name, null);
      return null;
    }

    const packageJson = options.readPackageJson(item.path);
    const target = options.createTarget(item, packageJson);
    cache.set(item.name, target);
    return target;
  };

  return { create };
};

const includeWorkspaceDependencies = <T, K extends WorkspaceTargetBase<T>>(
  matchedPackages: Array<WorkspacePackageInfo>,
  packages: Array<WorkspacePackageInfo>,
  targetFactory: ReturnType<typeof createWorkspaceTargetFactory<T, K>>,
  options: ResolveWorkspaceTargetsOptions<T, K>,
) => {
  const packageMap = new Map(packages.map((item) => [item.name, item]));
  const included = new Map<string, K>();

  const include = (item: WorkspacePackageInfo) => {
    const target = targetFactory.create(item);
    if (!target || included.has(target.packageName)) return;

    included.set(target.packageName, target);
    for (const dependency of options.getDependencies(target)) {
      const dependencyItem = packageMap.get(dependency);
      if (dependencyItem) include(dependencyItem);
    }
  };

  for (const item of matchedPackages) {
    include(item);
  }
  return [...included.values()];
};

const requireWorkspaceRoot = (cwd: string, scope: string) => {
  const root = findWorkspaceRoot(cwd);
  if (!root) {
    throw new Error(`[${scope}] --filter requires a pnpm workspace root.`);
  }
  return root;
};

const readWorkspacePackageInfo = async (
  root: string,
  options: {
    env?: Record<string, string | undefined>;
    readErrorMessage?: string;
  },
) => {
  try {
    return await readPnpmWorkspacePackageInfo(root, {
      env: options.env,
    });
  } catch (error) {
    if (!options.readErrorMessage) throw error;
    throw new Error(options.readErrorMessage, {
      cause: error,
    });
  }
};

const filterWorkspacePackages = (
  packages: Array<WorkspacePackageInfo>,
  filters: Array<string>,
  scope: string,
) => {
  const matched = packages.filter((item) =>
    filters.some((filter) => matchesWorkspacePackageFilter(item.name, filter)),
  );
  if (!matched.length) {
    throw new Error(
      `[${scope}] no workspace package matched filter: ${filters.join(', ')}`,
    );
  }
  return matched;
};

const matchesWorkspacePackageFilter = (packageName: string, filter: string) => {
  if (filter === '*') return true;
  if (filter.endsWith('/*')) {
    const scope = filter.slice(0, -2);
    return packageName.startsWith(`${scope}/`);
  }
  return packageName === filter;
};

const sortWorkspaceTargets = <TTarget extends { packageName: string }>(
  targets: Array<TTarget>,
  options: {
    scope: string;
    getDependencies: (target: TTarget) => Array<string>;
  },
) => {
  const targetNames = new Set(targets.map((target) => target.packageName));
  const targetMap = new Map(
    targets.map((target) => [target.packageName, target]),
  );
  const sorted: Array<TTarget> = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (target: TTarget) => {
    if (visited.has(target.packageName)) return;
    if (visiting.has(target.packageName)) {
      throw new Error(
        `[${options.scope}] circular workspace dependency detected at ${target.packageName}.`,
      );
    }

    visiting.add(target.packageName);
    for (const dependency of options.getDependencies(target)) {
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
