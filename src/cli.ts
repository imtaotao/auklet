import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cac } from 'cac';
import { execa } from 'execa';
import { cleanAukletOutputByConfig } from '#auklet/build/cleanOutput';
import {
  aukletCliConfigOverridesEnv,
  encodeAukletCliConfigOverrides,
  mergeAukletConfigOverrides,
} from '#auklet/build/cliOverrides';
import {
  createTsdownArgs,
  hasTsdownConfigArg,
  runTsdown,
} from '#auklet/build/runTsdown';
import { createAukletLogger } from '#auklet/logger';
import { loadAukletConfig } from '#auklet/configLoader';
import { ModuleStyleWatcher } from '#auklet/css/watch/watcher';
import { runOwnerCli, runPublishCli } from '#auklet/publish/cli';
import { ModuleStyleBuilder } from '#auklet/css/production/builder';
import { logModuleStyleBuildResult } from '#auklet/css/production/buildReporter';
import type {
  AukletConfig,
  PackageBuildFormat,
  PackageBuildPlatform,
} from '#auklet/types';

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
    aukletConfig?: AukletConfig;
  } = {},
) => {
  const buildArgs = resolveBuildCliArgs(args);
  const shouldWatch =
    buildArgs.args.includes('--watch') || buildArgs.args.includes('-w');
  const logger = createLogger();
  const aukletConfig =
    options.aukletConfig ??
    mergeAukletConfigOverrides(
      await loadCurrentAukletConfig({
        cacheBust: shouldWatch,
      }),
      buildArgs.config,
    );

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

const runBuildJs = async (
  args: Array<string>,
  options: {
    config?: AukletConfig;
  } = {},
) => {
  const buildArgs = resolveBuildCliArgs(args);
  const config = mergeAukletConfigOverrides(
    options.config ?? {},
    buildArgs.config,
  );
  const logger = createLogger();
  return logger.group('Build JavaScript', async () => {
    return runTsdown(buildArgs.args, {
      cwd: process.cwd(),
      env: createBuildEnv(config),
    });
  });
};

const runBuild = async (args: Array<string>) => {
  const buildArgs = resolveBuildCliArgs(args);
  const aukletConfig = mergeAukletConfigOverrides(
    await loadCurrentAukletConfig(),
    buildArgs.config,
  );
  cleanAukletOutputByConfig(process.cwd(), aukletConfig);

  const jsExitCode = await runBuildJs(buildArgs.args, {
    config: buildArgs.config,
  });
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

const createBuildEnv = (config: AukletConfig) => {
  if (!hasAukletConfig(config)) return undefined;
  return {
    [aukletCliConfigOverridesEnv]: encodeAukletCliConfigOverrides(config),
  };
};

const hasAukletConfig = (config: AukletConfig) => {
  return Object.keys(config).length > 0;
};

const buildFormats = new Set(['cjs', 'esm', 'iife']);
const buildPlatforms = new Set(['node', 'neutral', 'browser']);

export function resolveBuildCliArgs(args: Array<string>) {
  const remainingArgs: Array<string> = [];
  const config: AukletConfig = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const [name, inlineValue] = arg.split('=', 2);

    if (name === '--source') {
      config.source = getFlagValue(args, index, inlineValue, name);
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (name === '--output') {
      config.output = getFlagValue(args, index, inlineValue, name);
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (name === '--modules') {
      config.modules = true;
      continue;
    }
    if (name === '--no-modules') {
      config.modules = false;
      continue;
    }
    if (name === '--build.formats') {
      config.build = {
        ...config.build,
        formats: parseBuildFormats(
          getFlagValue(args, index, inlineValue, name),
        ),
      };
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (name === '--build.target') {
      config.build = {
        ...config.build,
        target: getFlagValue(args, index, inlineValue, name),
      };
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (name === '--build.platform') {
      config.build = {
        ...config.build,
        platform: parseBuildPlatform(
          getFlagValue(args, index, inlineValue, name),
        ),
      };
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (name === '--build.tsconfig') {
      config.build = {
        ...config.build,
        tsconfig: getFlagValue(args, index, inlineValue, name),
      };
      if (inlineValue === undefined) index += 1;
      continue;
    }

    remainingArgs.push(arg);
  }

  if (hasAukletConfig(config) && hasTsdownConfigArg(remainingArgs)) {
    throw new Error(
      'Auklet build config flags cannot be used with tsdown --config, -c, or --no-config.',
    );
  }

  return {
    args: remainingArgs,
    config,
  };
}

const getFlagValue = (
  args: Array<string>,
  index: number,
  inlineValue: string | undefined,
  flag: string,
) => {
  const value = inlineValue ?? args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
};

const parseBuildFormats = (value: string) => {
  const formats = value
    .split(',')
    .map((format) => format.trim())
    .filter(Boolean);

  if (!formats.length) {
    throw new Error('--build.formats requires at least one format.');
  }
  for (const format of formats) {
    if (!buildFormats.has(format)) {
      throw new Error(`Unknown build format: ${format}`);
    }
  }
  return formats as Array<PackageBuildFormat>;
};

const parseBuildPlatform = (value: string) => {
  if (!buildPlatforms.has(value)) {
    throw new Error(`Unknown build platform: ${value}`);
  }
  return value as PackageBuildPlatform;
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
