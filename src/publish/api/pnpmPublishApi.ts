import { runPnpmPublish } from '#auklet/publish/api/pnpmApi';
import { createPublishArgs } from '#auklet/publish/api/publishArgs';
import { createPublishTargetEnv } from '#auklet/publish/publishEnv';
import type {
  PublishOptions,
  PublishRuntime,
  PublishTarget,
} from '#auklet/publish/types';

export class PnpmPublishApi {
  async publish(
    target: PublishTarget,
    options: PublishOptions,
    runtime: PublishRuntime,
  ) {
    const args = createPublishArgs(target, options);
    const { env } = createPublishTargetEnv(options, runtime, target);
    if (env) {
      await runPnpmPublish(target.packageRoot, args, { env });
      return;
    }
    await runPnpmPublish(target.packageRoot, args);
  }
}
