import { createAukletLogger } from '#auklet/logger';
import { loadAukletConfig } from '#auklet/configLoader';
import { resolveBuildCliArgs } from '#auklet/cli/buildArgs';
import { AukletEnvContext } from '#auklet/env';
import { ModuleStyleWatcher } from '#auklet/css/watch/watcher';
import { ModuleStyleBuilder } from '#auklet/css/production/builder';
import { mergeAukletConfigOverrides } from '#auklet/build/cliOverrides';
import { logModuleStyleBuildResult } from '#auklet/css/production/buildReporter';
import type { AukletConfig } from '#auklet/types';

export async function resolveBuildCssConfig(
  args: Array<string>,
  options: {
    aukletConfig?: AukletConfig;
    envContext?: AukletEnvContext;
    packageRoot?: string;
  } = {},
) {
  const packageRoot = options.packageRoot ?? process.cwd();
  const buildArgs = resolveBuildCliArgs(args, options.envContext);
  const shouldWatch =
    buildArgs.args.includes('--watch') || buildArgs.args.includes('-w');

  const aukletConfig =
    options.aukletConfig ??
    mergeAukletConfigOverrides(
      await loadAukletConfig(packageRoot, {
        cacheBust: shouldWatch,
      }),
      buildArgs.config,
    );

  return {
    aukletConfig,
    packageRoot,
    shouldWatch,
  };
}

export async function startBuildCssWatch(
  aukletConfig: AukletConfig,
  options: {
    packageRoot?: string;
  } = {},
) {
  const logger = createAukletLogger();
  return logger.group('Build CSS', async () => {
    const css = logger.child('css');
    const watcher = new ModuleStyleWatcher({
      ...(options.packageRoot ? { packageRoot: options.packageRoot } : {}),
      aukletConfig,
    });
    await watcher.watch();
    css.success('watch mode ready');
    return watcher;
  });
}

export async function runBuildCss(
  args: Array<string>,
  options: {
    aukletConfig?: AukletConfig;
    envContext?: AukletEnvContext;
    packageRoot?: string;
  } = {},
) {
  const packageRoot = options.packageRoot ?? process.cwd();
  const envContext = options.envContext ?? new AukletEnvContext(packageRoot);
  return envContext.run(async () => {
    const logger = createAukletLogger();
    const { aukletConfig, shouldWatch } = await resolveBuildCssConfig(args, {
      ...options,
      envContext,
      packageRoot,
    });

    if (shouldWatch) {
      const watcher = await startBuildCssWatch(aukletConfig, { packageRoot });
      const close = () => {
        watcher
          .close()
          .catch(console.error)
          .finally(() => process.exit(0));
      };
      process.once('SIGINT', close);
      process.once('SIGTERM', close);
      await new Promise(() => {});
      return 0;
    }

    const builder = new ModuleStyleBuilder({ packageRoot, aukletConfig });
    await logger.group('Build CSS', async () => {
      const timer = logger.timer();
      const result = await builder.build();
      logModuleStyleBuildResult(logger.child('css'), result, timer.elapsed());
    });
    return 0;
  });
}
