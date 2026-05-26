import { execa } from 'execa';
import { createTsdownArgs } from '#auklet/build/runTsdown';
import { createBuildEnv, resolveBuildCliArgs } from '#auklet/cli/buildArgs';
import {
  resolveBuildCssConfig,
  startBuildCssWatch,
} from '#auklet/cli/buildCss';

export async function runDev(args: Array<string>) {
  let closed = false;
  let jsProcess: ReturnType<typeof execa> | null = null;
  const buildArgs = resolveBuildCliArgs(args);
  const { aukletConfig } = await resolveBuildCssConfig(['--watch', ...args]);
  const cssWatcher = await startBuildCssWatch(aukletConfig);

  const close = async () => {
    if (closed) return;
    closed = true;
    jsProcess?.kill('SIGTERM');
    await cssWatcher.close();
  };

  const closeAndExit = () => {
    close()
      .catch(console.error)
      .finally(() => process.exit(0));
  };

  try {
    jsProcess = execa(
      process.execPath,
      createTsdownArgs([...buildArgs.args, '--watch']),
      {
        cwd: process.cwd(),
        env: createBuildEnv(buildArgs.config),
        stdio: 'inherit',
        reject: false,
      },
    );
    process.once('SIGINT', closeAndExit);
    process.once('SIGTERM', closeAndExit);
    return await jsProcess.then((result) => result.exitCode ?? 0);
  } finally {
    process.off('SIGINT', closeAndExit);
    process.off('SIGTERM', closeAndExit);
    await close();
  }
}
