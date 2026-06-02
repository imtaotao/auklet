import { runPnpmPublish } from '#auklet/publish/api/pnpmApi';
import { createPublishArgs } from '#auklet/publish/api/publishArgs';
import type { PublishOptions, PublishTarget } from '#auklet/publish/types';

export class PnpmPublishApi {
  async publish(target: PublishTarget, options: PublishOptions) {
    const args = createPublishArgs(target, options);
    if (options.token) {
      await runPnpmPublish(target.packageRoot, args, { token: options.token });
      return;
    }
    await runPnpmPublish(target.packageRoot, args);
  }
}
