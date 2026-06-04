import path from 'node:path';
import semver from 'semver';
import { findWorkspaceRoot } from '#auklet/workspace/root';
import { createPublishRootEnv } from '#auklet/publish/publishEnv';
import { createAukletLogger, type AukletLogger } from '#auklet/logger';
import {
  resolveWorkspacePackageInfos,
  resolveWorkspaceTargets,
} from '#auklet/workspace/targets';
import {
  getPublishConfig,
  readPackageJson,
  requirePackageName,
  requirePackageVersion,
} from '#auklet/publish/api/packageJsonApi';
import type {
  OwnerOptions,
  PackageJson,
  PublishOptions,
  PublishPlan,
  PublishRuntime,
  PublishTarget,
} from '#auklet/publish/types';
import {
  resolvePublishVersion,
  validateVersionConsistency,
} from '#auklet/publish/version';

type ResolvePublishTargetsOptions = Pick<
  PublishOptions,
  'cwd' | 'filters' | 'version' | 'dryRun' | 'token'
>;

type ResolveOwnerTargetsOptions = Pick<
  OwnerOptions,
  'cwd' | 'filters' | 'packages'
>;

export async function resolvePublishPlan(
  options: ResolvePublishTargetsOptions,
  runtime: PublishRuntime,
  logger: AukletLogger = createAukletLogger({ scope: 'publish' }),
) {
  if (options.filters.length) {
    return resolveMonorepoPublishPlan(options, runtime, logger);
  }
  return resolveCurrentPackagePublishPlan(options);
}

export async function resolveOwnerPackageNames(
  options: ResolveOwnerTargetsOptions,
) {
  if (options.filters.length && options.packages.length) {
    throw new Error(
      '[publish] owner command cannot use --filter and --package together.',
    );
  }

  if (options.filters.length) {
    const root = requireWorkspaceRoot(options.cwd);
    const packages = await resolveWorkspacePackageInfos(root, options.filters, {
      scope: 'publish',
      readErrorMessage: publishWorkspaceReadErrorMessage,
    });
    return packages.filter((item) => !item.private).map((item) => item.name);
  }

  if (options.packages.length) {
    return [...new Set(options.packages)];
  }

  const packageJson = readPackageJson(options.cwd);

  if (packageJson.private) {
    throw new Error('[publish] current package is private.');
  }
  return [requirePackageName(options.cwd, packageJson)];
}

const resolveCurrentPackagePublishPlan = async (
  options: ResolvePublishTargetsOptions,
): Promise<PublishPlan> => {
  const packageRoot = path.resolve(options.cwd);
  const packageJson = readPackageJson(packageRoot);
  const version = requirePackageVersion(packageRoot, packageJson);
  const workspaceRoot = findWorkspaceRoot(packageRoot);

  if (workspaceRoot === packageRoot && packageJson.private) {
    throw new Error(
      '[publish] current directory is a private monorepo root. Use --filter to select workspace packages.',
    );
  }

  const publishVersion = await resolvePublishVersion(
    version,
    options.version,
    packageRoot,
  );
  const target = createPublishTarget({
    packageRoot,
    packageJson,
    publishVersion,
    workspaceMode: 'single',
  });

  validatePublishTargets([target]);
  return {
    root: packageRoot,
    version: publishVersion,
    dryRun: options.dryRun,
    targets: [target],
    config: getPublishConfig(packageJson),
    workspaceMode: 'single',
  };
};

