import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  loadAukletConfig,
  resolveAukletConfigModule,
} from '#auklet/configLoader';
import { normalizeAukletConfig } from '#auklet/config';
import {
  createVirtualProject,
  type VirtualProject,
} from './fixtures/virtualProject';

describe('loadAukletConfig', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-options-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('returns empty config when the config file is missing', async () => {
    await expect(loadAukletConfig(project.root)).resolves.toEqual({});
  });

  test('returns empty config when the package root is missing', async () => {
    await expect(
      loadAukletConfig(project.resolve('missing-package')),
    ).resolves.toEqual({});
  });

  test('loads JavaScript auklet config as an ES module', async () => {
    project.writeFile(
      'dependency.mjs',
      `
        export const dependency = {
          entry: '/dist/dependency.css',
        };
      `,
    );
    project.writeFile(
      'auklet.config.js',
      `
        import { dependency } from './dependency.mjs';
        export const config = {
          source: 'source',
          output: 'output',
          build: {
            formats: ['esm'],
          },
          styles: {
            dependencies: {
              katex: dependency,
            },
          },
        };
      `,
    );

    await expect(
      loadAukletConfig(project.root, { cacheBust: true }),
    ).resolves.toEqual({
      source: 'source',
      output: 'output',
      build: {
        formats: ['esm'],
      },
      styles: {
        dependencies: {
          katex: {
            entry: '/dist/dependency.css',
          },
        },
      },
    });
  });

  test('loads .mjs auklet config as an ES module', async () => {
    project.writeFile(
      'auklet.config.mjs',
      `
        export const config = {
          source: 'source',
        };
      `,
    );

    await expect(loadAukletConfig(project.root)).resolves.toEqual({
      source: 'source',
    });
  });

  test('rejects multiple JavaScript config files', async () => {
    project.writeFile('auklet.config.js', 'export const config = {};');
    project.writeFile('auklet.config.mjs', 'export const config = {};');

    await expect(loadAukletConfig(project.root)).rejects.toThrow(
      'found multiple config files',
    );
  });

  test('rejects TypeScript auklet config files', async () => {
    project.writeFile('auklet.config.ts', 'export const config = {};');

    await expect(loadAukletConfig(project.root)).rejects.toThrow(
      'unsupported config file: auklet.config.ts',
    );
  });
});

describe('resolveAukletConfigModule', () => {
  test('reads config from direct named export', () => {
    expect(
      resolveAukletConfigModule({
        config: {
          source: 'src',
          output: 'dist',
        },
      }),
    ).toEqual({
      source: 'src',
      output: 'dist',
    });
  });

  test('requires a named config export', () => {
    expect(() => resolveAukletConfigModule({ default: null })).toThrow(
      'config file must export `config`',
    );
  });
});

describe('normalizeAukletConfig', () => {
  test('normalizes the grouped config shape', () => {
    expect(
      normalizeAukletConfig({
        source: 'source',
        output: 'output',
        modules: true,
        styles: {
          themes: {
            light: './source/themes/light.css',
          },
          dependencies: {
            '@scope/ui': {
              entry: '/style.css',
              components: ['/components/**.css'],
            },
          },
        },
      }),
    ).toMatchObject({
      source: 'source',
      output: 'output',
      modules: true,
      build: {
        formats: ['cjs', 'esm', 'iife'],
        target: 'es2020',
        platform: 'neutral',
      },
      styles: {
        themes: {
          light: './source/themes/light.css',
        },
        dependencies: {
          '@scope/ui': {
            entry: '/style.css',
            components: ['/components/**.css'],
          },
        },
      },
    });
  });

  test('uses default options when fields are missing', () => {
    expect(
      normalizeAukletConfig({
        source: 'source',
        output: 'output',
      }),
    ).toMatchObject({
      source: 'source',
      output: 'output',
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
    });
  });
});
