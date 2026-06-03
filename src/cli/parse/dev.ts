import { parseBuildCommand } from '#auklet/cli/parse/build';
import type { AukletEnvContext } from '#auklet/env';
import type { BuildCommandOptions } from '#auklet/cli/parse/build';

export type DevCommandOptions = BuildCommandOptions;

export function parseDevCommand(
  args: Array<string>,
  options: {
    cwd: string;
    envContext: AukletEnvContext;
  },
) {
  return parseBuildCommand(args, options) satisfies DevCommandOptions;
}
