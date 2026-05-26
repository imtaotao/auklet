import type { AukletLogger } from '#auklet/logger';
import type { PublishPlan, PublishTarget } from '#auklet/publish/types';
import { PublishTargetError } from '#auklet/publish/runner/publishTargetError';

type PublishSummaryStatus = 'success' | 'failure';
type VersionChangeTaskStatus = 'success' | 'error' | 'skipped';

type PublishSummaryOptions = {
  plan: PublishPlan;
  status: PublishSummaryStatus;
  error?: unknown;
};

export function reportPublishSummary(
  logger: AukletLogger,
  options: PublishSummaryOptions,
) {
  const publishError =
    options.error instanceof PublishTargetError ? options.error : undefined;
  const failedTarget = publishError?.target;
  const publishedTargets = publishError?.publishedTargets ?? [];
  const publishedTargetRoots = new Set(
    publishedTargets.map((target) => getTargetKey(target)),
  );
  const publishedCount =
    options.status === 'success' && !options.plan.dryRun
      ? options.plan.targets.length
      : publishedTargets.length;

  logger.newline();
  logger.raw(logger.colors.gray('-'.repeat(56)));
  logger.newline();

  logger.result({
    title: logger.colors.bold(getSummaryTitle(options.status, options.plan)),
    status: options.status === 'success' ? 'success' : 'error',
    body: getSummaryBody(options.status, options.plan, failedTarget),
    details: {
      mode: options.plan.dryRun ? 'dry-run' : 'publish',
      packages: String(options.plan.targets.length),
      version: logger.version(options.plan.version),
      published: String(publishedCount),
    },
  });
  logger.tasks({
    tasks: getVersionChangeTasks(logger, {
      targets: options.plan.targets,
      status: options.status,
      dryRun: options.plan.dryRun,
      failedTarget,
      publishedTargetRoots,
    }),
  });

  logger.newline();
}

const getSummaryTitle = (status: PublishSummaryStatus, plan: PublishPlan) => {
  if (status === 'failure') return 'Publish failed';
  return plan.dryRun ? 'Publish dry-run complete' : 'Publish complete';
};

const getSummaryBody = (
  status: PublishSummaryStatus,
  plan: PublishPlan,
  failedTarget?: PublishTarget,
) => {
  if (status === 'success') {
    return [
      plan.dryRun
        ? 'Preflight completed without publishing packages.'
        : 'All selected packages were published.',
    ];
  }

  if (failedTarget) {
    return [['Failed at ', failedTarget.packageName, '. Check logs above.']];
  }
  return ['Publish stopped before package publishing completed.'];
};

type VersionChangeTasksOptions = {
  targets: Array<PublishTarget>;
  status: PublishSummaryStatus;
  dryRun: boolean;
  failedTarget?: PublishTarget;
  publishedTargetRoots: Set<string>;
};

const getVersionChangeTasks = (
  logger: AukletLogger,
  options: VersionChangeTasksOptions,
) => {
  return options.targets.map((target) => ({
    title: [
      logger.package(target.packageName),
      ' ',
      ...formatVersionChange(logger, target.version, target.publishVersion),
    ],
    status: getVersionChangeTaskStatus(target, options),
  }));
};

const getVersionChangeTaskStatus = (
  target: PublishTarget,
  options: VersionChangeTasksOptions,
): VersionChangeTaskStatus => {
  if (options.dryRun) return 'skipped';
  if (options.status === 'success') return 'success';
  if (
    options.failedTarget &&
    getTargetKey(target) === getTargetKey(options.failedTarget)
  ) {
    return 'error';
  }
  if (options.publishedTargetRoots.has(getTargetKey(target))) return 'success';
  return 'skipped';
};

const getTargetKey = (target: PublishTarget) => {
  return `${target.packageRoot}:${target.packageName}`;
};

const formatVersionChange = (
  logger: AukletLogger,
  from: string,
  to: string,
) => {
  return [logger.version(from), logger.colors.gray(' -> '), logger.version(to)];
};
