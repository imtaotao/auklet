import { retry } from 'aidly';
import { getPublishRegistry } from '#auklet/publish/api/registry';
import {
  hasPublishedPackageVersion,
  runPnpmWhoami,
} from '#auklet/publish/api/pnpmApi';
import type { PublishPlan } from '#auklet/publish/types';

const registryCheckTimeout = 5_000;
const registryCheckRetryTimes = 2;

export type PublishRegistryCheckStatus = 'success' | 'error';

export type PublishRegistryCheck = {
  packageName: string;
  registry: string;
  auth: PublishRegistryCheckStatus;
  version: PublishRegistryCheckStatus;
  reason: string | null;
};

export type PublishRegistryRetryInfo = {
  packageName: string;
  registry: string;
  check: 'auth' | 'version';
  attempt: number;
  maxAttempts: number;
  error: Error;
};

export type PublishRegistryCheckInfo = Pick<
  PublishRegistryRetryInfo,
  'packageName' | 'registry' | 'check'
>;

export type InspectPublishRegistryOptions = {
  onCheck?: (info: PublishRegistryCheckInfo) => void;
  onRetry?: (info: PublishRegistryRetryInfo) => void;
};

export async function inspectPublishRegistry(
  plan: PublishPlan,
  options: InspectPublishRegistryOptions = {},
) {
  const authResults = new Map<string, Error | null>();
  const checks: Array<PublishRegistryCheck> = [];

  for (const target of plan.targets) {
    const registry = getPublishRegistry(target.packageJson.publishConfig);
    const registryLabel = registry ?? 'default';
    const authKey = `${target.packageRoot}\n${registryLabel}`;

    if (!authResults.has(authKey)) {
      await checkAuth(
        authResults,
        authKey,
        target.packageRoot,
        target.packageName,
        registry,
        options,
      );
    }
    const authError = authResults.get(authKey) ?? null;
    const versionError = await checkVersion(
      target.packageRoot,
      target.packageName,
      target.publishVersion,
      registry,
      options,
    );

    checks.push({
      packageName: target.packageName,
      registry: registryLabel,
      auth: authError ? 'error' : 'success',
      version: versionError ? 'error' : 'success',
      reason: getReason(authError, versionError),
    });
  }

  return checks;
}

const checkAuth = async (
  authResults: Map<string, Error | null>,
  authKey: string,
  packageRoot: string,
  packageName: string,
  registry: string | undefined,
  options: InspectPublishRegistryOptions,
) => {
  try {
    options.onCheck?.({
      packageName,
      registry: registry ?? 'default',
      check: 'auth',
    });
    await retryWithLog(
      () =>
        runPnpmWhoami(packageRoot, {
          packageName,
          registry,
          timeout: registryCheckTimeout,
        }),
      {
        check: 'auth',
        packageName,
        registry,
        onRetry: options.onRetry,
      },
    );
    authResults.set(authKey, null);
    return null;
  } catch (error) {
    const authError = toError(error);
    authResults.set(authKey, authError);
    return authError;
  }
};

const checkVersion = async (
  packageRoot: string,
  packageName: string,
  version: string,
  registry: string | undefined,
  options: InspectPublishRegistryOptions,
) => {
  try {
    options.onCheck?.({
      packageName,
      registry: registry ?? 'default',
      check: 'version',
    });
    const exists = await retryWithLog(
      () =>
        hasPublishedPackageVersion(packageRoot, packageName, version, {
          registry,
          timeout: registryCheckTimeout,
        }),
      {
        check: 'version',
        packageName,
        registry,
        onRetry: options.onRetry,
      },
    );
    return exists
      ? new Error(`version already exists: ${packageName}@${version}`)
      : null;
  } catch (error) {
    return toError(error);
  }
};

const getReason = (authError: Error | null, versionError: Error | null) => {
  return authError?.message ?? versionError?.message ?? null;
};

const toError = (error: unknown) => {
  return error instanceof Error ? error : new Error(String(error));
};

const retryWithLog = <T>(
  fn: () => Promise<T>,
  options: {
    packageName: string;
    registry: string | undefined;
    check: PublishRegistryRetryInfo['check'];
    onRetry?: (info: PublishRegistryRetryInfo) => void;
  },
) => {
  let attempt = 0;
  let previousError: Error | null = null;
  return retry(async () => {
    attempt += 1;
    if (attempt > 1) {
      options.onRetry?.({
        packageName: options.packageName,
        registry: options.registry ?? 'default',
        check: options.check,
        attempt: attempt - 1,
        maxAttempts: registryCheckRetryTimes,
        error: previousError ?? new Error('publish registry check failed.'),
      });
    }
    try {
      return await fn();
    } catch (error) {
      previousError = toError(error);
      throw error;
    }
  }, registryCheckRetryTimes);
};
