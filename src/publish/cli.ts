import minimist from 'minimist';
import { isArray } from 'aidly';
import { OwnerRunner } from '#auklet/publish/ownerRunner';
import { PublishRunner } from '#auklet/publish/publishRunner';
import { ensurePnpm } from '#auklet/publish/api/pnpmApi';
import type { OwnerOptions, PublishOptions } from '#auklet/publish/types';

const publishFlags = new Set([
  '_',
  'filter',
  'version',
  'dry-run',
  'format',
  'otp',
  'ignore-scripts',
  'allow-dirty',
]);
const ownerFlags = new Set(['_', 'filter', 'package', 'otp']);

export async function runPublishCli(args: Array<string>) {
  const cliArgs = stripLeadingArgsSeparator(args);
  validateNoPrefixedFlags(cliArgs, new Set(['--no-format']));
  const argv = minimist(cliArgs, {
    string: ['filter', 'version', 'otp'],
    boolean: ['dry-run', 'format', 'ignore-scripts', 'allow-dirty'],
    default: {
      format: true,
    },
  });
  validateFlags(argv, publishFlags);
  if (argv._.length) {
    throw new Error(
      `[auklet:publish] unknown publish argument: ${argv._.join(' ')}`,
    );
  }

  await ensurePnpm();
  await new PublishRunner({
    cwd: process.cwd(),
    filters: toArray(argv.filter),
    version: stringOption(argv.version),
    dryRun: argv['dry-run'] === true,
    format: argv.format !== false,
    otp: stringOption(argv.otp),
    ignoreScripts: argv['ignore-scripts'] === true,
    allowDirty: argv['allow-dirty'] === true,
  } satisfies PublishOptions).run();
}

export async function runOwnerCli(args: Array<string>) {
  const cliArgs = stripLeadingArgsSeparator(args);
  validateNoPrefixedFlags(cliArgs, new Set());
  const argv = minimist(cliArgs, {
    string: ['filter', 'package', 'otp'],
  });
  validateFlags(argv, ownerFlags);
  const [subcommand, ...users] = argv._;
  if (subcommand !== 'add') {
    throw new Error(
      '[auklet:publish] expected owner command: auk owner add <user...>',
    );
  }
  if (!users.length) {
    throw new Error('[auklet:publish] owner add requires at least one user.');
  }

  await ensurePnpm();
  await new OwnerRunner({
    cwd: process.cwd(),
    users,
    filters: toArray(argv.filter),
    packages: toArray(argv.package),
    otp: stringOption(argv.otp),
  } satisfies OwnerOptions).run();
}

const validateFlags = (
  argv: Record<string, unknown>,
  allowedFlags: Set<string>,
) => {
  for (const flag of Object.keys(argv)) {
    if (!allowedFlags.has(flag)) {
      throw new Error(`[auklet:publish] unknown option: --${flag}`);
    }
  }
};

const validateNoPrefixedFlags = (
  args: Array<string>,
  allowedFlags: Set<string>,
) => {
  const flag = args.find(
    (arg) => arg.startsWith('--no-') && !allowedFlags.has(arg),
  );
  if (flag) {
    throw new Error(`[auklet:publish] unknown option: ${flag}`);
  }
};

const stripLeadingArgsSeparator = (args: Array<string>) => {
  return args.filter((arg) => arg !== '--');
};

const toArray = (value: unknown) => {
  if (value === undefined) return [];
  return isArray(value)
    ? value.map(String).filter(Boolean)
    : [String(value)].filter(Boolean);
};

const stringOption = (value: unknown) => {
  if (value === undefined) return undefined;
  if (isArray(value)) return String(value.at(-1));
  return String(value);
};
