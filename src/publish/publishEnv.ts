import type { AukletEnvContext } from '#auklet/env';
import type { DeferredCliValue } from '#auklet/cli/values';
import type {
  PublishOptions,
  PublishRuntime,
  PublishTarget,
} from '#auklet/publish/types';

export type PublishPnpmEnv = {
  env?: Record<string, string | undefined>;
  token?: string;
};

export function createPublishRootEnv(
  options: Pick<PublishOptions, 'token'>,
  runtime: PublishRuntime,
) {
  return createPublishPnpmEnv(options.token, runtime.envContext);
}

export function createPublishTargetEnv(
  options: Pick<PublishOptions, 'token'>,
  runtime: PublishRuntime,
  target: Pick<PublishTarget, 'packageRoot'>,
) {
  const envContext = runtime.envContext.createPackageContext(
    target.packageRoot,
  );
  return createPublishPnpmEnv(options.token, envContext);
}

const createPublishPnpmEnv = (
  token: DeferredCliValue | undefined,
  envContext: AukletEnvContext,
) => {
  const resolvedToken = token?.resolve(envContext);
  const resolvedEnv = resolvedToken
    ? {
        ...envContext.values,
        NODE_AUTH_TOKEN: resolvedToken,
        NPM_TOKEN: resolvedToken,
      }
    : envContext.values;

  return {
    env: Object.keys(resolvedEnv).length ? resolvedEnv : undefined,
    token: resolvedToken,
  } satisfies PublishPnpmEnv;
};
