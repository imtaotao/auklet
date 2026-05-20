import fs from 'node:fs';
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

  test('loads TypeScript auklet config as an ES module', async () => {
    project.writeFile(
      'dependency.mjs',
      `
        export const dependency = {
          entry: '/dist/dependency.css',
        };
      `,
    );
    project.writeFile(
      'auklet.config.ts',
      `
        import { dependency } from './dependency.mjs';
        import type { AukletConfig } from '/auklet';

        export const config: AukletConfig = {
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

  test('removes the temporary module generated for TypeScript config', async () => {
    project.writeFile(
      'auklet.config.ts',
      `
        export const config = {
          source: 'source',
        };
      `,
    );

    await loadAukletConfig(project.root, { cacheBust: true });

    expect(
      fs
        .readdirSync(project.root)
        .some(
          (file) => file.startsWith('.auklet.config.') && file.endsWith('.mjs'),
        ),
    ).toBe(false);
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

  test('falls back to empty config for unsupported module shapes', () => {
    expect(resolveAukletConfigModule({ default: null })).toEqual({});
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

  test('normalizes legacy style fields', () => {
    expect(
      normalizeAukletConfig({
        source: 'source',
        output: 'output',
        themes: {
          dark: './source/themes/dark.css',
        },
        cssDependencies: {
          '@scope/ui': {
            global: '/style.css',
            component: '/components/**.css',
          },
        },
      }),
    ).toMatchObject({
      source: 'source',
      output: 'output',
      styles: {
        themes: {
          dark: './source/themes/dark.css',
        },
        dependencies: {
          '@scope/ui': {
            entry: '/style.css',
            components: '/components/**.css',
          },
        },
      },
    });
  });

  test('normalizes legacy build modules field', () => {
    expect(
      normalizeAukletConfig({
        build: {
          modules: true,
        },
      }),
    ).toMatchObject({
      modules: true,
    });
  });
});
