import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  loadAukletConfig,
  resolveAukletConfigModule,
} from '#auklet/configLoader';
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
          global: '/dist/dependency.css',
        };
      `,
    );
    project.writeFile(
      'auklet.config.ts',
      `
        import { dependency } from './dependency.mjs';
        import type { AukletConfig } from '/auklet';

        export const config: AukletConfig = {
          sourceDir: 'source',
          outputDir: 'output',
          build: {
            formats: ['esm'],
          },
          cssDependencies: {
            katex: dependency,
          },
        };
      `,
    );

    await expect(
      loadAukletConfig(project.root, { cacheBust: true }),
    ).resolves.toEqual({
      sourceDir: 'source',
      outputDir: 'output',
      build: {
        formats: ['esm'],
      },
      cssDependencies: {
        katex: {
          global: '/dist/dependency.css',
        },
      },
    });
  });

  test('removes the temporary module generated for TypeScript config', async () => {
    project.writeFile(
      'auklet.config.ts',
      `
        export const config = {
          sourceDir: 'source',
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
          sourceDir: 'src',
          outputDir: 'dist',
        },
      }),
    ).toEqual({
      sourceDir: 'src',
      outputDir: 'dist',
    });
  });

  test('falls back to empty config for unsupported module shapes', () => {
    expect(resolveAukletConfigModule({ default: null })).toEqual({});
  });
});
