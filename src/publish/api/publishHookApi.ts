import { execa } from 'execa';
import type {
  HookStatus,
  HookResult,
  PublishPackageConfig,
  PublishPlan,
  PublishTarget,
} from '#auklet/publish/types';

type RunPublishHookOptions = {
  status: HookStatus;
  plan: PublishPlan;
  result?: HookResult;
  failedTarget?: PublishTarget;
  error?: unknown;
};

export async function runPublishHook(options: RunPublishHookOptions) {
  const hook = getHook(options.plan.config, options.status);
  if (!hook) return;

  const commands = Array.isArray(hook) ? hook : [hook];
  for (const command of commands) {
    const result = await execa(command, {
      cwd: options.plan.root,
      shell: true,
      stdio: 'inherit',
      reject: false,
      env: createHookEnv(options),
    });
    if (result.exitCode) {
      throw new Error(
        `[auklet:publish] publish ${options.status} hook failed: ${command}`,
      );
    }
  }
}

const getHook = (config: PublishPackageConfig, status: HookStatus) => {
  if (status === 'beforeBuild') return config.beforeBuild;
  if (status === 'afterBuild') return config.afterBuild;
  if (status === 'beforePublish') return config.beforePublish;
  return config.afterPublish;
};

const createHookEnv = (options: RunPublishHookOptions) => {
  const env: Record<string, string> = {
    AUKLET_PUBLISH_STATUS: options.status,
    AUKLET_PUBLISH_RESULT: options.result ?? '',
    AUKLET_PUBLISH_VERSION: options.plan.version,
    AUKLET_PUBLISH_DRY_RUN: options.plan.dryRun ? 'true' : 'false',
    AUKLET_PUBLISH_ROOT: options.plan.root,
    AUKLET_PUBLISH_PACKAGES: options.plan.targets
      .map((target) => target.packageName)
      .join(','),
  };

  if (options.failedTarget) {
    env.AUKLET_PUBLISH_FAILED_PACKAGE = options.failedTarget.packageName;
  }
  if (options.error) {
    env.AUKLET_PUBLISH_ERROR = getErrorMessage(options.error);
  }

  return env;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};
