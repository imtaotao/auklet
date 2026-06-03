import { hasTsdownConfigArg } from '#auklet/build/runTsdown';
import {
  aukletCliConfigOverridesEnv,
  encodeAukletCliConfigOverrides,
} from '#auklet/build/cliOverrides';
import { resolveCliBoolean, resolveCliValue } from '#auklet/cli/values';
import { AukletEnvContext } from '#auklet/env';
import type {
  AukletConfig,
  PackageBuildFormat,
  PackageBuildPlatform,
} from '#auklet/types';

const buildFormats = new Set(['cjs', 'esm', 'iife']);
const buildPlatforms = new Set(['node', 'neutral', 'browser']);

const hasAukletConfig = (config: AukletConfig) => {
  return Object.keys(config).length > 0;
};

export function resolveBuildCliArgs(
  args: Array<string>,
  envContext = new AukletEnvContext(process.cwd()),
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
      const value = getOptionalFlagValue(args, index, inlineValue);
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
          getResolvedFlagValue(args, index, inlineValue, name, envContext),
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

const getFlagValue = (
  args: Array<string>,
  index: number,
  inlineValue: string | undefined,
  flag: string,
) => {
  const value = inlineValue ?? args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
};

const getOptionalFlagValue = (
  args: Array<string>,
  index: number,
  inlineValue: string | undefined,
) => {
  if (inlineValue !== undefined) return inlineValue;

  const value = args[index + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
};

const getResolvedFlagValue = (
  args: Array<string>,
  index: number,
  inlineValue: string | undefined,
  flag: string,
  envContext: AukletEnvContext,
) => {
  return resolveCliValue(getFlagValue(args, index, inlineValue, flag), {
    label: flag,
    context: envContext,
  })!;
};

const parseBuildFormats = (value: string) => {
  const formats = value
    .split(',')
    .map((format) => format.trim())
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
