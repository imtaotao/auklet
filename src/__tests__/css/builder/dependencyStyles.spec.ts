import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { emptyStyleFileComment } from '#auklet/css/production/format/shared';
import { collectStyleImports } from '../../fixtures/styleStructure';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';
import { createBuilder, moduleConfig } from './helpers';

describe('ModuleStyleBuilder dependency styles', () => {
  let fixture: VirtualProject;

  beforeEach(() => {
    fixture = createVirtualProject('auklet-builder-');
    fixture.writePackageJson({ name: 'fixture-package' });
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('rewrites legacy output-format package style imports per format', async () => {
    fixture.writeFile('node_modules/@scope/ui/es/style/index.css', '.esm {}');
    fixture.writeFile('node_modules/@scope/ui/lib/style/index.css', '.cjs {}');
    fixture.writeFile('source/index.css', '.local {}');

    await createBuilder(fixture, {
      source: 'source',
      output: 'output',
      styles: {
        dependencies: {
          '@scope/ui': {
            entry: '/es/style/index.css',
          },
        },
      },
      modules: true,
    }).build();

    const esExternalStyle = fixture.readFile('output/es/style/external.css');
    const libExternalStyle = fixture.readFile('output/lib/style/external.css');
    const esStyleEntry = fixture.readFile('output/es/style/index.css');
    const esModuleStyle = fixture.readFile('output/es/style/module.css');

    expect(esExternalStyle).toBe(
      '@import "@scope/ui/es/style/external.css";\n',
    );
    expect(libExternalStyle).toBe(
      '@import "@scope/ui/lib/style/external.css";\n',
    );
    expect(esStyleEntry).toBe(
      '@import "@scope/ui/es/style/index.css";\n@import "./module.css";\n',
    );
    expect(esModuleStyle).toBe('.local {}\n');
  });

  test('keeps handwritten external component CSS imports in source styles', async () => {
    fixture.writeFile(
      'source/components/Renderer/index.tsx',
      'export function Renderer() { return null; }',
    );
    fixture.writeFile(
      'source/components/Renderer/index.css',
      '@import "@scope/ui/components/Skeleton.css";\n.renderer {}',
    );

    await createBuilder(fixture, {
      ...moduleConfig,
      styles: {
        dependencies: {
          '@scope/ui': {
            components: '/components/**.css',
          },
        },
      },
    }).build();

    const sourceStyle = fixture.readFile(
      'output/es/components/Renderer/index.css',
    );
    const componentEntry = fixture.readFile(
      'output/es/components/Renderer/style/index.css',
    );

    expect(collectStyleImports(sourceStyle)).toEqual([
      '@scope/ui/components/Skeleton.css',
    ]);
    expect(collectStyleImports(componentEntry)).toEqual(['../index.css']);
  });

  test('dedupes inferred component CSS when source CSS imports it explicitly', async () => {
    fixture.writeFile(
      'source/components/Renderer/index.tsx',
      "import { Skeleton } from '@scope/ui/components/Skeleton';\n" +
        'export function Renderer() { return null; }',
    );
    fixture.writeFile(
      'source/components/Renderer/index.css',
      '@import "@scope/ui/components/Skeleton.css";\n.renderer {}',
    );
    fixture.writeFile('node_modules/@scope/ui/components/Skeleton.css', '');

    await createBuilder(fixture, {
      ...moduleConfig,
      styles: {
        dependencies: {
          '@scope/ui': {
            components: '/components/**.css',
          },
        },
      },
    }).build();

    const sourceStyle = fixture.readFile(
      'output/es/components/Renderer/index.css',
    );
    const componentEntry = fixture.readFile(
      'output/es/components/Renderer/style/index.css',
    );
    const imports = [
      ...collectStyleImports(sourceStyle),
      ...collectStyleImports(componentEntry),
    ];

    expect(componentEntry).not.toContain('@scope/ui/components/Skeleton.css');
    expect(
      imports.filter(
        (specifier) => specifier === '@scope/ui/components/Skeleton.css',
      ),
    ).toHaveLength(1);
  });

  test('builds parent module CSS entries with nested external component dependencies', async () => {
    fixture.writeFile(
      'source/components/Table/index.tsx',
      `
        import { TableView } from './TableView';
        export function Table() { return TableView; }
      `,
    );
    fixture.writeFile(
      'source/components/Table/TableView.tsx',
      `
        import { Spinner } from '@scope/ui';
        export function TableView() { return Spinner; }
      `,
    );
    fixture.writeFile('source/components/Table/index.css', '.table {}');
    fixture.writeFile('node_modules/@scope/ui/components/Spinner.css', '');

    await createBuilder(fixture, {
      ...moduleConfig,
      styles: {
        dependencies: {
          '@scope/ui': {
            components: '/components/**.css',
          },
        },
      },
    }).build();

    const tableStyle = fixture.readFile(
      'output/es/components/Table/style/index.css',
    );
    const tableViewStyle = fixture.readFile(
      'output/es/components/Table/TableView/style/index.css',
    );

    expect(collectStyleImports(tableStyle)).toEqual([
      '../TableView/style/index.css',
      '../index.css',
    ]);
    expect(collectStyleImports(tableViewStyle)).toEqual([
      '@scope/ui/components/Spinner.css',
    ]);
  });

  test('does not infer external component CSS without components config', async () => {
    fixture.writeFile('node_modules/@scope/ui/style.css', '');
    fixture.writeFile('node_modules/@scope/ui/components/Skeleton.css', '');
    fixture.writeFile(
      'source/components/RootImport/index.tsx',
      "import { Skeleton } from '@scope/ui';\n" +
        'export function RootImport() { return null; }',
    );
    fixture.writeFile(
      'source/components/DeepImport/index.tsx',
      "import { Skeleton } from '@scope/ui/components/Skeleton';\n" +
        'export function DeepImport() { return null; }',
    );
    fixture.writeFile(
      'source/components/Handwritten/index.tsx',
      'export function Handwritten() { return null; }',
    );
    fixture.writeFile(
      'source/components/Handwritten/index.css',
      '@import "@scope/ui/components/Skeleton.css";\n.handwritten {}',
    );

    await createBuilder(fixture, {
      ...moduleConfig,
      styles: {
        dependencies: {
          '@scope/ui': {
            entry: '/style.css',
          },
        },
      },
    }).build();

    const rootImportEntry = fixture.readFile(
      'output/es/components/RootImport/style/index.css',
    );
    const deepImportEntry = fixture.readFile(
      'output/es/components/DeepImport/style/index.css',
    );
    const handwrittenStyle = fixture.readFile(
      'output/es/components/Handwritten/index.css',
    );

    expect(rootImportEntry).toBe(emptyStyleFileComment);
    expect(deepImportEntry).toBe(emptyStyleFileComment);
    expect(collectStyleImports(handwrittenStyle)).toEqual([
      '@scope/ui/components/Skeleton.css',
    ]);
  });

  test('builds theme entries from dependency themes without local theme files', async () => {
    fixture.writeFile('source/index.css', '.local {}');

    await createBuilder(fixture, {
      ...moduleConfig,
      styles: {
        dependencies: {
          '@scope/ui': {
            themes: {
              light: '/themes/light.css',
              dark: '/themes/dark.css',
            },
          },
        },
      },
    }).build();

    expect(fixture.readFile('output/es/themes/light.css')).toBe(
      '@import "@scope/ui/themes/light.css";\n',
    );
    expect(fixture.readFile('output/lib/themes/dark.css')).toBe(
      '@import "@scope/ui/themes/dark.css";\n',
    );
    expect(fixture.exists('output/es/style/themes/light.css')).toBe(false);
  });
});
