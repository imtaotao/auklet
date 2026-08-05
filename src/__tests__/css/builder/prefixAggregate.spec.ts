import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';
import { baseConfig, createBuilder, moduleConfig } from './helpers';

describe('ModuleStyleBuilder styles.prefix aggregate', () => {
  let fixture: VirtualProject;

  beforeEach(() => {
    fixture = createVirtualProject('auklet-builder-prefix-');
    fixture.writePackageJson({ name: 'fixture-package' });
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('prefixes every own package style file in aggregate output', async () => {
    fixture.writeFile(
      'source/components/Button/index.tsx',
      'export const Button = null;',
    );
    fixture.writeFile('source/components/Button/index.css', '.button {}');
    fixture.writeFile(
      'source/components/Card/index.tsx',
      'export const Card = null;',
    );
    fixture.writeFile('source/components/Card/index.css', '.card {}');

    await createBuilder(fixture, {
      ...baseConfig,
      styles: {
        prefix: '.mf-app',
      },
    }).build();

    const packageStyle = fixture.readFile('output/index.css');

    expect(packageStyle).toContain('.mf-app .button');
    expect(packageStyle).toContain('.mf-app .card');
    expect(packageStyle).not.toContain('.mf-app .mf-app');
  });

  test('prefixes own themes and styles but not dependency CSS', async () => {
    fixture.writeFile(
      'node_modules/@scope/theme/package.json',
      JSON.stringify({ name: '@scope/theme', main: 'style.css' }),
    );
    fixture.writeFile(
      'node_modules/@scope/theme/style.css',
      '.dependency { color: purple; }',
    );
    fixture.writeFile('source/themes/light.css', '.theme { color: gold; }');
    fixture.writeFile(
      'source/components/Button/index.tsx',
      'export const Button = null;',
    );
    fixture.writeFile('source/components/Button/index.css', '.button {}');

    await createBuilder(fixture, {
      ...baseConfig,
      styles: {
        prefix: '.mf-app',
        themes: {
          light: './source/themes/light.css',
        },
        dependencies: {
          '@scope/theme': {
            entry: '/style.css',
          },
        },
      },
    }).build();

    const packageStyle = fixture.readFile('output/index.css');

    expect(packageStyle).toContain('.mf-app .theme');
    expect(packageStyle).toContain('.mf-app .button');
    expect(packageStyle).toContain('.dependency { color: purple; }');
    expect(packageStyle).not.toContain('.mf-app .dependency');
  });

  test('rejects Less imports that escape the source root when modules are disabled', async () => {
    fixture.writeFile('outside.less', '.outside { color: red; }');
    fixture.writeFile(
      'source/components/Button/index.tsx',
      'export const Button = null;',
    );
    fixture.writeFile(
      'source/components/Button/index.less',
      '@import "../../../outside.less";\n.button {}',
    );

    await expect(
      createBuilder(fixture, {
        ...baseConfig,
        styles: {
          prefix: '.mf-app',
        },
      }).build(),
    ).rejects.toThrow('[css] local CSS import escapes source root:');
  });

  test('writes prefixed Less and CSS module copies for Vite-aligned production output', async () => {
    fixture.writeFile(
      'source/components/Button/index.tsx',
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      'source/components/Button/index.less',
      '@accent: blue;\n.button { color: @accent; }',
    );
    fixture.writeFile(
      'source/components/Card/index.tsx',
      'export function Card() { return null; }',
    );
    fixture.writeFile(
      'source/components/Card/index.css',
      '.card { color: red; }',
    );

    await createBuilder(fixture, {
      ...moduleConfig,
      styles: {
        prefix: '.mf-app',
      },
    }).build();

    expect(fixture.readFile('output/es/components/Button/index.css')).toContain(
      '.mf-app .button',
    );
    expect(fixture.readFile('output/es/components/Card/index.css')).toContain(
      '.mf-app .card',
    );
    expect(fixture.readFile('output/es/style/module.css')).toContain(
      '@import "../components/Button/index.css"',
    );
    expect(fixture.readFile('output/es/style/module.css')).toContain(
      '@import "../components/Card/index.css"',
    );
  });
});
