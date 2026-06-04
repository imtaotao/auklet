import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cac } from 'cac';
import { AukletEnvContext } from '#auklet/env';
import { createAukletLogger } from '#auklet/logger';
import { runOwnerCli, runPublishCli } from '#auklet/publish/cli';
import { runDev } from '#auklet/cli/dev';
import { runInspect } from '#auklet/cli/inspect';
import { runBuildCss } from '#auklet/cli/buildCss';
import { parseDevCommand } from '#auklet/cli/parse/dev';
import { runBuild, runBuildJs } from '#auklet/cli/build';
import {
  addCommandOptions,
  commandHelpOptions,
  createHelpFormatter,
} from '#auklet/cli/help';
import {
  parseBuildCommand,
  parseBuildCssCommand,
  parseBuildJsCommand,
} from '#auklet/cli/parse/build';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const getPackageVersion = () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
  );
  return packageJson.version;
};

const runVersion = async () => {
  console.log(getPackageVersion());
  return 0;
};

// Raw argv slicing is intentionally kept in this entry module. Command runners
// only receive parsed options or command-specific raw subcommand args.
const getRawCommandArgs = (argv: Array<string>, command: string) => {
  const rawArgs = argv.slice(2);
  const commandIndex = rawArgs.indexOf(command);
  return commandIndex >= 0 ? rawArgs.slice(commandIndex + 1) : [];
};

const runCliCommand = (runner: () => Promise<number | void | undefined>) => {
  return runner().then((exitCode) => {
    process.exit(exitCode ?? 0);
  });
};

const createCommandContext = () => {
  const cwd = process.cwd();
  return {
    cwd,
    envContext: new AukletEnvContext(cwd),
  };
};

async function runCli(argv: Array<string>) {
  const cli = cac('auk');

  addCommandOptions(
    addCommandOptions(
      cli.command('build [...args]', 'Build package JavaScript and CSS output'),
      commandHelpOptions.buildOverrides,
    ),
    commandHelpOptions.workspace,
  )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => {
        const context = createCommandContext();
        return runBuild(
          parseBuildCommand(getRawCommandArgs(argv, 'build'), context),
        );
      }),
    );

  addCommandOptions(
    cli.command(
      'build-js [...args]',
      'Build package JavaScript output with tsdown',
    ),
    commandHelpOptions.buildOverrides,
  )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => {
        const context = createCommandContext();
        return runBuildJs(
          parseBuildJsCommand(getRawCommandArgs(argv, 'build-js'), context),
        );
      }),
    );

  addCommandOptions(
    cli
      .command('build-css [...args]', 'Build package module CSS output')
      .option('-w, --watch', 'Watch module CSS output'),
    commandHelpOptions.buildOverrides,
  )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => {
        const context = createCommandContext();
        return runBuildCss(
          parseBuildCssCommand(getRawCommandArgs(argv, 'build-css'), context),
        );
      }),
    );

  addCommandOptions(
    addCommandOptions(
      cli.command('dev [...args]', 'Watch package JavaScript and CSS output'),
      commandHelpOptions.buildOverrides,
    ),
    commandHelpOptions.workspace,
  )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => {
        const context = createCommandContext();
        return runDev(parseDevCommand(getRawCommandArgs(argv, 'dev'), context));
      }),
    );

  addCommandOptions(
    cli.command(
      'publish [...args]',
      'Build and publish package output with pnpm',
    ),
    commandHelpOptions.publish,
  )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => runPublishCli(getRawCommandArgs(argv, 'publish'))),
    );

  addCommandOptions(
    cli.command(
      'owner add <user...>',
      'Add npm owners to the current package or selected packages',
    ),
    commandHelpOptions.owner,
  )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => runOwnerCli(getRawCommandArgs(argv, 'owner'))),
    );

  addCommandOptions(
    cli
      .command('owner [...args]', 'Manage npm package owners with pnpm')
      .usage('add <user...> [options]'),
    commandHelpOptions.owner,
  )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => runOwnerCli(getRawCommandArgs(argv, 'owner'))),
    );

  addCommandOptions(
    cli.command('inspect publish [...args]', 'Check publish readiness'),
    commandHelpOptions.inspectPublish,
  )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => runInspect(getRawCommandArgs(argv, 'inspect'))),
    );

  addCommandOptions(
    cli.command(
      'inspect pack [...args]',
      'Check package entry and export files',
    ),
    commandHelpOptions.inspectPack,
  )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => runInspect(getRawCommandArgs(argv, 'inspect'))),
    );

  addCommandOptions(
    cli.command('inspect css [...args]', 'Explain CSS output plans'),
    commandHelpOptions.inspectCss,
  )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => runInspect(getRawCommandArgs(argv, 'inspect'))),
    );

  addCommandOptions(
    cli
      .command('inspect [...args]', 'Inspect auklet plans without side effects')
      .usage('<publish|pack|css> [...args]'),
    commandHelpOptions.inspect,
  )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => runInspect(getRawCommandArgs(argv, 'inspect'))),
    );

  cli
    .command('version', 'Print auklet version')
    .action(() => runCliCommand(runVersion));
  cli.command('help', 'Print auklet help').action(() =>
    runCliCommand(async () => {
      cli.unsetMatchedCommand();
      cli.outputHelp();
      return 0;
    }),
  );

  cli.help(createHelpFormatter(cli));

  if (argv.length <= 2) {
    cli.outputHelp();
    process.exit(1);
  }

  const rawArgs = argv.slice(2);
  if (
    rawArgs.length === 1 &&
    (rawArgs[0] === '-v' || rawArgs[0] === '--version')
  ) {
    console.log(getPackageVersion());
    process.exit(0);
  }

  cli.parse(argv, { run: false });
  if (cli.options.help) {
    process.exit(0);
  }
  if (!cli.matchedCommand) {
    const [command] = argv.slice(2);
    if (command) {
      const logger = createAukletLogger({ scope: 'cli' });
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
    const logger = createAukletLogger({ scope: 'cli' });
    logger.error(error);
    logger.newline();
    process.exit(1);
  }
}
