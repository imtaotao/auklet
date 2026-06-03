import { cleanAukletOutputByConfig } from '#auklet/build/cleanOutput';
import { mergeAukletConfigOverrides } from '#auklet/build/cliOverrides';
import { runTsdown } from '#auklet/build/runTsdown';
import { loadAukletConfig } from '#auklet/configLoader';
import { createBuildEnv, resolveBuildCliArgs } from '#auklet/cli/buildArgs';
import { runBuildCss } from '#auklet/cli/buildCss';
import { AukletEnvContext } from '#auklet/env';
import { createAukletLogger } from '#auklet/logger';
import type { AukletConfig } from '#auklet/types';

export async function runBuildJs(
  args: Array<string>,
  options: {
    config?: AukletConfig;
  } = {},
) {
  const envContext = new AukletEnvContext(process.cwd());
  return envContext.run(async () => {
    const buildArgs = resolveBuildCliArgs(args, envContext);
    const config = mergeAukletConfigOverrides(
      options.config ?? {},
      buildArgs.config,
    );
    const logger = createAukletLogger();
    return logger.group('Build JavaScript', async () => {
      return runTsdown(buildArgs.args, {
        cwd: process.cwd(),
        env: {
          ...envContext.values,
          ...createBuildEnv(config),
        },
      });
    });
  });
}

export async function runBuild(args: Array<string>) {
  const envContext = new AukletEnvContext(process.cwd());
  return envContext.run(async () => {
    const buildArgs = resolveBuildCliArgs(args, envContext);
    const aukletConfig = mergeAukletConfigOverrides(
      await loadAukletConfig(process.cwd()),
      buildArgs.config,
    );
    cleanAukletOutputByConfig(process.cwd(), aukletConfig);

    const jsExitCode = await runBuildJs(buildArgs.args, {
      config: buildArgs.config,
    });
    if (jsExitCode) return jsExitCode;

    createAukletLogger().newline();
    return runBuildCss([], { aukletConfig });
  });
}
