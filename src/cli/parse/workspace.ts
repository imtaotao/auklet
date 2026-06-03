import { resolveCliBoolean, resolveCliValue } from '#auklet/cli/parse/values';
import {
  dedupe,
  readFlagValue,
  readOptionalFlagValue,
} from '#auklet/cli/parse/core';
import type { AukletEnvContext } from '#auklet/env';

export type WorkspaceSelection = {
  filters: Array<string>;
  includePrivate: boolean;
  includeDependencies: boolean;
};

export function parseWorkspaceSelectionArgs(
  args: Array<string>,
  envContext: AukletEnvContext,
) {
  const filters: Array<string> = [];
  const remainingArgs: Array<string> = [];
  let includePrivate = false;
  let includeDependencies = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const [name, inlineValue] = arg.split('=', 2);

    if (name === '--workspace') {
      if (inlineValue !== undefined) {
        throw new Error('--workspace does not accept a value.');
      }
      filters.push('*');
      continue;
    }

    if (name === '--filter') {
      filters.push(
        resolveCliValue(readFlagValue(args, index, inlineValue, name), {
          label: name,
          context: envContext,
        })!,
      );
      if (inlineValue === undefined) index += 1;
      continue;
    }

    if (name === '--deps') {
      const result = readWorkspaceBooleanFlag(
        args,
        index,
        inlineValue,
        name,
        envContext,
      );
      includeDependencies = result.value;
      if (result.consumedNext) index += 1;
      continue;
    }

    if (name === '--private') {
      const result = readWorkspaceBooleanFlag(
        args,
        index,
        inlineValue,
        name,
        envContext,
      );
      includePrivate = result.value;
      if (result.consumedNext) index += 1;
      continue;
    }

    remainingArgs.push(arg);
  }

  return {
    remainingArgs,
    workspace: {
      filters: dedupe(filters),
      includeDependencies,
      includePrivate,
    } satisfies WorkspaceSelection,
  };
}

const readWorkspaceBooleanFlag = (
  args: Array<string>,
  index: number,
  inlineValue: string | undefined,
  name: string,
  envContext: AukletEnvContext,
) => {
  const value = readOptionalFlagValue(args, index, inlineValue);
  return {
    consumedNext: inlineValue === undefined && value !== undefined,
    value:
      value === undefined
        ? true
        : resolveCliBoolean(value, { label: name, context: envContext }),
  };
};
