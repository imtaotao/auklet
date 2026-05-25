import { PnpmPublishApi } from '#auklet/publish/api/pnpmPublishApi';
import { PublishTargetError } from '#auklet/publish/runner/publishTargetError';
import type {
  PublishOptions,
  PublishPlan,
  PublishTarget,
} from '#auklet/publish/types';

export class PackagePublisher {
  private readonly pnpm = new PnpmPublishApi();

  constructor(private readonly options: PublishOptions) {}

  async run(plan: PublishPlan) {
    const publishedTargets: Array<PublishTarget> = [];

    for (const target of plan.targets) {
      try {
        await this.pnpm.publish(target, this.options);
        publishedTargets.push(target);
      } catch (error) {
        throw new PublishTargetError(
          target,
          'publish',
          error,
          publishedTargets,
        );
      }
    }
  }
}
