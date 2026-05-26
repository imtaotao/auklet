import { PublishTargetError } from '#auklet/publish/runner/publishTargetError';
import type { AukletLogger } from '#auklet/logger';

export function reportPublishFailure(
  error: PublishTargetError,
  version: string,
  logger: AukletLogger,
) {
  if (error.phase === 'publish' && error.publishedTargets.length) {
    logger.error('partial publish detected');
    logger.error('published packages:');
    for (const target of error.publishedTargets) {
      logger.error(formatPublishedTarget(logger, target.packageName, version));
    }
  }

  logger.error('failed package:');
  logger.error(
    formatPublishedTarget(logger, error.target.packageName, version),
  );
}

const formatPublishedTarget = (
  logger: AukletLogger,
  packageName: string,
  version: string,
) => {
  return ['- ', logger.package(packageName), '@', logger.version(version)];
};
