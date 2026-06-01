import { PnpmPublishApi } from '#auklet/publish/api/pnpmPublishApi';
import {
  hasPublishedPackageVersion,
  NpmPackageVersionExistsError,
  runPnpmWhoami,
} from '#auklet/publish/api/pnpmApi';
import { getPublishRegistry } from '#auklet/publish/api/registry';
import { logAuthenticationError } from '#auklet/publish/runner/packagePublisher';
import { PublishTargetError } from '#auklet/publish/runner/publishTargetError';
import type { AukletLogger } from '#auklet/logger';
import type {
  PublishOptions,
  PublishPlan,
  PublishTarget,
} from '#auklet/publish/types';

export class PublishPreflight {
  private readonly pnpm = new PnpmPublishApi();

  constructor(
    private readonly options: PublishOptions,
    private readonly logger: AukletLogger,
  ) {}

  async run(plan: PublishPlan) {
    await this.verifyPnpmPublishDryRun(plan);
  }

  async verifyBeforeBuild(plan: PublishPlan) {
    if (plan.dryRun) return;
    await this.verifyAuthentication(plan);
    await this.verifyPackageVersions(plan);
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
        await this.pnpm.publish(target, options);
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
        { registry },
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
