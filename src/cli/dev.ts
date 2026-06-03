import { execa } from 'execa';
import { createTsdownArgs } from '#auklet/build/runTsdown';
import {
  createBuildEnv,
  resolveBuildCliArgs,
  resolveBuildFilterArgs,
} from '#auklet/cli/buildArgs';
import { AukletEnvContext } from '#auklet/env';
import {
  resolveBuildCssConfig,
  startBuildCssWatch,
} from '#auklet/cli/buildCss';
import {
  getWorkspacePackageScript,
  resolveWorkspaceBuildTargets,
} from '#auklet/cli/buildWorkspace';
import type { ModuleStyleWatcher } from '#auklet/css/watch/watcher';

type DevTargetHandle =
  | {
      kind: 'script';
      process: ReturnType<typeof execa>;
    }
  | {
      kind: 'css-only';
      cssWatcher: ModuleStyleWatcher;
    }
  | {
      kind: 'auklet-watch';
      process: ReturnType<typeof execa>;
      cssWatcher: ModuleStyleWatcher;
    };

const workspaceDevEnv = 'AUKLET_WORKSPACE_DEV';

export async function runDev(args: Array<string>) {
  const cwd = process.cwd();
  const envContext = new AukletEnvContext(cwd);
  return envContext.run(async () => {
    const workspaceArgs = resolveBuildFilterArgs(args, envContext);
    if (workspaceArgs.filters.length) {
      if (process.env[workspaceDevEnv]) {
        throw new Error(
          '[dev] recursive workspace dev detected. Do not run `auk dev --workspace` from a workspace package dev script.',
        );
      }
      return runWorkspaceDev(workspaceArgs.args, workspaceArgs.filters, {
        cwd,
        envContext,
      });
    }
    return runDevWithEnv(args, {
      cwd,
      envContext,
    });
  });
}

const runDevWithEnv = async (
  args: Array<string>,
  options: {
    cwd: string;
    envContext: AukletEnvContext;
  },
) => {
  let closed = false;
  const handle = await startDevTarget(args, options);

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

const runWorkspaceDev = async (
  args: Array<string>,
  filters: Array<string>,
  options: {
    cwd: string;
    envContext: AukletEnvContext;
  },
) => {
  let closed = false;
  const handles: Array<DevTargetHandle> = [];
  const targets = await resolveWorkspaceBuildTargets(
    options.cwd,
    filters,
    options.envContext,
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
      handles.push(
        await targetEnvContext.run(async () =>
          startWorkspaceDevTarget(args, {
            cwd: target.packageRoot,
            envContext: targetEnvContext,
            packageJson: target.packageJson,
          }),
        ),
      );
    }

    process.once('SIGINT', closeAndExit);
    process.once('SIGTERM', closeAndExit);
    const processes = handles
      .map(getDevTargetProcess)
      .filter((process): process is ReturnType<typeof execa> =>
        Boolean(process),
      );
    if (!processes.length) {
      await new Promise(() => {});
      return 0;
    }
    const result = await Promise.race(processes);
    return result.exitCode ?? 0;
  } finally {
    process.off('SIGINT', closeAndExit);
    process.off('SIGTERM', closeAndExit);
    await close();
  }
};

const startWorkspaceDevTarget = async (
  args: Array<string>,
  options: {
    cwd: string;
    envContext: AukletEnvContext;
    packageJson: Parameters<typeof getWorkspacePackageScript>[0];
  },
) => {
  if (getWorkspacePackageScript(options.packageJson, 'dev')) {
    const handle = {
      kind: 'script',
      process: execa('pnpm', createWorkspaceDevArgs(args), {
        cwd: options.cwd,
        env: {
          ...options.envContext.values,
          [workspaceDevEnv]: '1',
        },
        stdio: 'inherit',
        reject: false,
      }),
    } satisfies DevTargetHandle;
    return handle;
  }

  const buildScript = getWorkspacePackageScript(options.packageJson, 'build');
  if (isAukletBuildCssScript(buildScript)) {
    const { aukletConfig } = await resolveBuildCssConfig(['--watch', ...args], {
      envContext: options.envContext,
      packageRoot: options.cwd,
    });
    const handle = {
      kind: 'css-only',
      cssWatcher: await startBuildCssWatch(aukletConfig, {
        packageRoot: options.cwd,
      }),
    } satisfies DevTargetHandle;
    return handle;
  }

  return startDevTarget(args, options);
};

const startDevTarget = async (
  args: Array<string>,
  options: {
    cwd: string;
    envContext: AukletEnvContext;
  },
) => {
  const buildArgs = resolveBuildCliArgs(args, options.envContext);
  const { aukletConfig } = await resolveBuildCssConfig(['--watch', ...args], {
    envContext: options.envContext,
    packageRoot: options.cwd,
  });
  const cssWatcher = await startBuildCssWatch(aukletConfig, {
    packageRoot: options.cwd,
  });
  const jsProcess = execa(
    process.execPath,
    createTsdownArgs([...buildArgs.args, '--watch']),
    {
      cwd: options.cwd,
      env: {
        ...options.envContext.values,
        ...createBuildEnv(buildArgs.config),
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
    case 'css-only':
      await handle.cssWatcher.close();
      return;
    case 'auklet-watch':
      handle.process.kill('SIGTERM');
      await handle.cssWatcher.close();
      return;
  }
};

const getDevTargetProcess = (handle: DevTargetHandle) => {
  return handle.kind === 'css-only' ? null : handle.process;
};

const isAukletBuildCssScript = (script: string | null) => {
  if (!script) return false;
  const tokens = script.trim().split(/\s+/);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    if (token === 'cross-env') continue;
    if (isEnvironmentAssignmentToken(token)) continue;
    return (
      (token === 'auk' || token === 'auklet') &&
      tokens[index + 1] === 'build-css'
    );
  }
  return false;
};

const isEnvironmentAssignmentToken = (token: string) => {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
};
