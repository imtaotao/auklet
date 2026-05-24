import minimist from 'minimist';
import { addOwners, publishPackages } from '#auklet/publish/runner';
import { ensurePnpm } from '#auklet/publish/pnpm';
import type { OwnerOptions, PublishOptions } from '#auklet/publish/types';

const publishFlags = new Set([
  '_',
  'filter',
  'version',
  'dry-run',
  'otp',
  'ignore-scripts',
]);
const ownerFlags = new Set(['_', 'filter', 'package', 'otp']);

export async function runPublishCli(args: Array<string>) {
  validateNoPrefixedFlags(args);
  const argv = minimist(args, {
    string: ['filter', 'version', 'otp'],
    boolean: ['dry-run', 'ignore-scripts'],
  });
  validateFlags(argv, publishFlags);
  if (argv._.length) {
    throw new Error(
      `[auklet:publish] unknown publish argument: ${argv._.join(' ')}`,
    );
  }

  await ensurePnpm();
  await publishPackages({
    cwd: process.cwd(),
    filters: toArray(argv.filter),
    version: stringOption(argv.version),
    dryRun: argv['dry-run'] === true,
    otp: stringOption(argv.otp),
    ignoreScripts: argv['ignore-scripts'] === true,
  } satisfies PublishOptions);
}

export async function runOwnerCli(args: Array<string>) {
  validateNoPrefixedFlags(args);
  const argv = minimist(args, {
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
  await addOwners({
    cwd: process.cwd(),
    users,
    filters: toArray(argv.filter),
    packages: toArray(argv.package),
    otp: stringOption(argv.otp),
  } satisfies OwnerOptions);
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

const validateNoPrefixedFlags = (args: Array<string>) => {
  const flag = args.find((arg) => arg.startsWith('--no-'));
  if (flag) {
    throw new Error(`[auklet:publish] unknown option: ${flag}`);
  }
};

const toArray = (value: unknown) => {
  if (value === undefined) return [];
  return Array.isArray(value)
    ? value.map(String).filter(Boolean)
    : [String(value)].filter(Boolean);
};

const stringOption = (value: unknown) => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return String(value.at(-1));
  return String(value);
};
