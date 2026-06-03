import { isString } from 'aidly';
import type { PublishTarget } from '#auklet/publish/types';
import { runPnpmBuild } from '#auklet/publish/api/pnpmApi';
import type { AukletLogger } from '#auklet/logger';
import type { PublishOptions } from '#auklet/publish/types';

export function validateBuildScript(targets: Array<PublishTarget>) {
  for (const target of targets) {
    const buildScript = target.packageJson.scripts?.build;
    if (!isString(buildScript) || !buildScript) {
      throw new Error(
        `[publish] package ${target.packageName} must define package.json#scripts.build before publishing.`,
      );
    }
  }
}

export async function runPackageBuilds(
  targets: Array<PublishTarget>,
  logger: AukletLogger,
  options: Pick<PublishOptions, 'token'> = {},
) {
  for (const target of targets) {
    logger.step('build ', logger.package(target.packageName));
    if (options.token) {
      await runPnpmBuild(target.packageRoot, { token: options.token });
      continue;
    }
    await runPnpmBuild(target.packageRoot);
  }
}
