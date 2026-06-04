import { execa } from 'execa';
import { cleanAukletOutputByConfig } from '#auklet/build/cleanOutput';
import { mergeAukletConfigOverrides } from '#auklet/build/cliOverrides';
import { runTsdown } from '#auklet/build/runTsdown';
import { loadAukletConfig } from '#auklet/configLoader';
import { createBuildEnv } from '#auklet/cli/parse/build';
import { runBuildCss } from '#auklet/cli/buildCss';
import { createAukletLogger } from '#auklet/logger';
import {
  getWorkspacePackageScript,
  resolveWorkspaceScriptTargets,
} from '#auklet/cli/workspaceScripts';
import type {
  BuildCommandOptions,
  BuildJsCommandOptions,
} from '#auklet/cli/parse/build';
import type { AukletEnvContext } from '#auklet/env';

const workspaceBuildEnv = 'AUKLET_WORKSPACE_BUILD';

export async function runBuildJs(options: BuildJsCommandOptions) {
  return options.envContext.run(async () => {
    const logger = createAukletLogger();
    return logger.group('Build JavaScript', async () => {
      return runTsdown(options.passthroughArgs, {
        cwd: options.cwd,
        env: {
          ...options.envContext.values,
          ...createBuildEnv(options.overrides),
        },
      });
    });
  });
}

export async function runBuild(options: BuildCommandOptions) {
  return options.envContext.run(async () => {
    if (options.workspace.filters.length) {
      if (process.env[workspaceBuildEnv]) {
        throw new Error(
          '[build] recursive workspace build detected. Do not run `auk build --workspace` from a workspace package build script.',
        );
      }
      return runWorkspaceBuild(options.workspaceScriptArgs, {
        cwd: options.cwd,
        envContext: options.envContext,
        filters: options.workspace.filters,
        includeDependencies: options.workspace.includeDependencies,
        includePrivate: options.workspace.includePrivate,
      });
    }
    if (options.workspace.includeDependencies) {
      throw new Error('[build] --deps requires --filter or --workspace.');
    }

    return runPackageBuild({
      cwd: options.cwd,
      envContext: options.envContext,
      overrides: options.overrides,
      passthroughArgs: options.passthroughArgs,
    });
  });
}

const runWorkspaceBuild = async (
  args: Array<string>,
  options: {
    cwd: string;
    envContext: AukletEnvContext;
    filters: Array<string>;
    includeDependencies: boolean;
    includePrivate: boolean;
  },
) => {
  const targets = await resolveWorkspaceScriptTargets(
    options.cwd,
    options.filters,
    options.envContext,
    {
      scope: 'build',
      emptyTargetMessage: '[build] no buildable workspace package found.',
      includeDependencies: options.includeDependencies,
      includePrivate: options.includePrivate,
    },
  );
  const logger = createAukletLogger();

  for (const target of targets) {
    if (!getWorkspacePackageScript(target.packageJson, 'build')) {
      throw new Error(
        `[build] package ${target.packageName} has no build script.`,
      );
    }

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

const runPackageBuild = async (options: BuildJsCommandOptions) => {
  const aukletConfig = mergeAukletConfigOverrides(
    await loadAukletConfig(options.cwd),
    options.overrides,
  );
  cleanAukletOutputByConfig(options.cwd, aukletConfig);

  const jsExitCode = await runBuildJs({
    cwd: options.cwd,
    envContext: options.envContext,
    overrides: options.overrides,
    passthroughArgs: options.passthroughArgs,
  });
  if (jsExitCode) return jsExitCode;

  createAukletLogger().newline();
  return runBuildCss({
    cwd: options.cwd,
    envContext: options.envContext,
    overrides: {},
    watch: false,
    aukletConfig,
  });
};
