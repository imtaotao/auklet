import path from 'node:path';
import type { UserConfig } from 'tsdown/config';
import { createCssModulesPlugin } from '#auklet/build/cssModulesPlugin';
import { createPackageStyleImportPlugin } from '#auklet/build/packageStyleImportPlugin';
import type {
  BuildContext,
  ConfigureTsdownOptions,
  TsdownDeps,
} from '#auklet/build/tsdown/types';

export function createCommonConfig(context: BuildContext, deps: TsdownDeps) {
  return {
    cwd: context.packageRoot,
    root: context.packageRoot,
    clean: false,
    sourcemap: false,
    tsconfig: context.tsconfig,
    target: context.target,
    platform: context.platform,
    alias: context.alias,
    deps,
    plugins: [
      createCssModulesPlugin({
        packageRoot: context.packageRoot,
        sourceRoot: path.join(context.packageRoot, context.source),
        sharedOutputPatterns: context.sharedOutputPatterns,
      }),
      createPackageStyleImportPlugin({
        packageRoot: context.packageRoot,
        sourceRoot: path.join(context.packageRoot, context.source),
      }),
    ],
    define: {
      __TEST__: 'false',
      __VERSION__: JSON.stringify(context.pkg.version),
      __DEV__:
        '(typeof process !== "undefined" ? (process.env?.NODE_ENV !== "production") : false)',
    },
  } satisfies UserConfig;
}

export function configureTsdown(
  context: BuildContext,
  config: UserConfig,
  options: ConfigureTsdownOptions,
) {
  return (
    context.configureTsdown?.(config, {
      ...options,
      packageRoot: context.packageRoot,
      output: context.output,
      packageName: context.pkg.name,
    }) ?? config
  );
}
