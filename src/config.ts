import type {
  AukletConfig,
  NormalizedAukletConfig,
  StyleDependencyGroup,
} from '#auklet/types';

export const aukletConfigFile = 'auklet.config.ts';

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
    dependencies: {},
  },
} satisfies Required<
  Pick<AukletConfig, 'source' | 'output' | 'modules' | 'build' | 'styles'>
>;

export const aukletDefaultStyleDependencyConfig: StyleDependencyGroup = {
  entry: '/style.css',
  components: ['/pages/**.css', '/components/**.css'],
  themes: {
    dark: '/themes/dark.css',
    light: '/themes/light.css',
  },
};

const normalizeStyleDependency = (dependency: StyleDependencyGroup) => ({
  entry: dependency.entry,
  themes: dependency.themes,
  components: dependency.components,
});

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

      dependencies: Object.fromEntries(
        Object.entries(dependencies).map(([packageName, dependency]) => [
          packageName,
          normalizeStyleDependency(dependency),
        ]),
      ),
    },
  } satisfies NormalizedAukletConfig;
}
