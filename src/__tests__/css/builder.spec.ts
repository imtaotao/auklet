import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import postcss from 'postcss';
import { ModuleStyleBuilder } from '#auklet/css/production/builder';
import { emptyStyleFileComment } from '#auklet/css/production/format/shared';
import type { AukletConfig } from '#auklet/types';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

const baseConfig = {
  source: 'source',
  output: 'output',
} satisfies AukletConfig;

const moduleConfig = {
  ...baseConfig,
  modules: true,
} satisfies AukletConfig;

const createBuilder = (fixture: VirtualProject, aukletConfig: AukletConfig) => {
  return new ModuleStyleBuilder({
    packageRoot: fixture.root,
    aukletConfig,
  });
};

const writePackageImports = (fixture: VirtualProject) => {
  fixture.writePackageJson({
    name: 'fixture-package',
    imports: {
      '#fixture/*': './source/*.js',
    },
  });
};

const styleImports = (code: string) => {
  const imports: Array<string> = [];
  const root = postcss.parse(code);

  root.walkAtRules('import', (rule) => {
    const match = rule.params.match(/^["']([^"']+)["']/);
    if (match) imports.push(match[1]);
  });
  return imports;
};

describe('ModuleStyleBuilder', () => {
  let fixture: VirtualProject;
  let aukletConfig: AukletConfig;

  beforeEach(() => {
    fixture = createVirtualProject('auklet-builder-');
    aukletConfig = {};
    fixture.writePackageJson({ name: 'fixture-package' });
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('rewrites legacy output-format package style imports per format', async () => {
    aukletConfig = {
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
    };
    fixture.writeFile('node_modules/@scope/ui/es/style/index.css', '.esm {}');
    fixture.writeFile('node_modules/@scope/ui/lib/style/index.css', '.cjs {}');
    fixture.writeFile('source/index.css', '.local {}');

    await createBuilder(fixture, aukletConfig).build();

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

  test('builds same-package module CSS entries without dependency config', async () => {
    writePackageImports(fixture);
    aukletConfig = moduleConfig;
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

    await createBuilder(fixture, aukletConfig).build();

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
    aukletConfig = moduleConfig;
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

    await createBuilder(fixture, aukletConfig).build();

    const esRendererStyle = fixture.readFile(
      'output/es/components/Renderer/style/index.css',
    );

    expect(esRendererStyle).toBe(
      '@import "../../CodeBlock/style/index.css";\n',
    );
  });

  test('builds empty module CSS entries for second-level tsx modules without styles', async () => {
    aukletConfig = moduleConfig;
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

    await createBuilder(fixture, aukletConfig).build();

    const esPlainStyle = fixture.readFile(
      'output/es/components/Plain/style/index.css',
    );
    const esAboutPageStyle = fixture.readFile(
      'output/es/pages/AboutPage/style/index.css',
    );
    const libPlainStyle = fixture.readFile(
      'output/lib/components/Plain/style/index.css',
    );
    const libAboutPageStyle = fixture.readFile(
      'output/lib/pages/AboutPage/style/index.css',
    );

    expect(esPlainStyle).toBe(emptyStyleFileComment);
    expect(esAboutPageStyle).toBe(emptyStyleFileComment);
    expect(libPlainStyle).toBe(emptyStyleFileComment);
    expect(libAboutPageStyle).toBe(emptyStyleFileComment);
    expect(fixture.exists('output/es/style/index.css')).toBe(false);
    expect(
      fixture.exists('output/es/components/Plain/data/style/index.css'),
    ).toBe(false);
    expect(
      fixture.exists('output/es/components/Plain/Part/style/index.css'),
    ).toBe(false);
  });

  test('writes placeholder comments for generated empty CSS files', async () => {
    aukletConfig = moduleConfig;
    fixture.writeFile('source/index.css', '');

    await createBuilder(fixture, aukletConfig).build();

    expect(fixture.readFile('output/es/index.css')).toBe(emptyStyleFileComment);
    expect(fixture.readFile('output/es/style/external.css')).toBe(
      emptyStyleFileComment,
    );
  });

  test('builds same-name style entries for flat source modules', async () => {
    writePackageImports(fixture);
    aukletConfig = moduleConfig;
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

    await createBuilder(fixture, aukletConfig).build();

    const esRendererStyle = fixture.readFile(
      'output/es/components/Renderer/style/index.css',
    );
    const esButtonStyle = fixture.readFile(
      'output/es/components/Button/style/index.css',
    );

    expect(esRendererStyle).toBe('@import "../../Button/style/index.css";\n');
    expect(esButtonStyle).toBe('@import "../../Button.css";\n');
  });

  test('keeps handwritten external component CSS imports in source styles', async () => {
    aukletConfig = {
      ...moduleConfig,
      styles: {
        dependencies: {
          '@scope/ui': {
            components: '/components/**.css',
          },
        },
      },
    };
    fixture.writeFile(
      'source/components/Renderer/index.tsx',
      'export function Renderer() { return null; }',
    );
    fixture.writeFile(
      'source/components/Renderer/index.css',
      '@import "@scope/ui/components/Skeleton.css";\n.renderer {}',
    );

    await createBuilder(fixture, aukletConfig).build();

    const sourceStyle = fixture.readFile(
      'output/es/components/Renderer/index.css',
    );
    const componentEntry = fixture.readFile(
      'output/es/components/Renderer/style/index.css',
    );

    expect(styleImports(sourceStyle)).toEqual([
      '@scope/ui/components/Skeleton.css',
    ]);
    expect(styleImports(componentEntry)).toEqual(['../index.css']);
  });

  test('dedupes inferred component CSS when source CSS imports it explicitly', async () => {
    aukletConfig = {
      ...moduleConfig,
      styles: {
        dependencies: {
          '@scope/ui': {
            components: '/components/**.css',
          },
        },
      },
    };
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

    await createBuilder(fixture, aukletConfig).build();

    const sourceStyle = fixture.readFile(
      'output/es/components/Renderer/index.css',
    );
    const componentEntry = fixture.readFile(
      'output/es/components/Renderer/style/index.css',
    );
    const imports = [
      ...styleImports(sourceStyle),
      ...styleImports(componentEntry),
    ];

    expect(componentEntry).not.toContain('@scope/ui/components/Skeleton.css');
    expect(
      imports.filter(
        (specifier) => specifier === '@scope/ui/components/Skeleton.css',
      ),
    ).toHaveLength(1);
  });

  test('does not infer external component CSS without components config', async () => {
    aukletConfig = {
      ...moduleConfig,
      styles: {
        dependencies: {
          '@scope/ui': {
            entry: '/style.css',
          },
        },
      },
    };
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

    await createBuilder(fixture, aukletConfig).build();

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
    expect(styleImports(handwrittenStyle)).toEqual([
      '@scope/ui/components/Skeleton.css',
    ]);
  });

  test('builds theme entries from dependency themes without local theme files', async () => {
    aukletConfig = {
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
    };
    fixture.writeFile('source/index.css', '.local {}');

    await createBuilder(fixture, aukletConfig).build();

    expect(fixture.readFile('output/es/themes/light.css')).toBe(
      '@import "@scope/ui/themes/light.css";\n',
    );
    expect(fixture.readFile('output/lib/themes/dark.css')).toBe(
      '@import "@scope/ui/themes/dark.css";\n',
    );
    expect(fixture.exists('output/es/style/themes/light.css')).toBe(false);
  });

  test('uses process cwd as the default package root', async () => {
    fixture.writeFile('auklet.config.ts', 'export const config = {};');
    fixture.writeFile('src/index.tsx', 'export const value = 1;');
    fixture.writeFile('src/index.css', '.root { color: red; }');

    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(fixture.root);

    try {
      await new ModuleStyleBuilder().build();
    } finally {
      cwd.mockRestore();
    }

    const rootStyle = fixture.readFile('dist/index.css');

    expect(rootStyle).toContain('.root { color: red; }');
  });

  test('builds only package CSS when module output is disabled', async () => {
    aukletConfig = baseConfig;
    fixture.writeFile(
      'source/components/Button/index.tsx',
      'export const Button = null;',
    );
    fixture.writeFile('source/components/Button/index.css', '.button {}');

    await createBuilder(fixture, aukletConfig).build();

    const packageStyle = fixture.readFile('output/index.css');

    expect(packageStyle).toContain('.button {}');
    expect(fixture.exists('output/es/style/index.css')).toBe(false);
    expect(fixture.exists('output/es/components/Button/style/index.css')).toBe(
      false,
    );
    expect(fixture.exists('output/lib/style/index.css')).toBe(false);
  });
});
