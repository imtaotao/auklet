import { isArray } from 'aidly';
import type { UserConfig } from 'tsdown/config';
import type { BuildContext, TsdownFormat } from '#auklet/build/tsdown/types';
import { getBundleEntry } from '#auklet/build/tsdown/entries';
import {
  getIifeAlwaysBundle,
  getIifeGlobals,
} from '#auklet/build/tsdown/dependencies';
import {
  configureTsdown,
  createCommonConfig,
} from '#auklet/build/tsdown/common';

const formatMap = {
  cjs: '.cjs',
  iife: '.global.js',
  esm: ['.js', '.mjs'],
};

const createBundleInputOptions = (
  context: BuildContext,
  format: TsdownFormat,
): NonNullable<UserConfig['inputOptions']> => {
  const mainFields =
    context.mainFields ??
    (format === 'iife' ? ['browser', 'module', 'main'] : undefined);

  return (options) => {
    if (!mainFields) return options;
    return {
      ...options,
      resolve: {
        ...options.resolve,
        mainFields,
      },
    };
  };
};

export function createBundleConfigs(
  context: BuildContext,
  formats: Array<TsdownFormat>,
) {
  const outputConfigs: Array<{
    format: TsdownFormat;
    extname: string;
    dts: boolean;
  }> = [];
  let hasDtsConfig = false;

  for (const format of formats) {
    const extnames = formatMap[format];
    for (const extname of isArray(extnames) ? extnames : [extnames]) {
      const emitDts: boolean = !hasDtsConfig;

      outputConfigs.push({ format, extname, dts: emitDts });
      hasDtsConfig ||= emitDts;
    }
  }

  return outputConfigs.map(({ format, extname, dts }) => {
    const deps: NonNullable<UserConfig['deps']> =
      format === 'iife'
        ? {
            neverBundle: context.peerExternal,
            alwaysBundle: getIifeAlwaysBundle(context),
            onlyBundle: false,
          }
        : {
            neverBundle: context.packageExternal,
          };

    const inputOptions =
      context.mainFields || format === 'iife'
        ? createBundleInputOptions(context, format)
        : undefined;

    return configureTsdown(
      context,
      {
        ...createCommonConfig(context, deps),
        entry: getBundleEntry(context.packageRoot, context.source),
        format,
        globalName: context.globalName,
        outDir: context.output,
        dts,
        treeshake: true,
        banner: context.banner,
        outExtensions: () => ({
          js: extname,
        }),
        outputOptions: {
          entryFileNames: `[name]${extname}`,
          chunkFileNames: `[name]-[hash]${extname}`,
          globals: format === 'iife' ? getIifeGlobals(context) : {},
        },
        inputOptions,
      },
      { kind: 'bundle', format },
    );
  }) satisfies Array<UserConfig>;
}
