import path from 'node:path';
import type { UserConfig } from 'tsdown/config';
import type { BuildContext, TsdownFormat } from '#auklet/build/tsdown/types';
import {
  configureTsdown,
  createCommonConfig,
} from '#auklet/build/tsdown/common';
import { getModuleEntries } from '#auklet/build/tsdown/entries';

const createModuleConfig = (
  context: BuildContext,
  commonConfig: ReturnType<typeof createCommonConfig>,
  entry: Record<string, string>,
  format: Extract<TsdownFormat, 'cjs' | 'esm'>,
  outDir: string,
) => {
  return configureTsdown(
    context,
    {
      ...commonConfig,
      entry,
      format,
      outDir,
      dts: true,
      unbundle: true,
      outExtensions: () => ({
        js: '.js',
        dts: '.d.ts',
      }),
    },
    { kind: 'module', format },
  ) satisfies UserConfig;
};

export function createModuleConfigs(context: BuildContext) {
  const entry = getModuleEntries(context.packageRoot, context.source);
  const moduleDeps = {
    neverBundle: context.packageExternal,
  };

  return [
    createModuleConfig(
      context,
      createCommonConfig(context, moduleDeps),
      entry,
      'esm',
      path.join(context.output, 'es'),
    ),
    createModuleConfig(
      context,
      createCommonConfig(context, moduleDeps),
      entry,
      'cjs',
      path.join(context.output, 'lib'),
    ),
  ] satisfies Array<UserConfig>;
}
