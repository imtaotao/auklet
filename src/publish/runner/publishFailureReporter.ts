import { createAukletLogger } from '#auklet/logger';
import { PublishTargetError } from '#auklet/publish/runner/publishTargetError';

export function reportPublishFailure(
  error: PublishTargetError,
  version: string,
) {
  const logger = createAukletLogger();
  const noteBody = logger.colors.rgb(184, 140, 40);
  const body = [
    noteBody('  Some packages were already published before the failure.'),
    '',
    ...error.publishedTargets.map((target) =>
      noteBody(`  published  ${target.packageName}@${version}`),
    ),
    noteBody(`  failed     ${error.target.packageName}@${version}`),
  ];

  logger.newline();
  logger.note({
    title: logger.colors.yellow(logger.colors.bold('Partial publish detected')),
    body,
  });
}
