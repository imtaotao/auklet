#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const minimist = require('minimist');

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

const runBuildCss = async (args) => {
  const shouldWatch = args.includes('--watch') || args.includes('-w');
  const { loadAukletConfig } = await import('../dist/configLoader.js');
  const aukletConfig = await loadAukletConfig(process.cwd(), {
    cacheBust: shouldWatch,
  });

  if (shouldWatch) {
    const { ModuleCssWatcher } = await import(
      '../dist/css/watch/moduleCssWatcher.js'
    );
    const watcher = new ModuleCssWatcher({ aukletConfig, logger: console });
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

  const { ModuleCssBuilder } = await import(
    '../dist/css/production/moduleCssBuilder.js'
  );
  const builder = new ModuleCssBuilder({ aukletConfig, logger: console });
  await builder.build();
  return 0;
};

const runBuildJs = async (args) => {
  const { runTsdown } = await import('../dist/build/runTsdown.js');
  return runTsdown(args, { cwd: process.cwd() });
};

const runBuild = async (args) => {
  fs.rmSync(path.join(process.cwd(), 'dist'), {
    recursive: true,
    force: true,
  });

  const jsExitCode = await runBuildJs(args);
  if (jsExitCode) return jsExitCode;

  return runBuildCss([]);
};

const runDev = async () => {
  const { execa } = await import('execa');
  const { createTsdownArgs } = await import('../dist/build/runTsdown.js');
  const entries = [
    createTsdownArgs(['--watch']),
    [path.resolve(__dirname, './entry.cjs'), 'build-css', '--watch'],
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

const argv = minimist(process.argv.slice(2), {
  boolean: ['help', 'version'],
  alias: {
    h: 'help',
    v: 'version',
  },
});
const [command, ...args] = argv._;
const commandIndex = process.argv.indexOf(command);
const commandArgs =
  commandIndex >= 0 ? process.argv.slice(commandIndex + 1) : args;

if (argv.version) {
  console.log(getPackageVersion());
  process.exit(0);
}

if (argv.help || !command) {
  console.log('Usage: auk <command>');
  console.log('');
  console.log('Commands:');
  console.log('  build     Build package JavaScript and CSS output');
  console.log('  build-js  Build package JavaScript output with tsdown');
  console.log('  build-css  Build package module CSS output, supports --watch');
  console.log('  dev       Watch package JavaScript and CSS output');
  console.log('  version   Print auklet version');
  console.log('');
  console.log('Options:');
  console.log('  -v, --version  Print auklet version');
  console.log('  -h, --help     Print help');
  process.exit(argv.help ? 0 : 1);
}

const runners = {
  build: runBuild,
  'build-js': runBuildJs,
  'build-css': runBuildCss,
  dev: runDev,
  version: runVersion,
};

const runner = runners[command];

if (runner) {
  runner(commandArgs)
    .then((exitCode) => {
      process.exit(exitCode ?? 0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
  return;
}

console.error(`Unknown auk command: ${command}`);
process.exit(1);
