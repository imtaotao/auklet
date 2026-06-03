import { isString } from 'aidly';
import { runPnpmBuild } from '#auklet/publish/api/pnpmApi';
import { createPublishTargetEnv } from '#auklet/publish/publishEnv';
import type { AukletLogger } from '#auklet/logger';
import type {
  PublishTarget,
  PublishOptions,
  PublishRuntime,
} from '#auklet/publish/types';

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
  options: Pick<PublishOptions, 'token'>,
  runtime: PublishRuntime,
) {
  for (const target of targets) {
    logger.step('build ', logger.package(target.packageName));
    const { env } = createPublishTargetEnv(options, runtime, target);
    if (env) {
      await runPnpmBuild(target.packageRoot, { env });
      continue;
    }
    await runPnpmBuild(target.packageRoot);
  }
}
