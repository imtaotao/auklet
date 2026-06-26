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

  test('inlines configured same-package shared CSS into component outputs and dedupes aggregates', async () => {
    fixture.writeFile(
      'source/internal/syntaxHighlight.css',
      '@import "./tokens.css";\n.syntax-highlight { color: var(--syntax-text); }',
    );
    fixture.writeFile(
      'source/internal/tokens.css',
      '.syntax-token { color: red; }',
    );
    fixture.writeFile(
      'source/components/CodeBlock/index.tsx',
      'export function CodeBlock() { return null; }',
    );
    fixture.writeFile(
      'source/components/DiffViewer/index.tsx',
      'export function DiffViewer() { return null; }',
    );
    fixture.writeFile(
      'source/components/CodeBlock/index.css',
      '@import "./base.css";\n@import "../../internal/syntaxHighlight.css";\n.code-block {}',
    );
    fixture.writeFile(
      'source/components/CodeBlock/base.css',
      '.code-block-base {}',
    );
    fixture.writeFile(
      'source/components/DiffViewer/index.css',
      '@import "../../internal/syntaxHighlight.css";\n.diff-viewer {}',
    );

    await createBuilder(fixture, {
      ...moduleConfig,
      styles: {
        shared: './source/internal/syntaxHighlight.css',
      },
    }).build();

    const packageStyle = fixture.readFile('output/index.css');
    const moduleStyle = fixture.readFile('output/es/style/module.css');
    const codeBlockStyle = fixture.readFile(
      'output/es/components/CodeBlock/index.css',
    );
    const diffViewerStyle = fixture.readFile(
      'output/es/components/DiffViewer/index.css',
    );
    const codeBlockEntry = fixture.readFile(
      'output/es/components/CodeBlock/style/index.css',
    );

    expect(codeBlockStyle).toContain('.syntax-highlight');
    expect(codeBlockStyle).toContain('.syntax-token');
    expect(codeBlockStyle).toContain('.code-block');
    expect(codeBlockStyle).toContain('@import "./base.css"');
    expect(codeBlockStyle).not.toContain('.code-block-base');
    expect(codeBlockStyle).not.toContain(
      '@import "../../internal/syntaxHighlight.css"',
    );
    expect(codeBlockStyle).not.toContain('@import "./tokens.css"');
    expect(diffViewerStyle).toContain('.syntax-highlight');
    expect(diffViewerStyle).toContain('.syntax-token');
    expect(diffViewerStyle).toContain('.diff-viewer');
    expect(diffViewerStyle).not.toContain(
      '@import "../../internal/syntaxHighlight.css"',
    );
    expect(codeBlockEntry).toBe('@import "../index.css";\n');
    expect(packageStyle.match(/\.syntax-highlight/g)).toHaveLength(1);
    expect(packageStyle.match(/\.syntax-token/g)).toHaveLength(1);
    expect(moduleStyle.match(/\.syntax-highlight/g)).toHaveLength(1);
    expect(moduleStyle.match(/\.syntax-token/g)).toHaveLength(1);
    expect(
      fixture.exists('output/es/internal/syntaxHighlight/style/index.css'),
    ).toBe(false);
    expect(fixture.exists('output/es/internal/tokens/style/index.css')).toBe(
      false,
    );
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

  test('builds parent module CSS entries with nested file module dependencies', async () => {
    writePackageImports(fixture);
    fixture.writeFile(
      'source/components/Table/index.tsx',
      `
        import { TableView } from '#fixture/components/Table/TableView';
        export function Table() { return TableView; }
      `,
    );
    fixture.writeFile(
      'source/components/Table/TableView.tsx',
      `
        import { EmptyState } from '#fixture/components/EmptyState';
        import { Spinner } from '#fixture/components/Spinner';
        export function TableView() { return EmptyState ?? Spinner; }
      `,
    );
    fixture.writeFile(
      'source/components/EmptyState/index.tsx',
      'export function EmptyState() { return null; }',
    );
    fixture.writeFile(
      'source/components/Spinner/index.tsx',
      'export function Spinner() { return null; }',
    );
    fixture.writeFile('source/components/Table/index.css', '.table {}');
    fixture.writeFile(
      'source/components/EmptyState/index.css',
      '.empty-state {}',
    );
    fixture.writeFile('source/components/Spinner/index.css', '.spinner {}');

    await createBuilder(fixture, moduleConfig).build();

    const tableStyle = fixture.readFile(
      'output/es/components/Table/style/index.css',
    );
    const tableViewStyle = fixture.readFile(
      'output/es/components/Table/TableView/style/index.css',
    );

    expect(tableStyle).toBe(
      '@import "../TableView/style/index.css";\n' + '@import "../index.css";\n',
    );
    expect(tableViewStyle).toBe(
      '@import "../../../EmptyState/style/index.css";\n' +
        '@import "../../../Spinner/style/index.css";\n',
    );
  });

  test('does not create CSS import cycles for circular source imports', async () => {
    writePackageImports(fixture);
    fixture.writeFile(
      'source/components/A/index.tsx',
      `
        import { B } from '#fixture/components/B';
        export function A() { return B; }
      `,
    );
    fixture.writeFile(
      'source/components/B/index.tsx',
      `
        import { A } from '#fixture/components/A';
        export function B() { return A; }
      `,
    );
    fixture.writeFile('source/components/A/index.css', '.a {}');

    await createBuilder(fixture, moduleConfig).build();

    const aStyle = fixture.readFile('output/es/components/A/style/index.css');
    const bStyle = fixture.readFile('output/es/components/B/style/index.css');

    expect(aStyle).toBe('@import "../index.css";\n');
    expect(bStyle).toBe('@import "../../A/style/index.css";\n');
  });

  test('keeps one source import direction when circular imports both have own CSS', async () => {
    writePackageImports(fixture);
    fixture.writeFile(
      'source/components/A/index.tsx',
      `
        import { B } from '#fixture/components/B';
        export function A() { return B; }
      `,
    );
    fixture.writeFile(
      'source/components/B/index.tsx',
      `
        import { A } from '#fixture/components/A';
        export function B() { return A; }
      `,
    );
    fixture.writeFile('source/components/A/index.css', '.a {}');
    fixture.writeFile('source/components/B/index.css', '.b {}');

    await createBuilder(fixture, moduleConfig).build();

    const aStyle = fixture.readFile('output/es/components/A/style/index.css');
    const bStyle = fixture.readFile('output/es/components/B/style/index.css');

    expect(aStyle).toBe(
      '@import "../../B/style/index.css";\n' + '@import "../index.css";\n',
    );
    expect(bStyle).toBe('@import "../index.css";\n');
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
