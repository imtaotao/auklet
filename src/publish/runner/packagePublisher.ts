import { PnpmPublishApi } from '#auklet/publish/api/pnpmPublishApi';
import { NpmPublishAuthenticationError } from '#auklet/publish/api/pnpmApi';
import { PublishTargetError } from '#auklet/publish/runner/publishTargetError';
import type { AukletLogger } from '#auklet/logger';
import type {
  PublishOptions,
  PublishPlan,
  PublishTarget,
} from '#auklet/publish/types';

export class PackagePublisher {
  private readonly pnpm = new PnpmPublishApi();

  constructor(
    private readonly options: PublishOptions,
    private readonly logger: AukletLogger,
  ) {}

  async run(plan: PublishPlan) {
    const publishedTargets: Array<PublishTarget> = [];

    for (const target of plan.targets) {
      try {
        await this.pnpm.publish(target, this.options);
        publishedTargets.push(target);
      } catch (error) {
        logAuthenticationError(this.logger, error);
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

export function logAuthenticationError(logger: AukletLogger, error: unknown) {
  if (!(error instanceof NpmPublishAuthenticationError)) return;
  logger.error('npm publish requires additional authentication.');
  logger.error('If publish 2FA is enabled, retry with `--otp <code>`.');
  logger.error('For CI, use an npm automation token.');
}
