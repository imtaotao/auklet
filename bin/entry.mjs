#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cac } from 'cac';
import { execa } from 'execa';
import { createTsdownArgs, runTsdown } from '../dist/build/runTsdown.js';
import { cleanAukletOutputByConfig } from '../dist/build/cleanOutput.js';
import { loadAukletConfig } from '../dist/configLoader.js';
import { createAukletLogger } from '../dist/logger.js';
import { ModuleStyleWatcher } from '../dist/css/watch/watcher.js';
import { ModuleStyleBuilder } from '../dist/css/production/builder.js';
import { logModuleStyleBuildResult } from '../dist/css/production/buildReporter.js';
import { runOwnerCli, runPublishCli } from '../dist/publish/cli.js';

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

const loadCurrentAukletConfig = async (options) => {
  return loadAukletConfig(process.cwd(), options);
};

const createLogger = (scope) => {
  return createAukletLogger({ scope });
};

const runBuildStyle = async (args, options = {}) => {
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

const runBuildJs = async (args) => {
  const logger = createLogger();
  return logger.group('Build JavaScript', async () => {
    return runTsdown(args, { cwd: process.cwd() });
  });
};

const runBuild = async (args) => {
  const aukletConfig = await loadCurrentAukletConfig();
  cleanAukletOutputByConfig(process.cwd(), aukletConfig);

  const jsExitCode = await runBuildJs(args);
  if (jsExitCode) return jsExitCode;

  return runBuildStyle([], { aukletConfig });
};

const runDev = async () => {
  const entries = [
    createTsdownArgs(['--watch']),
    [path.resolve(__dirname, './entry.mjs'), 'build-css', '--watch'],
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

const runPublish = async (args) => {
  await runPublishCli(args);
  return 0;
};

const runOwner = async (args) => {
  await runOwnerCli(args);
  return 0;
};

const getCommandArgs = (command) => {
  const rawArgs = process.argv.slice(2);
  const commandIndex = rawArgs.indexOf(command);
  return commandIndex >= 0 ? rawArgs.slice(commandIndex + 1) : [];
};

const runCliCommand = (runner, args) => {
  return runner(args).then((exitCode) => {
    process.exit(exitCode ?? 0);
  });
};

const main = async () => {
  const cli = cac('auk');

  cli
    .command('build [...args]', 'Build package JavaScript and CSS output')
    .allowUnknownOptions()
    .action(() => runCliCommand(runBuild, getCommandArgs('build')));

  cli
    .command(
      'build-js [...args]',
      'Build package JavaScript output with tsdown',
    )
    .allowUnknownOptions()
    .action(() => runCliCommand(runBuildJs, getCommandArgs('build-js')));

  cli
    .command('build-css [...args]', 'Build package module CSS output')
    .option('-w, --watch', 'Watch module CSS output')
    .allowUnknownOptions()
    .action(() => runCliCommand(runBuildStyle, getCommandArgs('build-css')));

  cli
    .command('dev', 'Watch package JavaScript and CSS output')
    .action(() => runCliCommand(runDev, []));

  cli
    .command('publish [...args]', 'Build and publish package output with pnpm')
    .allowUnknownOptions()
    .action(() => runCliCommand(runPublish, getCommandArgs('publish')));

  cli
    .command('owner [...args]', 'Manage npm package owners with pnpm')
    .allowUnknownOptions()
    .action(() => runCliCommand(runOwner, getCommandArgs('owner')));

  cli
    .command('version', 'Print auklet version')
    .action(() => runCliCommand(runVersion, []));

  cli.option('-v, --version', 'Print auklet version');
  cli.help();

  if (process.argv.length <= 2) {
    cli.outputHelp();
    process.exit(1);
  }

  cli.parse(process.argv, { run: false });
  if (!cli.matchedCommand && cli.options.version) {
    console.log(getPackageVersion());
    process.exit(0);
  }
  if (cli.options.help) {
    process.exit(0);
  }
  if (!cli.matchedCommand) {
    const [command] = process.argv.slice(2);
    if (command) {
      const logger = createLogger('cli');
      logger.error(`Unknown auk command: ${command}`);
    } else {
      cli.outputHelp();
    }
    process.exit(1);
  }
  await cli.runMatchedCommand();
};

main().catch((error) => {
  const logger = createLogger('cli');
  logger.error(error);
  process.exit(1);
});
