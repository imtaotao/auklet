import type { PublishOptions, PublishTarget } from '#auklet/publish/types';

export function createPublishArgs(
  target: PublishTarget,
  options: PublishOptions,
) {
  const args = ['--no-git-checks'];
  if (options.dryRun) args.push('--dry-run');
  if (options.otp) args.push('--otp', options.otp);
  if (options.ignoreScripts) args.push('--ignore-scripts');
  if (shouldAddPublicAccess(target)) args.push('--access', 'public');

  const tag = getPublishTag(options.version);
  if (tag) args.push('--tag', tag);
  return args;
}

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
