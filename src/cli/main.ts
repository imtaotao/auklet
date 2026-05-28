import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cac } from 'cac';
import { createAukletLogger } from '#auklet/logger';
import { runDev } from '#auklet/cli/dev';
import { runBuildCss } from '#auklet/cli/buildCss';
import { runBuild, runBuildJs } from '#auklet/cli/build';
import { runOwner, runPublish } from '#auklet/cli/publish';

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
      runCliCommand(runBuildCss, getCommandArgs(argv, 'build-css')),
    );

  cli
    .command('dev [...args]', 'Watch package JavaScript and CSS output')
    .allowUnknownOptions()
    .action(() => runCliCommand(runDev, getCommandArgs(argv, 'dev')));

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
