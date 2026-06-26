import { isArray, isString } from 'aidly';

import type {
  AukletConfig,
  NormalizedAukletConfig,
  StyleDependencyGroup,
  StyleOptions,
} from '#auklet/types';

export const aukletConfigFiles = ['auklet.config.js', 'auklet.config.mjs'];

export function isAukletConfigFile(file: string) {
  return aukletConfigFiles.includes(file);
}

export const aukletDefaultOptions = {
  source: 'src',
  output: 'dist',
  modules: false,
  build: {
    formats: ['cjs', 'esm', 'iife'],
    target: 'es2020',
    platform: 'neutral',
  },
  styles: {
    themes: {},
    shared: [],
    dependencies: {},
  },
} satisfies Required<
  Pick<AukletConfig, 'source' | 'output' | 'modules' | 'build' | 'styles'>
>;

const normalizeStyleDependency = (dependency: StyleDependencyGroup) => ({
  entry: dependency.entry,
  themes: dependency.themes,
  components: dependency.components,
});

const normalizeStyleShared = (shared: StyleOptions['shared']) => {
  if (isArray(shared)) {
    for (const pattern of shared) {
      if (!isString(pattern)) {
        throw new Error(
          '[config] styles.shared must be a string or an array of strings.',
        );
      }
    }
    return shared;
  }
  if (shared && !isString(shared)) {
    throw new Error(
      '[config] styles.shared must be a string or an array of strings.',
    );
  }
  return shared ? [shared] : [];
};

export function normalizeAukletConfig(config: AukletConfig = {}) {
  const dependencies: Record<string, StyleDependencyGroup> =
    config.styles?.dependencies ?? aukletDefaultOptions.styles.dependencies;

  return {
    source: config.source ?? aukletDefaultOptions.source,

    output: config.output ?? aukletDefaultOptions.output,

    modules: config.modules ?? aukletDefaultOptions.modules,

    build: {
      ...aukletDefaultOptions.build,
      ...config.build,
    },

    styles: {
      themes: config.styles?.themes ?? aukletDefaultOptions.styles.themes,

      shared: normalizeStyleShared(
        config.styles?.shared ?? aukletDefaultOptions.styles.shared,
      ),

      dependencies: Object.fromEntries(
        Object.entries(dependencies).map(([packageName, dependency]) => [
          packageName,
          normalizeStyleDependency(dependency),
        ]),
      ),
    },
  } satisfies NormalizedAukletConfig;
}

export function defineConfig(config: AukletConfig) {
  return config;
}
