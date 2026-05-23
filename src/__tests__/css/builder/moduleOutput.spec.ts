import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { emptyStyleFileComment } from '#auklet/css/production/format/shared';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';
import { createBuilder, moduleConfig, writePackageImports } from './helpers';

describe('ModuleStyleBuilder module output', () => {
  let fixture: VirtualProject;

  beforeEach(() => {
    fixture = createVirtualProject('auklet-builder-');
    fixture.writePackageJson({ name: 'fixture-package' });
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('builds same-package module CSS entries without dependency config', async () => {
    writePackageImports(fixture);
    fixture.writeFile(
      'source/components/Renderer/index.tsx',
      `
        import { CodeBlock } from '#fixture/components/CodeBlock';
        export function Renderer() { return null; }
      `,
    );
    fixture.writeFile(
      'source/components/CodeBlock/index.tsx',
      'export function CodeBlock() { return null; }',
    );
    fixture.writeFile('source/components/Renderer/index.css', '.renderer {}');
    fixture.writeFile(
      'source/components/CodeBlock/index.css',
      '.code-block {}',
    );

    await createBuilder(fixture, moduleConfig).build();

    const esExternalStyle = fixture.readFile('output/es/style/external.css');
    const esStyleEntry = fixture.readFile('output/es/style/index.css');

    for (const format of ['es', 'lib']) {
      const rendererStyle = fixture.readFile(
        `output/${format}/components/Renderer/style/index.css`,
      );

      expect(rendererStyle).toBe(
        '@import "../../CodeBlock/style/index.css";\n' +
          '@import "../index.css";\n',
      );
    }

    expect(esExternalStyle).toBe(emptyStyleFileComment);
    expect(esStyleEntry).toBe('@import "./module.css";\n');
  });

  test('builds module CSS entries for source modules without own CSS', async () => {
    writePackageImports(fixture);
    fixture.writeFile(
      'source/components/Renderer/index.tsx',
      `
        import { CodeBlock } from '#fixture/components/CodeBlock';
        export function Renderer() { return null; }
      `,
    );
    fixture.writeFile(
      'source/components/CodeBlock/index.tsx',
      'export function CodeBlock() { return null; }',
    );
    fixture.writeFile(
      'source/components/CodeBlock/index.css',
      '.code-block {}',
    );

    await createBuilder(fixture, moduleConfig).build();

    const esRendererStyle = fixture.readFile(
      'output/es/components/Renderer/style/index.css',
    );

    expect(esRendererStyle).toBe(
      '@import "../../CodeBlock/style/index.css";\n',
    );
  });

  test('builds empty module CSS entries for second-level tsx modules without styles', async () => {
    fixture.writeFile('source/index.ts', 'export const root = true;');
    fixture.writeFile(
      'source/components/Plain/data.ts',
      'export const data = [];',
    );
    fixture.writeFile(
      'source/components/Plain/index.tsx',
      'export function Plain() { return null; }',
    );
    fixture.writeFile(
      'source/components/Plain/Part/index.tsx',
      'export function Part() { return null; }',
    );
    fixture.writeFile(
      'source/pages/AboutPage.tsx',
      'export function AboutPage() { return null; }',
    );

    await createBuilder(fixture, moduleConfig).build();

    expect(fixture.readFile('output/es/components/Plain/style/index.css')).toBe(
      emptyStyleFileComment,
    );
    expect(fixture.readFile('output/es/pages/AboutPage/style/index.css')).toBe(
      emptyStyleFileComment,
    );
    expect(
      fixture.readFile('output/lib/components/Plain/style/index.css'),
    ).toBe(emptyStyleFileComment);
    expect(fixture.readFile('output/lib/pages/AboutPage/style/index.css')).toBe(
      emptyStyleFileComment,
    );
    expect(fixture.exists('output/es/style/index.css')).toBe(false);
    expect(
      fixture.exists('output/es/components/Plain/data/style/index.css'),
    ).toBe(false);
    expect(
      fixture.exists('output/es/components/Plain/Part/style/index.css'),
    ).toBe(false);
  });

  test('writes placeholder comments for generated empty CSS files', async () => {
    fixture.writeFile('source/index.css', '');

    await createBuilder(fixture, moduleConfig).build();

    expect(fixture.readFile('output/es/index.css')).toBe(emptyStyleFileComment);
    expect(fixture.readFile('output/es/style/external.css')).toBe(
      emptyStyleFileComment,
    );
  });

  test('builds same-name style entries for flat source modules', async () => {
    writePackageImports(fixture);
    fixture.writeFile(
      'source/components/Renderer.tsx',
      `
        import { Button } from '#fixture/components/Button';
        export function Renderer() { return null; }
      `,
    );
    fixture.writeFile(
      'source/components/Button.tsx',
      'export function Button() { return null; }',
    );
    fixture.writeFile('source/components/Button.css', '.button {}');

    await createBuilder(fixture, moduleConfig).build();

    const esRendererStyle = fixture.readFile(
      'output/es/components/Renderer/style/index.css',
    );
    const esButtonStyle = fixture.readFile(
      'output/es/components/Button/style/index.css',
    );

    expect(esRendererStyle).toBe('@import "../../Button/style/index.css";\n');
    expect(esButtonStyle).toBe('@import "../../Button.css";\n');
  });
});
