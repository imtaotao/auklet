import { isArray, isPlainObject, isString } from 'aidly';

import type {
  AukletConfig,
  NormalizedAukletConfig,
  NormalizedStyleShared,
  StyleDependencyGroup,
  StyleOptions,
  StyleSharedOptions,
} from '#auklet/types';

export const aukletConfigFiles = ['auklet.config.js', 'auklet.config.mjs'];

export function isAukletConfigFile(file: string) {
  return aukletConfigFiles.includes(file);
}

export const aukletDefaultOptions = {
  debug: false,
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
    shared: {
      inner: [],
      output: [],
    },
    dependencies: {},
  },
} satisfies Required<
  Pick<
    AukletConfig,
    'debug' | 'source' | 'output' | 'modules' | 'build' | 'styles'
  >
>;

const SHARED_OBJECT_ERROR =
  '[config] styles.shared must be an object: { inner?, output? }.';

const normalizeStyleDependency = (dependency: StyleDependencyGroup) => ({
  entry: dependency.entry,
  themes: dependency.themes,
  components: dependency.components,
});

const normalizeSharedPatterns = (
  patterns: string | Array<string> | undefined,
  field: 'inner' | 'output',
) => {
  if (patterns == null) return [];
  if (isString(patterns)) return [patterns];
  if (!isArray(patterns)) {
    throw new Error(
      `[config] styles.shared.${field} must be a string or an array of strings.`,
    );
  }
  for (const pattern of patterns) {
    if (!isString(pattern)) {
      throw new Error(
        `[config] styles.shared.${field} must be a string or an array of strings.`,
      );
    }
  }
  return patterns;
};

const normalizeStyleShared = (
  shared: StyleOptions['shared'],
): NormalizedStyleShared => {
  if (shared == null) {
    return { inner: [], output: [] };
  }
  if (!isPlainObject(shared)) {
    throw new Error(SHARED_OBJECT_ERROR);
  }
  const objectShared = shared as StyleSharedOptions;
  const allowedKeys = new Set(['inner', 'output']);
  for (const key of Object.keys(objectShared)) {
    if (!allowedKeys.has(key)) {
      throw new Error(SHARED_OBJECT_ERROR);
    }
  }
  return {
    inner: normalizeSharedPatterns(objectShared.inner, 'inner'),
    output: normalizeSharedPatterns(objectShared.output, 'output'),
  };
};

const normalizeStylePrefix = (prefix: StyleOptions['prefix']) => {
  if (prefix == null || prefix === '') return undefined;
  if (!isString(prefix)) {
    throw new Error('[config] styles.prefix must be a string.');
  }
  return prefix;
};

export function normalizeAukletConfig(config: AukletConfig = {}) {
  const dependencies: Record<string, StyleDependencyGroup> =
    config.styles?.dependencies ?? aukletDefaultOptions.styles.dependencies;

  return {
    debug: config.debug ?? aukletDefaultOptions.debug,

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

      prefix: normalizeStylePrefix(config.styles?.prefix),

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
