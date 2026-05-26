import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cac } from 'cac';
import { execa } from 'execa';
import { cleanAukletOutputByConfig } from '#auklet/build/cleanOutput';
import { createTsdownArgs, runTsdown } from '#auklet/build/runTsdown';
import { createAukletLogger } from '#auklet/logger';
import { loadAukletConfig } from '#auklet/configLoader';
import { ModuleStyleWatcher } from '#auklet/css/watch/watcher';
import { runOwnerCli, runPublishCli } from '#auklet/publish/cli';
import { ModuleStyleBuilder } from '#auklet/css/production/builder';
import { logModuleStyleBuildResult } from '#auklet/css/production/buildReporter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const getPackageVersion = () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'),
  );
  return packageJson.version;
};

const runVersion = async () => {
  console.log(getPackageVersion());
  return 0;
};

const loadCurrentAukletConfig = async (
  options?: Parameters<typeof loadAukletConfig>[1],
) => {
  return loadAukletConfig(process.cwd(), options);
};

const createLogger = (scope?: string) => {
  return createAukletLogger({ scope });
};

const runBuildStyle = async (
  args: Array<string>,
  options: {
    aukletConfig?: Awaited<ReturnType<typeof loadCurrentAukletConfig>>;
  } = {},
) => {
  const shouldWatch = args.includes('--watch') || args.includes('-w');
  const logger = createLogger();
  const aukletConfig =
    options.aukletConfig ??
    (await loadCurrentAukletConfig({
      cacheBust: shouldWatch,
    }));

  if (shouldWatch) {
    const watcher = await logger.group('Build CSS', async () => {
      const css = logger.child('css');
      const watcher = new ModuleStyleWatcher({ aukletConfig });
      await watcher.watch();
      css.success('watch mode ready');
      return watcher;
    });
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
};

const runBuildJs = async (args: Array<string>) => {
  const logger = createLogger();
  return logger.group('Build JavaScript', async () => {
    return runTsdown(args, { cwd: process.cwd() });
  });
};

const runBuild = async (args: Array<string>) => {
  const aukletConfig = await loadCurrentAukletConfig();
  cleanAukletOutputByConfig(process.cwd(), aukletConfig);

  const jsExitCode = await runBuildJs(args);
  if (jsExitCode) return jsExitCode;

  createLogger().newline();
  return runBuildStyle([], { aukletConfig });
};

const runDev = async () => {
  const entries = [
    createTsdownArgs(['--watch']),
    [path.resolve(__dirname, '../bin/entry.mjs'), 'build-css', '--watch'],
  ];
  const processes = entries.map((args) =>
    execa(process.execPath, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      reject: false,
    }),
  );

  const close = () => {
    for (const item of processes) {
      item.kill('SIGTERM');
    }
  };

  process.once('SIGINT', close);
  process.once('SIGTERM', close);

  for (const item of processes) {
    item.then((result) => {
      if (result.exitCode) close();
    });
  }

  const results = await Promise.all(processes);
  const failed = results.find((result) => result.exitCode);
  return failed?.exitCode ?? 0;
};

const runPublish = async (args: Array<string>) => {
  await runPublishCli(args);
  return 0;
};

const runOwner = async (args: Array<string>) => {
  await runOwnerCli(args);
  return 0;
};

const getCommandArgs = (argv: Array<string>, command: string) => {
  const rawArgs = argv.slice(2);
  const commandIndex = rawArgs.indexOf(command);
  return commandIndex >= 0 ? rawArgs.slice(commandIndex + 1) : [];
};

const runCliCommand = (
  runner: (args: Array<string>) => Promise<number | undefined>,
  args: Array<string>,
) => {
  return runner(args).then((exitCode) => {
    process.exit(exitCode ?? 0);
  });
};

async function runCli(argv: Array<string>) {
  const cli = cac('auk');

  cli
    .command('build [...args]', 'Build package JavaScript and CSS output')
    .allowUnknownOptions()
    .action(() => runCliCommand(runBuild, getCommandArgs(argv, 'build')));

  cli
    .command(
      'build-js [...args]',
      'Build package JavaScript output with tsdown',
    )
    .allowUnknownOptions()
    .action(() => runCliCommand(runBuildJs, getCommandArgs(argv, 'build-js')));

  cli
    .command('build-css [...args]', 'Build package module CSS output')
    .option('-w, --watch', 'Watch module CSS output')
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(runBuildStyle, getCommandArgs(argv, 'build-css')),
    );

  cli
    .command('dev', 'Watch package JavaScript and CSS output')
    .action(() => runCliCommand(runDev, []));

  cli
    .command('publish [...args]', 'Build and publish package output with pnpm')
    .allowUnknownOptions()
    .action(() => runCliCommand(runPublish, getCommandArgs(argv, 'publish')));

  cli
    .command('owner [...args]', 'Manage npm package owners with pnpm')
    .allowUnknownOptions()
    .action(() => runCliCommand(runOwner, getCommandArgs(argv, 'owner')));

  cli
    .command('version', 'Print auklet version')
    .action(() => runCliCommand(runVersion, []));

  cli.option('-v, --version', 'Print auklet version');
  cli.help();

  if (argv.length <= 2) {
    cli.outputHelp();
    process.exit(1);
  }

  cli.parse(argv, { run: false });
  if (!cli.matchedCommand && cli.options.version) {
    console.log(getPackageVersion());
    process.exit(0);
  }
  if (cli.options.help) {
    process.exit(0);
  }
  if (!cli.matchedCommand) {
    const [command] = argv.slice(2);
    if (command) {
      const logger = createLogger('cli');
      logger.error(`Unknown auk command: ${command}`);
    } else {
      cli.outputHelp();
    }
    process.exit(1);
  }
  await cli.runMatchedCommand();
}

export async function runAukletCli(argv = process.argv) {
  try {
    await runCli(argv);
  } catch (error) {
    const logger = createLogger('cli');
    logger.error(error);
    process.exit(1);
  }
}
