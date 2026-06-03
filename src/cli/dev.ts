import { execa } from 'execa';
import { createTsdownArgs } from '#auklet/build/runTsdown';
import { createBuildEnv } from '#auklet/cli/parse/build';
import {
  resolveBuildCssConfig,
  startBuildCssWatch,
} from '#auklet/cli/buildCss';
import {
  getWorkspacePackageScript,
  resolveWorkspaceBuildTargets,
} from '#auklet/cli/buildWorkspace';
import type { ModuleStyleWatcher } from '#auklet/css/watch/watcher';
import type { DevCommandOptions } from '#auklet/cli/parse/dev';
import type { AukletEnvContext } from '#auklet/env';
import type { AukletConfig } from '#auklet/types';

type DevTargetHandle =
  | {
      kind: 'script';
      process: ReturnType<typeof execa>;
    }
  | {
      kind: 'auklet-watch';
      process: ReturnType<typeof execa>;
      cssWatcher: ModuleStyleWatcher;
    };

const workspaceDevEnv = 'AUKLET_WORKSPACE_DEV';

export async function runDev(options: DevCommandOptions) {
  return options.envContext.run(async () => {
    if (options.workspace.filters.length) {
      if (process.env[workspaceDevEnv]) {
        throw new Error(
          '[dev] recursive workspace dev detected. Do not run `auk dev --workspace` from a workspace package dev script.',
        );
      }
      return runWorkspaceDev({
        cwd: options.cwd,
        envContext: options.envContext,
        workspaceScriptArgs: options.workspaceScriptArgs,
        filters: options.workspace.filters,
        includeDependencies: options.workspace.includeDependencies,
        includePrivate: options.workspace.includePrivate,
      });
    }
    if (options.workspace.includeDependencies) {
      throw new Error('[dev] --deps requires --filter or --workspace.');
    }
    return runDevWithEnv({
      cwd: options.cwd,
      envContext: options.envContext,
      overrides: options.overrides,
      passthroughArgs: options.passthroughArgs,
    });
  });
}

const runDevWithEnv = async (options: DevTargetOptions) => {
  let closed = false;
  const handle = await startDevTarget(options);

  const close = async () => {
    if (closed) return;
    closed = true;
    await closeDevTargetHandle(handle);
  };

  const closeAndExit = () => {
    close()
      .catch(console.error)
      .finally(() => process.exit(0));
  };

  try {
    process.once('SIGINT', closeAndExit);
    process.once('SIGTERM', closeAndExit);
    return await handle.process.then((result) => result.exitCode ?? 0);
  } finally {
    process.off('SIGINT', closeAndExit);
    process.off('SIGTERM', closeAndExit);
    await close();
  }
};

const runWorkspaceDev = async (options: {
  cwd: string;
  envContext: AukletEnvContext;
  workspaceScriptArgs: Array<string>;
  filters: Array<string>;
  includeDependencies: boolean;
  includePrivate: boolean;
}) => {
  let closed = false;
  const handles: Array<DevTargetHandle> = [];
  const targets = await resolveWorkspaceBuildTargets(
    options.cwd,
    options.filters,
    options.envContext,
    {
      includeDependencies: options.includeDependencies,
      includePrivate: options.includePrivate,
    },
  );

  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.all(handles.map(closeDevTargetHandle));
  };

  const closeAndExit = () => {
    close()
      .catch(console.error)
      .finally(() => process.exit(0));
  };

  try {
    for (const target of targets) {
      const targetEnvContext = options.envContext.createPackageContext(
        target.packageRoot,
      );
      const handle = await targetEnvContext.run(() =>
        startWorkspaceDevTarget({
          workspaceScriptArgs: options.workspaceScriptArgs,
          cwd: target.packageRoot,
          envContext: targetEnvContext,
          packageJson: target.packageJson,
          packageName: target.packageName,
        }),
      );
      handles.push(handle);
    }

    process.once('SIGINT', closeAndExit);
    process.once('SIGTERM', closeAndExit);
    const processes = handles.map((handle) => handle.process);
    const result = await Promise.race(processes);
    return result.exitCode ?? 0;
  } finally {
    process.off('SIGINT', closeAndExit);
    process.off('SIGTERM', closeAndExit);
    await close();
  }
};

type WorkspaceDevTargetOptions = {
  cwd: string;
  envContext: AukletEnvContext;
  packageJson: Parameters<typeof getWorkspacePackageScript>[0];
  packageName: string;
  workspaceScriptArgs: Array<string>;
};

type DevTargetOptions = {
  cwd: string;
  envContext: AukletEnvContext;
  overrides: AukletConfig;
  passthroughArgs: Array<string>;
};

const startWorkspaceDevTarget = async (options: WorkspaceDevTargetOptions) => {
  if (!getWorkspacePackageScript(options.packageJson, 'dev')) {
    throw new Error(`[dev] package ${options.packageName} has no dev script.`);
  }

  const handle = {
    kind: 'script',
    process: execa(
      'pnpm',
      createWorkspaceDevArgs(options.workspaceScriptArgs),
      {
        cwd: options.cwd,
        env: {
          ...options.envContext.values,
          [workspaceDevEnv]: '1',
        },
        stdio: 'inherit',
        reject: false,
      },
    ),
  } satisfies DevTargetHandle;
  return handle;
};

const startDevTarget = async (options: DevTargetOptions) => {
  const { aukletConfig } = await resolveBuildCssConfig({
    configOverrides: options.overrides,
    packageRoot: options.cwd,
    watch: true,
  });
  const cssWatcher = await startBuildCssWatch(aukletConfig, {
    packageRoot: options.cwd,
  });
  const jsProcess = execa(
    process.execPath,
    createTsdownArgs([...options.passthroughArgs, '--watch']),
    {
      cwd: options.cwd,
      env: {
        ...options.envContext.values,
        ...createBuildEnv(options.overrides),
      },
      stdio: 'inherit',
      reject: false,
    },
  );

  const handle = {
    kind: 'auklet-watch',
    process: jsProcess,
    cssWatcher,
  } satisfies DevTargetHandle;
  return handle;
};

const createWorkspaceDevArgs = (args: Array<string>) => {
  return args.length ? ['run', 'dev', '--', ...args] : ['run', 'dev'];
};

const closeDevTargetHandle = async (handle: DevTargetHandle) => {
  switch (handle.kind) {
    case 'script':
      handle.process.kill('SIGTERM');
      return;
    case 'auklet-watch':
      handle.process.kill('SIGTERM');
      await handle.cssWatcher.close();
      return;
  }
};
