import { createAukletLogger } from '#auklet/logger';
import { loadAukletConfig } from '#auklet/configLoader';
import { resolveBuildCliArgs } from '#auklet/cli/buildArgs';
import { ModuleStyleWatcher } from '#auklet/css/watch/watcher';
import { ModuleStyleBuilder } from '#auklet/css/production/builder';
import { mergeAukletConfigOverrides } from '#auklet/build/cliOverrides';
import { logModuleStyleBuildResult } from '#auklet/css/production/buildReporter';
import type { AukletConfig } from '#auklet/types';

export async function resolveBuildCssConfig(
  args: Array<string>,
  options: {
    aukletConfig?: AukletConfig;
  } = {},
) {
  const buildArgs = resolveBuildCliArgs(args);
  const shouldWatch =
    buildArgs.args.includes('--watch') || buildArgs.args.includes('-w');

  const aukletConfig =
    options.aukletConfig ??
    mergeAukletConfigOverrides(
      await loadAukletConfig(process.cwd(), {
        cacheBust: shouldWatch,
      }),
      buildArgs.config,
    );

  return {
    aukletConfig,
    shouldWatch,
  };
}

export async function startBuildCssWatch(aukletConfig: AukletConfig) {
  const logger = createAukletLogger();
  return logger.group('Build CSS', async () => {
    const css = logger.child('css');
    const watcher = new ModuleStyleWatcher({ aukletConfig });
    await watcher.watch();
    css.success('watch mode ready');
    return watcher;
  });
}

export async function runBuildCss(
  args: Array<string>,
  options: {
    aukletConfig?: AukletConfig;
  } = {},
) {
  const logger = createAukletLogger();
  const { aukletConfig, shouldWatch } = await resolveBuildCssConfig(
    args,
    options,
  );

  if (shouldWatch) {
    const watcher = await startBuildCssWatch(aukletConfig);
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

  const builder = new ModuleStyleBuilder({ aukletConfig });
  await logger.group('Build CSS', async () => {
    const timer = logger.timer();
    const result = await builder.build();
    logModuleStyleBuildResult(logger.child('css'), result, timer.elapsed());
  });
  return 0;
}