const resolveMonorepoPublishPlan = async (
  options: ResolvePublishTargetsOptions,
  runtime: PublishRuntime,
  logger: AukletLogger,
): Promise<PublishPlan> => {
  const root = requireWorkspaceRoot(options.cwd);
  const rootPackageJson = readPackageJson(root);
  const rootVersion = requirePackageVersion(root, rootPackageJson);
  const { env } = createPublishRootEnv(
    {
      token: options.token,
    },
    runtime,
  );
  const targets = await resolveWorkspaceTargets({
    env,
    cwd: root,
    scope: 'publish',
    readErrorMessage: publishWorkspaceReadErrorMessage,
    readPackageJson,
    filters: options.filters,
    getDependencies: getWorkspaceDependencies,
    emptyTargetMessage: '[publish] no publishable package found.',
    includePrivate: false,
    createTarget: (item, packageJson) =>
      createPublishTarget({
        packageRoot: item.path,
        packageJson,
        publishVersion: '',
        workspaceMode: 'monorepo',
      }),
    onPrivatePackage: (item, context) => {
      if (context.exact) {
        logger.warnOnce(
          'package ',
          logger.package(item.name),
          ' is private, skipping.',
        );
      }
    },
  });
  const versionBase = getMonorepoVersionBase(rootVersion, targets);
  const publishVersion = await resolvePublishVersion(
    versionBase,
    options.version,
    root,
  );
  const publishTargets = targets.map((target) => ({
    ...target,
    publishVersion,
  }));

  validatePublishTargets(publishTargets);
  validateWorkspaceInternalDependencies(publishTargets);
  if (!options.version) {
    validateVersionConsistency(rootVersion, publishTargets);
  }

  return {
    root,
    version: publishVersion,
    dryRun: options.dryRun,
    targets: publishTargets,
    config: getPublishConfig(rootPackageJson),
    workspaceMode: 'monorepo',
  };
};

const getMonorepoVersionBase = (
  rootVersion: string,
  targets: Array<PublishTarget>,
) => {
  return targets.reduce((highest, target) => {
    return isGreaterVersion(target.version, highest) ? target.version : highest;
  }, rootVersion);
};

const isGreaterVersion = (version: string, current: string) => {
  return semver.valid(version) && semver.valid(current)
    ? semver.gt(version, current)
    : false;
};

const requireWorkspaceRoot = (cwd: string) => {
  const root = findWorkspaceRoot(cwd);
  if (!root) {
    throw new Error('[publish] --filter requires a pnpm workspace root.');
  }
  return root;
};

const createPublishTarget = (options: {
  packageRoot: string;
  packageJson: PackageJson;
  publishVersion: string;
  workspaceMode: 'single' | 'monorepo';
}): PublishTarget => {
  const packageName = requirePackageName(
    options.packageRoot,
    options.packageJson,
  );
  const version = requirePackageVersion(
    options.packageRoot,
    options.packageJson,
  );
  return {
    packageRoot: options.packageRoot,
    packageName,
    version,
    publishVersion: options.publishVersion,
    private: options.packageJson.private === true,
    kind: 'package',
    workspaceMode: options.workspaceMode,
    packageJson: options.packageJson,
  };
};

const validatePublishTargets = (targets: Array<PublishTarget>) => {
  const publishableTargets = targets.filter((target) => !target.private);
  if (!publishableTargets.length) {
    throw new Error('[publish] no publishable package found.');
  }
};

const getWorkspaceDependencies = (target: PublishTarget) => {
  return Object.entries({
    ...target.packageJson.dependencies,
    ...target.packageJson.optionalDependencies,
  })
    .filter(([, version]) => version === 'workspace:*')
    .map(([packageName]) => packageName);
};

const validateWorkspaceInternalDependencies = (
  targets: Array<PublishTarget>,
) => {
  const targetNames = new Set(targets.map((target) => target.packageName));
  for (const target of targets) {
    for (const dependencyGroup of workspaceDependencyGroups) {
      for (const [packageName, version] of Object.entries(
        target.packageJson[dependencyGroup] ?? {},
      )) {
        if (!targetNames.has(packageName)) continue;
        if (version === 'workspace:*') continue;
        throw new Error(
          `[publish] package ${target.packageName} ${dependencyGroup} ${packageName} must use workspace:* before publishing.`,
        );
      }
    }
  }
};

const workspaceDependencyGroups = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

const publishWorkspaceReadErrorMessage =
  '[publish] failed to read pnpm workspace packages.';
