import minimist from 'minimist';
import {
  booleanOption,
  deferredStringOption,
  dedupe,
  stringArrayOption,
  stringOption,
  stripArgsSeparator,
  validateNoPrefixedFlags,
  validateUnknownFlags,
} from '#auklet/cli/parse/core';
import type { AukletEnvContext } from '#auklet/env';
import type { PublishOptions } from '#auklet/publish/types';

const publishFlags = new Set([
  '_',
  'filter',
  'workspace',
  'version',
  'dry-run',
  'format',
  'git',
  'otp',
  'token',
  'ignore-scripts',
  'allow-dirty',
]);

export function parsePublishCommand(
  args: Array<string>,
  options: {
    cwd: string;
    envContext: AukletEnvContext;
  },
) {
  const argv = parsePublishArgs(args);
  if (argv._.length) {
    throw new Error(`[publish] unknown publish argument: ${argv._.join(' ')}`);
  }

  return {
    cwd: options.cwd,
    otp: stringOption(argv.otp, '--otp', options.envContext),
    filters: resolvePublishFilters(argv, options.envContext),
    version: stringOption(argv.version, '--version', options.envContext),
    git: booleanOption(argv.git, '--git', options.envContext, true),
    format: booleanOption(argv.format, '--format', options.envContext, true),
    dryRun: booleanOption(argv['dry-run'], '--dry-run', options.envContext),
    allowDirty: booleanOption(
      argv['allow-dirty'],
      '--allow-dirty',
      options.envContext,
    ),
    ignoreScripts: booleanOption(
      argv['ignore-scripts'],
      '--ignore-scripts',
      options.envContext,
    ),
    token: deferredStringOption(argv.token, '--token'),
  } satisfies PublishOptions;
}

const parsePublishArgs = (args: Array<string>) => {
  const cliArgs = stripArgsSeparator(args);
  validateNoPrefixedFlags(
    cliArgs,
    new Set(['--no-format', '--no-git']),
    'publish',
  );
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
    boolean: ['workspace'],
  });
  validateUnknownFlags(argv, publishFlags, 'publish');
  return argv;
};

const resolvePublishFilters = (
  argv: Record<string, unknown>,
  envContext: AukletEnvContext,
) => {
  const filters = stringArrayOption(argv.filter, '--filter', envContext);
  if (booleanOption(argv.workspace, '--workspace', envContext)) {
    filters.push('*');
  }
  return dedupe(filters);
};
