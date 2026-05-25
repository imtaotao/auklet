import { runPnpmPublish } from '#auklet/publish/api/pnpmApi';
import { createPublishArgs } from '#auklet/publish/api/publishArgs';
import type { PublishOptions, PublishTarget } from '#auklet/publish/types';

export class PnpmPublishApi {
  async publish(target: PublishTarget, options: PublishOptions) {
    await runPnpmPublish(
      target.packageRoot,
      createPublishArgs(target, options),
    );
  }
}
