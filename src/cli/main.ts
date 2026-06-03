import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cac, type Command } from 'cac';
import { AukletEnvContext } from '#auklet/env';
import { createAukletLogger } from '#auklet/logger';
import { runOwnerCli, runPublishCli } from '#auklet/publish/cli';
import { runDev } from '#auklet/cli/dev';
import { runInspect } from '#auklet/cli/inspect';
import { runBuildCss } from '#auklet/cli/buildCss';
import { parseDevCommand } from '#auklet/cli/parse/dev';
import { runBuild, runBuildJs } from '#auklet/cli/build';
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

const addBuildOverrideOptions = (command: Command) => {
  return command
    .option('--source <dir>', 'Source directory')
    .option('--output <dir>', 'Output directory')
    .option('--modules [value]', 'Enable unbundled module output')
    .option('--no-modules', 'Disable unbundled module output')
    .option(
      '--build.formats <formats>',
      'Comma-separated cjs, esm, and/or iife formats',
    )
    .option('--build.target <target>', 'JavaScript target passed to tsdown')
    .option('--build.platform <platform>', 'node, neutral, or browser')
    .option('--build.tsconfig <file>', 'TypeScript config file');
};

const addWorkspaceOptions = (command: Command) => {
  return command
    .option('--filter <pattern>', 'Select workspace packages by package name')
    .option('--workspace', "Alias for --filter '*'")
    .option('--private [value]', 'Include private workspace packages')
    .option(
      '--deps [value]',
      "Include selected packages' workspace dependencies",
    );
};

const addPublishOptions = (command: Command) => {
  return command
    .option('--filter <pattern>', 'Select workspace packages by package name')
    .option('--workspace', "Alias for --filter '*'")
    .option('--version <value>', 'Publish version or version bump')
    .option(
      '--dry-run [value]',
      'Validate without writing git or registry state',
    )
    .option('--format [value]', 'Enable publish output formatter')
    .option('--no-format', 'Disable publish output formatter')
    .option('--git [value]', 'Create release commit and tag')
    .option('--no-git', 'Skip release commit and tag')
    .option('--allow-dirty [value]', 'Allow publishing from a dirty worktree')
    .option('--ignore-scripts [value]', 'Skip publish lifecycle hooks')
    .option('--otp <code>', 'Forward an npm 2FA one-time password')
    .option(
      '--token <value>',
      'Set NODE_AUTH_TOKEN and NPM_TOKEN for subprocesses',
    );
};

const createHelpFormatter = (cli: ReturnType<typeof cac>) => {
  return (sections: Array<{ title?: string; body: string }>) => {
    const command = cli.matchedCommand?.name;
    return sections.map((section) => {
      if (section.title !== 'Options') return section;

      let body = section.body.replace(/\s+\(default: true\)/g, '');
      if (!command) {
        body = addHelpOptionLine(body, '  -v, --version  Print auklet version');
      }
      if (command === 'publish') {
        body = addHelpOptionLine(
          body,
          '  --version <value>        Publish version or version bump',
        );
      }
      if (command === 'inspect') {
        body = addHelpOptionLine(
          body,
          '  --version <value>  Publish version or version bump',
        );
      }
      return {
        ...section,
        body,
      };
    });
  };
};

const addHelpOptionLine = (body: string, line: string) => {
  if (body.includes(line.trimStart().split(/\s+/)[0]!)) return body;
  const helpLinePattern = /^  -h, --help/m;
  if (!helpLinePattern.test(body)) return `${body}\n${line}`;
  return body.replace(helpLinePattern, `${line}\n  -h, --help`);
};

async function runCli(argv: Array<string>) {
  const cli = cac('auk');

  addWorkspaceOptions(
    addBuildOverrideOptions(
      cli.command('build [...args]', 'Build package JavaScript and CSS output'),
    ),
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

  addBuildOverrideOptions(
    cli.command(
      'build-js [...args]',
      'Build package JavaScript output with tsdown',
    ),
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

  addBuildOverrideOptions(
    cli
      .command('build-css [...args]', 'Build package module CSS output')
      .option('-w, --watch', 'Watch module CSS output'),
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

  addWorkspaceOptions(
    addBuildOverrideOptions(
      cli.command('dev [...args]', 'Watch package JavaScript and CSS output'),
    ),
  )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => {
        const context = createCommandContext();
        return runDev(parseDevCommand(getRawCommandArgs(argv, 'dev'), context));
      }),
    );

  addPublishOptions(
    cli.command(
      'publish [...args]',
      'Build and publish package output with pnpm',
    ),
  )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => runPublishCli(getRawCommandArgs(argv, 'publish'))),
    );

  cli
    .command(
      'owner add <user...>',
      'Add npm owners to the current package or selected packages',
    )
    .option('--filter <pattern>', 'Add owners to matching workspace packages')
    .option('--package <name>', 'Add owners to explicit npm packages')
    .option('--otp <code>', 'Forward an npm owner-management 2FA code')
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => runOwnerCli(getRawCommandArgs(argv, 'owner'))),
    );

  cli
    .command('owner [...args]', 'Manage npm package owners with pnpm')
    .usage('add <user...> [options]')
    .option('--filter <pattern>', 'Add owners to matching workspace packages')
    .option('--package <name>', 'Add owners to explicit npm packages')
    .option('--otp <code>', 'Forward an npm owner-management 2FA code')
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => runOwnerCli(getRawCommandArgs(argv, 'owner'))),
    );

  cli
    .command('inspect publish [...args]', 'Check publish readiness')
    .option('--filter <pattern>', 'Select workspace packages by package name')
    .option('--workspace', "Alias for --filter '*'")
    .option('--version <value>', 'Publish version or version bump')
    .option('--dry-run [value]', 'Preview dry-run publish behavior')
    .option('--otp <code>', 'Forward an npm 2FA one-time password')
    .option(
      '--token <value>',
      'Set NODE_AUTH_TOKEN and NPM_TOKEN for subprocesses',
    )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => runInspect(getRawCommandArgs(argv, 'inspect'))),
    );

  cli
    .command('inspect pack [...args]', 'Check package entry and export files')
    .option('--filter <pattern>', 'Select workspace packages by package name')
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => runInspect(getRawCommandArgs(argv, 'inspect'))),
    );

  addBuildOverrideOptions(
    cli.command('inspect css [...args]', 'Explain CSS output plans'),
  )
    .ignoreOptionDefaultValue()
    .allowUnknownOptions()
    .action(() =>
      runCliCommand(() => runInspect(getRawCommandArgs(argv, 'inspect'))),
    );

  cli
    .command('inspect [...args]', 'Inspect auklet plans without side effects')
    .usage('<publish|pack|css> [...args]')
    .option('--filter <pattern>', 'Select workspace packages by package name')
    .option('--workspace', "Alias for --filter '*'")
    .option('--version <value>', 'Publish version or version bump')
    .option('--dry-run [value]', 'Preview dry-run publish behavior')
    .option('--otp <code>', 'Forward an npm 2FA one-time password')
    .option('--token <value>', 'Set publish auth token')
    .option('--source <dir>', 'CSS inspect source directory')
    .option('--output <dir>', 'CSS inspect output directory')
    .option('--modules [value]', 'Enable CSS inspect module output')
    .option('--no-modules', 'Disable CSS inspect module output')
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
