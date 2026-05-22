import type { UserConfig } from 'tsdown/config';
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
