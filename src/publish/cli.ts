import minimist from 'minimist';
import { isArray } from 'aidly';
import { OwnerRunner } from '#auklet/publish/ownerRunner';
import { PublishRunner } from '#auklet/publish/publishRunner';
import { validateNpmrcAuthEnv } from '#auklet/publish/api/npmrc';
import { ensurePnpm } from '#auklet/publish/api/pnpmApi';
import { findWorkspaceRoot } from '#auklet/workspace/root';
import type { OwnerOptions, PublishOptions } from '#auklet/publish/types';

const publishFlags = new Set([
  '_',
  'filter',
  'version',
  'dry-run',
  'format',
  'git',
  'otp',
  'token',
  'ignore-scripts',
  'allow-dirty',
]);
const ownerFlags = new Set(['_', 'filter', 'package', 'otp']);

export async function runPublishCli(args: Array<string>) {
  const options = resolvePublishCliOptions(args);
  validatePublishCliNpmrcAuthEnv(options.cwd, options.token);

  await ensurePnpm({ token: options.token });
  await new PublishRunner(options).run();
}

export function resolvePublishCliOptions(
  args: Array<string>,
  cwd = process.cwd(),
) {
  const argv = parsePublishArgs(args);
  if (argv._.length) {
    throw new Error(`[publish] unknown publish argument: ${argv._.join(' ')}`);
  }

  return {
    cwd,
    otp: stringOption(argv.otp),
    filters: toArray(argv.filter),
    version: stringOption(argv.version),
    git: argv.git !== false,
    format: argv.format !== false,
    dryRun: argv['dry-run'] === true,
    allowDirty: argv['allow-dirty'] === true,
    ignoreScripts: argv['ignore-scripts'] === true,
    token: stringOption(argv.token),
  } satisfies PublishOptions;
}

const parsePublishArgs = (args: Array<string>) => {
  const cliArgs = stripLeadingArgsSeparator(args);
  validateNoPrefixedFlags(cliArgs, new Set(['--no-format', '--no-git']));
  const argv = minimist(cliArgs, {
    string: ['filter', 'version', 'otp', 'token'],
    boolean: ['dry-run', 'format', 'git', 'ignore-scripts', 'allow-dirty'],
    default: {
      git: true,
      format: true,
    },
  });
  validateFlags(argv, publishFlags);
  return argv;
};

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
      '[publish] expected owner command: auk owner add <user...>',
    );
  }
  if (!users.length) {
    throw new Error('[publish] owner add requires at least one user.');
  }

  const cwd = process.cwd();
  validatePublishCliNpmrcAuthEnv(cwd);
  await ensurePnpm();
  await new OwnerRunner({
    cwd,
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
      throw new Error(`[publish] unknown option: --${flag}`);
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
    throw new Error(`[publish] unknown option: ${flag}`);
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

const validatePublishCliNpmrcAuthEnv = (cwd: string, token?: string) => {
  validateNpmrcAuthEnv(cwd, findWorkspaceRoot(cwd) ?? cwd, { token });
};
