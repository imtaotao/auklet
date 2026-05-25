import { PublishTargetError } from '#auklet/publish/runner/publishTargetError';

export function reportPublishFailure(
  error: PublishTargetError,
  version: string,
) {
  if (error.phase === 'publish' && error.publishedTargets.length) {
    console.error('[auklet:publish] partial publish detected');
    console.error('[auklet:publish] published packages:');
    for (const target of error.publishedTargets) {
      console.error(`- ${target.packageName}@${version}`);
    }
  }

  console.error('[auklet:publish] failed package:');
  console.error(`- ${error.target.packageName}@${version}`);
}
