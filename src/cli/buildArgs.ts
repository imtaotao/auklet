import { hasTsdownConfigArg } from '#auklet/build/runTsdown';
import {
  aukletCliConfigOverridesEnv,
  encodeAukletCliConfigOverrides,
} from '#auklet/build/cliOverrides';
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

export function resolveBuildCliArgs(args: Array<string>) {
  const remainingArgs: Array<string> = [];
  const config: AukletConfig = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const [name, inlineValue] = arg.split('=', 2);

    if (name === '--source') {
      config.source = getFlagValue(args, index, inlineValue, name);
      if (inlineValue === undefined) index += 1;
      continue;
    }

    if (name === '--output') {
      config.output = getFlagValue(args, index, inlineValue, name);
      if (inlineValue === undefined) index += 1;
      continue;
    }

    if (name === '--modules') {
      config.modules = true;
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
          getFlagValue(args, index, inlineValue, name),
        ),
      };
      if (inlineValue === undefined) index += 1;
      continue;
    }

    if (name === '--build.target') {
      config.build = {
        ...config.build,
        target: getFlagValue(args, index, inlineValue, name),
      };
      if (inlineValue === undefined) index += 1;
      continue;
    }

    if (name === '--build.platform') {
      config.build = {
        ...config.build,
        platform: parseBuildPlatform(
          getFlagValue(args, index, inlineValue, name),
        ),
      };
      if (inlineValue === undefined) index += 1;
      continue;
    }

    if (name === '--build.tsconfig') {
      config.build = {
        ...config.build,
        tsconfig: getFlagValue(args, index, inlineValue, name),
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
