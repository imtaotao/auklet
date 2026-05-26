import { PnpmPublishApi } from '#auklet/publish/api/pnpmPublishApi';
import { runPnpmWhoami } from '#auklet/publish/api/pnpmApi';
import { PublishTargetError } from '#auklet/publish/runner/publishTargetError';
import type { PublishOptions, PublishPlan } from '#auklet/publish/types';

export class PublishPreflight {
  private readonly pnpm = new PnpmPublishApi();

  constructor(private readonly options: PublishOptions) {}

  async run(plan: PublishPlan) {
    await this.verifyPnpmPublishDryRun(plan);
  }

  async verifyAuthentication(plan: PublishPlan) {
    if (plan.dryRun) return;
    await runPnpmWhoami(plan.root);
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
        throw new PublishTargetError(target, 'preflight', error, []);
      }
    }
  }
}
