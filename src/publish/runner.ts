import path from 'node:path';
import {
  ensureGitClean,
  hasGitChanges,
  isGitRepository,
} from '#auklet/publish/git';
import { commitRelease, createVersionTag } from '#auklet/publish/git';
import { formatPublishOutputs } from '#auklet/publish/format';
import { runPackageBuilds, validateBuildScript } from '#auklet/publish/build';
import { runPnpmOwnerAdd, runPnpmPublish } from '#auklet/publish/pnpm';
import { runPublishHook } from '#auklet/publish/hooks';
import { readPackageJson, writePackageJson } from '#auklet/publish/packageJson';
import {
  resolveOwnerPackageNames,
  resolvePublishPlan,
} from '#auklet/publish/targetResolver';
import type {
  OwnerOptions,
  PublishOptions,
  PublishPlan,
  PublishTarget,
} from '#auklet/publish/types';

export async function publishPackages(options: PublishOptions) {
  const plan = await preparePublishPlan(options);
  await runPackageBuilds(plan.targets);
  await formatPublishOutputs(plan.targets, plan.config.format !== false);

  let beforeCompleted = false;
  try {
    await runPublishHook({ status: 'before', plan });
    beforeCompleted = true;

    if (plan.dryRun) {
      await publishAllTargets(plan, options, 'preflight');
    } else {
      await publishAllTargets(plan, { ...options, dryRun: true }, 'preflight');
      await commitAndTagIfNeeded(plan, options);
      await publishAllTargets(plan, options, 'publish');
    }
  } catch (error) {
    if (!beforeCompleted) throw error;
    await handlePublishFailure(plan, error);
  }

  await runPublishHook({ status: 'success', plan });
}

export async function addOwners(options: OwnerOptions) {
  const packageNames = await resolveOwnerPackageNames(options);
  if (!packageNames.length) {
    throw new Error('[auklet:publish] no owner target package found.');
  }

  for (const packageName of packageNames) {
    for (const user of options.users) {
      await runPnpmOwnerAdd(packageName, user, {
        cwd: options.cwd,
        otp: options.otp,
      });
    }
  }
}

const preparePublishPlan = async (options: PublishOptions) => {
  const plan = await resolvePublishPlan(options);
  validateBuildScript(plan.targets);

  const git = await isGitRepository(plan.root);
  if (!plan.dryRun && git) {
    await ensureGitClean(plan.root);
  }

  if (!plan.dryRun && options.version) {
    writePublishVersions(plan);
  }

  return plan;
};

const writePublishVersions = (plan: PublishPlan) => {
  const packageRoots = new Set([
    plan.root,
    ...plan.targets.map((target) => target.packageRoot),
  ]);

  for (const packageRoot of packageRoots) {
    const packageJson = readPackageJson(packageRoot);
    packageJson.version = plan.version;
    writePackageJson(packageRoot, packageJson);
  }
};

const publishAllTargets = async (
  plan: PublishPlan,
  options: PublishOptions,
  phase: PublishPhase,
) => {
  for (const target of plan.targets) {
    try {
      await runPnpmPublish(
        target.packageRoot,
        createPublishArgs(target, options),
      );
    } catch (error) {
      throw new PublishTargetError(target, phase, error);
    }
  }
};

const createPublishArgs = (target: PublishTarget, options: PublishOptions) => {
  const args = ['--no-git-checks'];
  if (options.dryRun) args.push('--dry-run');
  if (options.otp) args.push('--otp', options.otp);
  if (options.ignoreScripts) args.push('--ignore-scripts');
  if (shouldAddPublicAccess(target)) args.push('--access', 'public');

  const tag = getPublishTag(options.version);
  if (tag) args.push('--tag', tag);
  return args;
};

const shouldAddPublicAccess = (target: PublishTarget) => {
  return (
    target.packageName.startsWith('@') &&
    !target.private &&
    !target.packageJson.publishConfig?.access
  );
};

const getPublishTag = (versionSpec: string | undefined) => {
  if (versionSpec === 'alpha' || versionSpec === 'beta') return versionSpec;
  return null;
};

const commitAndTagIfNeeded = async (
  plan: PublishPlan,
  options: PublishOptions,
) => {
  const git = await isGitRepository(plan.root);
  if (!git) {
    console.warn(
      '[auklet:publish] git repository not found, skipping commit and tag.',
    );
    return;
  }

  const changed = await hasGitChanges(plan.root);
  if (changed) {
    if (!options.version) {
      throw new Error(
        '[auklet:publish] build or format changed files. Commit changes before publishing without --version.',
      );
    }
    await commitRelease(plan.root, plan.version);
  }

  await createVersionTag(plan.root, plan.version);
};

const handlePublishFailure = async (plan: PublishPlan, error: unknown) => {
  const failedTarget =
    error instanceof PublishTargetError ? error.target : undefined;
  try {
    await runPublishHook({
      status: 'failure',
      plan,
      failedTarget,
      error: error instanceof PublishTargetError ? error.originalError : error,
    });
  } catch (hookError) {
    console.error(hookError);
  }

  if (failedTarget) {
    const phase = error instanceof PublishTargetError ? error.phase : null;
    if (phase === 'publish') {
      console.error('[auklet:publish] partial publish detected');
    }
    console.error('[auklet:publish] failed package:');
    console.error(`- ${failedTarget.packageName}@${plan.version}`);
  }
  throw error;
};

type PublishPhase = 'preflight' | 'publish';

class PublishTargetError extends Error {
  constructor(
    readonly target: PublishTarget,
    readonly phase: PublishPhase,
    readonly originalError: unknown,
  ) {
    super(
      `[auklet:publish] publish failed for ${target.packageName} at ${path.relative(process.cwd(), target.packageRoot) || target.packageRoot}.`,
    );
  }
}
