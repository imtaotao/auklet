import minimist from 'minimist';
import { isArray } from 'aidly';
import { AukletEnvContext } from '#auklet/env';
import { ensurePnpm } from '#auklet/publish/api/pnpmApi';
import { OwnerRunner } from '#auklet/publish/ownerRunner';
import { PublishRunner } from '#auklet/publish/publishRunner';
import { validateNpmrcAuthEnv } from '#auklet/publish/api/npmrc';
import {
  resolveCliBoolean,
  resolveCliValue,
  createDeferredCliValue,
} from '#auklet/cli/values';
import { createPublishRootEnv } from '#auklet/publish/publishEnv';
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
  const cwd = process.cwd();
  const root = findWorkspaceRoot(cwd) ?? cwd;
  const envContext = new AukletEnvContext(cwd, root);

  await envContext.run(async () => {
    const runtime = { envContext };
    const options = resolvePublishCliOptions(args, cwd, envContext);
    const { env } = createPublishRootEnv(options, runtime);
    validatePublishCliNpmrcAuthEnv(options.cwd, env);
    await ensurePnpm({ env });
    await new PublishRunner(options, runtime).run();
  });
}

export function resolvePublishCliOptions(
  args: Array<string>,
  cwd = process.cwd(),
  envContext = new AukletEnvContext(cwd),
) {
  const argv = parsePublishArgs(args);
  if (argv._.length) {
    throw new Error(`[publish] unknown publish argument: ${argv._.join(' ')}`);
  }

  return {
    cwd,
    otp: stringOption(argv.otp, '--otp', envContext),
    filters: toArray(argv.filter, '--filter', envContext),
    version: stringOption(argv.version, '--version', envContext),
    git: booleanOption(argv.git, '--git', envContext, true),
    format: booleanOption(argv.format, '--format', envContext, true),
    dryRun: booleanOption(argv['dry-run'], '--dry-run', envContext),
    allowDirty: booleanOption(argv['allow-dirty'], '--allow-dirty', envContext),
    ignoreScripts: booleanOption(
      argv['ignore-scripts'],
      '--ignore-scripts',
      envContext,
    ),
    token: deferredStringOption(argv.token, '--token'),
  } satisfies PublishOptions;
}

const parsePublishArgs = (args: Array<string>) => {
  const cliArgs = stripLeadingArgsSeparator(args);
  validateNoPrefixedFlags(cliArgs, new Set(['--no-format', '--no-git']));
  const argv = minimist(cliArgs, {
    string: [
      'filter',
      'version',
      'otp',
      'token',
      'dry-run',
      'format',
      'git',
      'ignore-scripts',
      'allow-dirty',
    ],
  });
  validateFlags(argv, publishFlags);
  return argv;
};

export async function runOwnerCli(args: Array<string>) {
  const cwd = process.cwd();
  const root = findWorkspaceRoot(cwd) ?? cwd;
  const envContext = new AukletEnvContext(cwd, root);

  await envContext.run(async () => {
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

    const env = envContext.values;
    validatePublishCliNpmrcAuthEnv(cwd, env);
    await ensurePnpm({ env: envContext.normalizedValues });
    await new OwnerRunner({
      cwd,
      users,
      filters: toArray(argv.filter, '--filter', envContext),
      packages: toArray(argv.package, '--package', envContext),
      otp: stringOption(argv.otp, '--otp', envContext),
    } satisfies OwnerOptions).run();
  });
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

const toArray = (
  value: unknown,
  label: string,
  envContext: AukletEnvContext,
) => {
  if (value === undefined) return [];
  const values = isArray(value)
    ? value.map((item) => stringOption(item, label, envContext)).filter(Boolean)
    : [stringOption(value, label, envContext)].filter(Boolean);
  return values.filter((item): item is string => Boolean(item));
};

const stringOption = (
  value: unknown,
  label: string,
  envContext: AukletEnvContext,
) => {
  if (value === undefined) return undefined;
  if (isArray(value)) return stringOption(value.at(-1), label, envContext);
  return resolveCliValue(String(value), { label, context: envContext });
};

const deferredStringOption = (value: unknown, label: string) => {
  if (value === undefined) return undefined;
  if (isArray(value)) return deferredStringOption(value.at(-1), label);
  return createDeferredCliValue(String(value), { label });
};

const booleanOption = (
  value: unknown,
  label: string,
  envContext: AukletEnvContext,
  defaultValue = false,
) => {
  if (value === undefined) return defaultValue;
  if (isArray(value)) {
    return booleanOption(value.at(-1), label, envContext, defaultValue);
  }
  if (typeof value === 'boolean') return value;
  return resolveCliBoolean(String(value), { label, context: envContext });
};

const validatePublishCliNpmrcAuthEnv = (
  cwd: string,
  env?: Record<string, string | undefined>,
) => {
  validateNpmrcAuthEnv(cwd, findWorkspaceRoot(cwd) ?? cwd, { env });
};
