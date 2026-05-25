#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cac } from 'cac';

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
  const { loadAukletConfig } = await import('../dist/configLoader.js');
  return loadAukletConfig(process.cwd(), options);
};

const runBuildStyle = async (args, options = {}) => {
  const shouldWatch = args.includes('--watch') || args.includes('-w');
  const aukletConfig =
    options.aukletConfig ??
    (await loadCurrentAukletConfig({
      cacheBust: shouldWatch,
    }));

  if (shouldWatch) {
    const { ModuleStyleWatcher } = await import('../dist/css/watch/watcher.js');
    const watcher = new ModuleStyleWatcher({ aukletConfig, logger: console });
    await watcher.watch();
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

  const { ModuleStyleBuilder } =
    await import('../dist/css/production/builder.js');
  const builder = new ModuleStyleBuilder({ aukletConfig, logger: console });
  await builder.build();
  return 0;
};

const runBuildJs = async (args) => {
  const { runTsdown } = await import('../dist/build/runTsdown.js');
  return runTsdown(args, { cwd: process.cwd() });
};

const runBuild = async (args) => {
  const aukletConfig = await loadCurrentAukletConfig();
  const { cleanAukletOutputByConfig } =
    await import('../dist/build/cleanOutput.js');
  cleanAukletOutputByConfig(process.cwd(), aukletConfig);

  const jsExitCode = await runBuildJs(args);
  if (jsExitCode) return jsExitCode;

  return runBuildStyle([], { aukletConfig });
};

const runDev = async () => {
  const { execa } = await import('execa');
  const { createTsdownArgs } = await import('../dist/build/runTsdown.js');
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
  const { runPublishCli } = await import('../dist/publish/cli.js');
  await runPublishCli(args);
  return 0;
};

const runOwner = async (args) => {
  const { runOwnerCli } = await import('../dist/publish/cli.js');
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
      console.error(`Unknown auk command: ${command}`);
    } else {
      cli.outputHelp();
    }
    process.exit(1);
  }
  await cli.runMatchedCommand();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
