import { execa } from 'execa';
import { cleanAukletOutputByConfig } from '#auklet/build/cleanOutput';
import { mergeAukletConfigOverrides } from '#auklet/build/cliOverrides';
import { runTsdown } from '#auklet/build/runTsdown';
import { loadAukletConfig } from '#auklet/configLoader';
import {
  createBuildEnv,
  resolveBuildCliArgs,
  resolveBuildFilterArgs,
} from '#auklet/cli/buildArgs';
import { runBuildCss } from '#auklet/cli/buildCss';
import { AukletEnvContext } from '#auklet/env';
import { createAukletLogger } from '#auklet/logger';
import { resolveWorkspaceBuildTargets } from '#auklet/cli/buildWorkspace';
import type { AukletConfig } from '#auklet/types';

const workspaceBuildEnv = 'AUKLET_WORKSPACE_BUILD';

export async function runBuildJs(
  args: Array<string>,
  options: {
    config?: AukletConfig;
    cwd?: string;
    envContext?: AukletEnvContext;
  } = {},
) {
  const cwd = options.cwd ?? process.cwd();
  const envContext = options.envContext ?? new AukletEnvContext(cwd);
  return envContext.run(async () => {
    const buildArgs = resolveBuildCliArgs(args, envContext);
    const config = mergeAukletConfigOverrides(
      options.config ?? {},
      buildArgs.config,
    );
    const logger = createAukletLogger();
    return logger.group('Build JavaScript', async () => {
      return runTsdown(buildArgs.args, {
        cwd,
        env: {
          ...envContext.values,
          ...createBuildEnv(config),
        },
      });
    });
  });
}

export async function runBuild(args: Array<string>) {
  const cwd = process.cwd();
  const envContext = new AukletEnvContext(cwd);
  return envContext.run(async () => {
    const workspaceArgs = resolveBuildFilterArgs(args, envContext);
    if (workspaceArgs.filters.length) {
      if (process.env[workspaceBuildEnv]) {
        throw new Error(
          '[build] recursive workspace build detected. Do not run `auk build --workspace` from a workspace package build script.',
        );
      }
      return runWorkspaceBuild(workspaceArgs.args, workspaceArgs.filters, {
        cwd,
        envContext,
      });
    }

    return runPackageBuild(args, {
      cwd,
      envContext,
    });
  });
}

const runWorkspaceBuild = async (
  args: Array<string>,
  filters: Array<string>,
  options: {
    cwd: string;
    envContext: AukletEnvContext;
  },
) => {
  const targets = await resolveWorkspaceBuildTargets(
    options.cwd,
    filters,
    options.envContext,
  );
  const logger = createAukletLogger();

  for (const target of targets) {
    const targetEnvContext = options.envContext.createPackageContext(
      target.packageRoot,
    );
    const exitCode = await targetEnvContext.run(async () => {
      return logger.group(`Build ${target.packageName}`, async () => {
        const result = await execa('pnpm', createWorkspaceBuildArgs(args), {
          cwd: target.packageRoot,
          env: {
            ...targetEnvContext.values,
            [workspaceBuildEnv]: '1',
          },
          stdio: 'inherit',
          reject: false,
        });
        return result.exitCode ?? 0;
      });
    });
    if (exitCode) return exitCode;
    logger.newline();
  }

  return 0;
};

const createWorkspaceBuildArgs = (args: Array<string>) => {
  return args.length ? ['run', 'build', '--', ...args] : ['run', 'build'];
};

const runPackageBuild = async (
  args: Array<string>,
  options: {
    cwd: string;
    envContext: AukletEnvContext;
  },
) => {
  const buildArgs = resolveBuildCliArgs(args, options.envContext);
  const aukletConfig = mergeAukletConfigOverrides(
    await loadAukletConfig(options.cwd),
    buildArgs.config,
  );
  cleanAukletOutputByConfig(options.cwd, aukletConfig);

  const jsExitCode = await runBuildJs(buildArgs.args, {
    cwd: options.cwd,
    config: buildArgs.config,
    envContext: options.envContext,
  });
  if (jsExitCode) return jsExitCode;

  createAukletLogger().newline();
  return runBuildCss([], {
    aukletConfig,
    packageRoot: options.cwd,
    envContext: options.envContext,
  });
};
