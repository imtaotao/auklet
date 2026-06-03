import { PnpmPublishApi } from '#auklet/publish/api/pnpmPublishApi';
import {
  runPnpmWhoami,
  hasPublishedPackageVersion,
  NpmPackageVersionExistsError,
} from '#auklet/publish/api/pnpmApi';
import {
  findNpmrcFiles,
  findNpmrcWithAuthToken,
  toNpmrcRegistryKey,
  validateNpmrcAuthEnv,
} from '#auklet/publish/api/npmrc';
import { getPublishRegistry } from '#auklet/publish/api/registry';
import { createPublishTargetEnv } from '#auklet/publish/publishEnv';
import { logAuthenticationError } from '#auklet/publish/runner/packagePublisher';
import { PublishTargetError } from '#auklet/publish/runner/publishTargetError';
import type { AukletLogger } from '#auklet/logger';
import type {
  PublishOptions,
  PublishPlan,
  PublishRuntime,
  PublishTarget,
} from '#auklet/publish/types';

export class PublishPreflight {
  private readonly pnpm = new PnpmPublishApi();

  constructor(
    private readonly options: PublishOptions,
    private readonly runtime: PublishRuntime,
    private readonly logger: AukletLogger,
  ) {}

  async run(plan: PublishPlan) {
    await this.verifyPnpmPublishDryRun(plan);
  }

  async verifyBeforeBuild(plan: PublishPlan) {
    this.verifyNpmrcAuthEnv(plan);
    this.verifyTokenConfig(plan);
    if (plan.dryRun) return;
    await this.verifyAuthentication(plan);
    await this.verifyPackageVersions(plan);
  }

  private verifyNpmrcAuthEnv(plan: PublishPlan) {
    for (const target of plan.targets) {
      const { env } = createPublishTargetEnv(
        this.options,
        this.runtime,
        target,
      );
      validateNpmrcAuthEnv(target.packageRoot, plan.root, {
        env,
      });
    }
  }

  private verifyTokenConfig(plan: PublishPlan) {
    if (!this.options.token) return;

    for (const target of plan.targets) {
      const registry = getPublishRegistry(target.packageJson.publishConfig);
      const npmrc = findNpmrcWithAuthToken(
        target.packageRoot,
        plan.root,
        registry,
      );
      if (npmrc) continue;

      throw new PublishTargetError(
        target,
        'preflight',
        new Error(createMissingNpmrcAuthMessage(target, plan.root, registry)),
        [],
      );
    }
  }

  private async verifyAuthentication(plan: PublishPlan) {
    const checked = new Set<string>();
    for (const target of plan.targets) {
      const registry = getPublishRegistry(target.packageJson.publishConfig);
      const key = `${target.packageRoot}\n${registry ?? ''}`;
      if (checked.has(key)) continue;

      await runPnpmWhoami(target.packageRoot, {
        packageName: target.packageName,
        registry,
        ...createPublishTargetEnv(this.options, this.runtime, target),
      });
      checked.add(key);
    }
  }

  private async verifyPnpmPublishDryRun(plan: PublishPlan) {
    const options = {
      ...this.options,
      dryRun: true,
    };

    for (const target of plan.targets) {
      try {
        await this.pnpm.publish(target, options, this.runtime);
      } catch (error) {
        logAuthenticationError(this.logger, error);
        throw new PublishTargetError(target, 'preflight', error, []);
      }
    }
  }

  private async verifyPackageVersions(plan: PublishPlan) {
    for (const target of plan.targets) {
      const registry = getPublishRegistry(target.packageJson.publishConfig);
      const exists = await hasPublishedPackageVersion(
        target.packageRoot,
        target.packageName,
        target.publishVersion,
        {
          registry,
          ...createPublishTargetEnv(this.options, this.runtime, target),
        },
      );
      if (!exists) continue;

      this.logExistingVersion(target, registry);
      throw new PublishTargetError(
        target,
        'preflight',
        new NpmPackageVersionExistsError(
          target.packageName,
          target.publishVersion,
          registry,
        ),
        [],
      );
    }
  }

  private logExistingVersion(target: PublishTarget, registry?: string) {
    this.logger.error(
      'package version already exists: ',
      this.logger.package(target.packageName),
      '@',
      this.logger.version(target.publishVersion),
    );
    if (registry) {
      this.logger.error('registry: ', this.logger.url(registry));
    }
  }
}

function createMissingNpmrcAuthMessage(
  target: PublishTarget,
  root: string,
  registry?: string,
) {
  const npmrcFiles = findNpmrcFiles(target.packageRoot, root);
  const authTarget = registry
    ? `${toNpmrcRegistryKey(registry)}:_authToken`
    : '_authToken';

  const registryHint = registry
    ? `[publish] ${target.packageName} uses publishConfig.registry: ${registry}.\n`
    : '';

  const location = npmrcFiles.length
    ? 'found npmrc files, but none declares'
    : 'could not find an npmrc file declaring';

  return (
    `[publish] --token requires npmrc auth config for ${target.packageName}.\n` +
    registryHint +
    `[publish] ${location} ${authTarget}.\n` +
    '[publish] Add an npmrc entry such as:\n' +
    `  ${authTarget}=\${NODE_AUTH_TOKEN}`
  );
}
