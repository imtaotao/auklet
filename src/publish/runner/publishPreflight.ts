import { isPlainObject, isString } from 'aidly';
import { PnpmPublishApi } from '#auklet/publish/api/pnpmPublishApi';
import { runPnpmWhoami } from '#auklet/publish/api/pnpmApi';
import { logAuthenticationError } from '#auklet/publish/runner/packagePublisher';
import { PublishTargetError } from '#auklet/publish/runner/publishTargetError';
import type { AukletLogger } from '#auklet/logger';
import type { PublishOptions, PublishPlan } from '#auklet/publish/types';

export class PublishPreflight {
  private readonly pnpm = new PnpmPublishApi();

  constructor(
    private readonly options: PublishOptions,
    private readonly logger: AukletLogger,
  ) {}

  async run(plan: PublishPlan) {
    await this.verifyPnpmPublishDryRun(plan);
  }

  async verifyAuthentication(plan: PublishPlan) {
    if (plan.dryRun) return;

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
}

const getPublishRegistry = (publishConfig: unknown) => {
  if (!isPlainObject(publishConfig)) return undefined;
  const registry = Reflect.get(publishConfig, 'registry');
  return isString(registry) && registry.length > 0 ? registry : undefined;
};
