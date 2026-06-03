import { hasTsdownConfigArg } from '#auklet/build/runTsdown';
import {
  aukletCliConfigOverridesEnv,
  encodeAukletCliConfigOverrides,
} from '#auklet/build/cliOverrides';
import { resolveCliBoolean, resolveCliValue } from '#auklet/cli/parse/values';
import { readFlagValue, readOptionalFlagValue } from '#auklet/cli/parse/core';
import { parseWorkspaceSelectionArgs } from '#auklet/cli/parse/workspace';
import type { AukletEnvContext } from '#auklet/env';
import type {
  AukletConfig,
  PackageBuildFormat,
  PackageBuildPlatform,
} from '#auklet/types';
import type { WorkspaceSelection } from '#auklet/cli/parse/workspace';

export type BuildCommandOptions = {
  cwd: string;
  envContext: AukletEnvContext;
  workspace: WorkspaceSelection;
  overrides: AukletConfig;
  passthroughArgs: Array<string>;
  workspaceScriptArgs: Array<string>;
};

export type BuildJsCommandOptions = {
  cwd: string;
  envContext: AukletEnvContext;
  overrides: AukletConfig;
  passthroughArgs: Array<string>;
};

export type BuildCssCommandOptions = {
  cwd: string;
  envContext: AukletEnvContext;
  overrides: AukletConfig;
  watch: boolean;
};

const buildFormats = new Set(['cjs', 'esm', 'iife']);
const buildPlatforms = new Set(['node', 'neutral', 'browser']);

const hasAukletConfig = (config: AukletConfig) => {
  return Object.keys(config).length > 0;
};

export function parseBuildCommand(
  args: Array<string>,
  options: {
    cwd: string;
    envContext: AukletEnvContext;
  },
) {
  const workspaceArgs = parseWorkspaceSelectionArgs(args, options.envContext);
  const buildArgs = parseBuildOverrideArgs(
    workspaceArgs.remainingArgs,
    options.envContext,
  );

  return {
    cwd: options.cwd,
    envContext: options.envContext,
    workspace: workspaceArgs.workspace,
    overrides: buildArgs.config,
    passthroughArgs: buildArgs.args,
    workspaceScriptArgs: workspaceArgs.remainingArgs,
  } satisfies BuildCommandOptions;
}

export function parseBuildJsCommand(
  args: Array<string>,
  options: {
    cwd: string;
    envContext: AukletEnvContext;
  },
) {
  const buildArgs = parseBuildOverrideArgs(args, options.envContext);
  return {
    cwd: options.cwd,
    envContext: options.envContext,
    overrides: buildArgs.config,
    passthroughArgs: buildArgs.args,
  } satisfies BuildJsCommandOptions;
}

export function parseBuildCssCommand(
  args: Array<string>,
  options: {
    cwd: string;
    envContext: AukletEnvContext;
  },
) {
  const buildArgs = parseBuildOverrideArgs(args, options.envContext);
  const remainingArgs = buildArgs.args.filter(
    (arg) => arg !== '--watch' && arg !== '-w',
  );
  if (remainingArgs.length) {
    throw new Error(
      `[build-css] unknown build-css argument: ${remainingArgs[0]}`,
    );
  }

  return {
    cwd: options.cwd,
    envContext: options.envContext,
    overrides: buildArgs.config,
    watch: buildArgs.args.includes('--watch') || buildArgs.args.includes('-w'),
  } satisfies BuildCssCommandOptions;
}

export function parseBuildOverrideArgs(
  args: Array<string>,
  envContext: AukletEnvContext,
) {
  const remainingArgs: Array<string> = [];
  const config: AukletConfig = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const [name, inlineValue] = arg.split('=', 2);

    if (name === '--source') {
      config.source = getResolvedFlagValue(
        args,
        index,
        inlineValue,
        name,
        envContext,
      );
      if (inlineValue === undefined) index += 1;
      continue;
    }

    if (name === '--output') {
      config.output = getResolvedFlagValue(
        args,
        index,
        inlineValue,
        name,
        envContext,
      );
      if (inlineValue === undefined) index += 1;
      continue;
    }

    if (name === '--modules') {
      const value = readOptionalFlagValue(args, index, inlineValue);
      config.modules =
        value === undefined
          ? true
          : resolveCliBoolean(value, { label: name, context: envContext });
      if (inlineValue === undefined && value !== undefined) index += 1;
      continue;
    }

    if (name === '--no-modules') {
      config.modules = false;
      continue;
    }

    if (name === '--build.formats') {
      config.build = {
        ...config.build,
        formats: parseBuildFormats(
          inlineValue === undefined
            ? getResolvedFlagValue(args, index, inlineValue, name, envContext)
            : (resolveCliValue(inlineValue, {
                label: name,
                context: envContext,
              }) ?? inlineValue),
        ),
      };
      if (inlineValue === undefined) index += 1;
      continue;
    }

    if (name === '--build.target') {
      config.build = {
        ...config.build,
        target: getResolvedFlagValue(
          args,
          index,
          inlineValue,
          name,
          envContext,
        ),
      };
      if (inlineValue === undefined) index += 1;
      continue;
    }

    if (name === '--build.platform') {
      config.build = {
        ...config.build,
        platform: parseBuildPlatform(
          getResolvedFlagValue(args, index, inlineValue, name, envContext),
        ),
      };
      if (inlineValue === undefined) index += 1;
      continue;
    }

    if (name === '--build.tsconfig') {
      config.build = {
        ...config.build,
        tsconfig: getResolvedFlagValue(
          args,
          index,
          inlineValue,
          name,
          envContext,
        ),
      };
      if (inlineValue === undefined) index += 1;
      continue;
    }

    remainingArgs.push(arg);
  }

  if (hasAukletConfig(config) && hasTsdownConfigArg(remainingArgs)) {
    throw new Error(
      'Auklet build config flags cannot be used with tsdown --config, -c, or --no-config.',
    );
  }

  return {
    args: remainingArgs,
    config,
  };
}

export function createBuildEnv(config: AukletConfig) {
  if (!hasAukletConfig(config)) return undefined;
  return {
    [aukletCliConfigOverridesEnv]: encodeAukletCliConfigOverrides(config),
  };
}

const getResolvedFlagValue = (
  args: Array<string>,
  index: number,
  inlineValue: string | undefined,
  flag: string,
  envContext: AukletEnvContext,
) => {
  return resolveCliValue(readFlagValue(args, index, inlineValue, flag), {
    label: flag,
    context: envContext,
  })!;
};

const parseBuildFormats = (value: string) => {
  const formats = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!formats.length) {
    throw new Error('--build.formats requires at least one format.');
  }
  for (const format of formats) {
    if (!buildFormats.has(format)) {
      throw new Error(`Unknown build format: ${format}`);
    }
  }
  return formats as Array<PackageBuildFormat>;
};

const parseBuildPlatform = (value: string) => {
  if (!buildPlatforms.has(value)) {
    throw new Error(`Unknown build platform: ${value}`);
  }
  return value as PackageBuildPlatform;
};
