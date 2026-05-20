import type {
  AukletConfig,
  CssDependencyGroup,
  CssOptions,
  NormalizedAukletConfig,
  StyleDependencyGroup,
} from '#auklet/types';

export const aukletConfigFile = 'auklet.config.ts';

export const aukletDefaultCssOptions = {
  source: 'src',
  output: 'dist',
  themes: {},
} satisfies Required<Pick<CssOptions, 'source' | 'output' | 'themes'>>;

export const aukletDefaultCssDependencyConfig: CssDependencyGroup = {
  entry: '/style.css',
  components: ['/pages/**.css', '/components/**.css'],
  themes: {
    dark: '/themes/dark.css',
    light: '/themes/light.css',
  },
};

const normalizeStyleDependency = (dependency: StyleDependencyGroup) => ({
  entry: dependency.entry ?? dependency.global,
  themes: dependency.themes,
  components: dependency.components ?? dependency.component,
});

export const normalizeAukletConfig = (config: AukletConfig = {}) => {
  const dependencies =
    config.styles?.dependencies ?? config.cssDependencies ?? {};

  return {
    source: config.source ?? config.sourceDir ?? aukletDefaultCssOptions.source,

    output: config.output ?? config.outputDir ?? aukletDefaultCssOptions.output,

    build: config.build,

    modules: config.modules ?? config.build?.modules ?? false,

    styles: {
      themes:
        config.styles?.themes ??
        config.themes ??
        aukletDefaultCssOptions.themes,

      dependencies: Object.fromEntries(
        Object.entries(dependencies).map(([packageName, dependency]) => [
          packageName,
          normalizeStyleDependency(dependency),
        ]),
      ),
    },
  } satisfies NormalizedAukletConfig;
};
