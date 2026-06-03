import minimist from 'minimist';
import {
  stringArrayOption,
  stringOption,
  stripArgsSeparator,
  validateNoPrefixedFlags,
  validateUnknownFlags,
} from '#auklet/cli/parse/core';
import type { AukletEnvContext } from '#auklet/env';
import type { OwnerOptions } from '#auklet/publish/types';

const ownerFlags = new Set(['_', 'filter', 'package', 'otp']);

export function parseOwnerCommand(
  args: Array<string>,
  options: {
    cwd: string;
    envContext: AukletEnvContext;
  },
) {
  const cliArgs = stripArgsSeparator(args);
  validateNoPrefixedFlags(cliArgs, new Set(), 'publish');

  const argv = minimist(cliArgs, {
    string: ['filter', 'package', 'otp'],
  });
  validateUnknownFlags(argv, ownerFlags, 'publish');

  const [subcommand, ...users] = argv._;
  if (subcommand !== 'add') {
    throw new Error(
      '[publish] expected owner command: auk owner add <user...>',
    );
  }
  if (!users.length) {
    throw new Error('[publish] owner add requires at least one user.');
  }

  return {
    cwd: options.cwd,
    users,
    filters: stringArrayOption(argv.filter, '--filter', options.envContext),
    packages: stringArrayOption(argv.package, '--package', options.envContext),
    otp: stringOption(argv.otp, '--otp', options.envContext),
  } satisfies OwnerOptions;
}
