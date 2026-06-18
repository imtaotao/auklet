import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createCollectorFixture,
  emptyConfig,
  expectStyles,
  type CollectorFixture,
} from './collectorHelpers';

describe('ModuleStyleImportCollector source imports', () => {
  let fixture: CollectorFixture;

  beforeEach(() => {
    fixture = createCollectorFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('collects styles from source alias imports in the same package', () => {
    const file = fixture.writeSource(
      'components/Renderer/index.tsx',
      `
        import { CodeBlock } from '#fixture/components/CodeBlock';
        import type { Heading } from '#fixture/components/Heading';
      `,
    );
    fixture.writeComponent('components/CodeBlock');
    fixture.writeSource(
      'components/Heading.ts',
      'export type Heading = { title: string };',
    );
    fixture.writeStyles('components/Renderer/index.css');

    const entries = fixture.collectFile(file);

    expectStyles(entries, 'components/Renderer', [
      '../../CodeBlock/style/index.css',
    ]);
  });

  test('maps package imports targets to source aliases', () => {
    fixture.project.writePackageJson({
      imports: {
        '#widgets/*': {
          source: './src/widgets/*',
          import: './dist/es/widgets/*.js',
          default: './dist/es/widgets/*.js',
        },
      },
    });
    const file = fixture.writeSource(
      'components/Mdx/index.tsx',
      "import { EnglishCards } from '#widgets/components/EnglishCards';",
    );
    fixture.writeComponent('widgets/components/EnglishCards');

    const entries = fixture.collectFile(file, emptyConfig);

    expectStyles(entries, 'components/Mdx', [
      '../../../widgets/components/EnglishCards/style/index.css',
    ]);
  });

  test('collects styles from tsconfig paths in the same package', () => {
    fixture.project.writeJson('tsconfig.json', {
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '#widgets/*': ['./src/*'],
          '#content/*': ['../content/src/*'],
        },
      },
    });
    const file = fixture.writeSource(
      'components/Mdx/index.tsx',
      "import { EnglishCards } from '#widgets/components/EnglishCards';\n" +
        "import { CodeBlock } from '#content/components/CodeBlock';",
    );
    fixture.writeComponent('components/EnglishCards');

    const entries = fixture.collectFile(file, emptyConfig);

    expectStyles(entries, 'components/Mdx', [
      '../../EnglishCards/style/index.css',
    ]);
  });

  test('collects same-package styles without dependency config', () => {
    const file = fixture.writeSource(
      'components/Renderer/index.tsx',
      "import { CodeBlock } from '#fixture/components/CodeBlock';",
    );
    fixture.writeComponent('components/CodeBlock');
    fixture.writeStyles('components/Renderer/index.css');

    const entries = fixture.collectFile(file, emptyConfig);

    expectStyles(entries, 'components/Renderer', [
      '../../CodeBlock/style/index.css',
    ]);
  });

  test('collects styles from relative imports in the same package', () => {
    const file = fixture.writeSource(
      'components/Chat/index.tsx',
      "import { DetailsBlock } from '../DetailsBlock';",
    );
    fixture.writeComponent('components/DetailsBlock');
    fixture.writeStyles('components/Chat/index.css');

    const entries = fixture.collectFile(file);

    expectStyles(entries, 'components/Chat', [
      '../../DetailsBlock/style/index.css',
    ]);
  });

  test('ignores relative source imports outside the source root', () => {
    const file = fixture.writeSource(
      'components/Renderer/index.tsx',
      "import { CodeBlock } from '../../shared/CodeBlock';",
    );
    fixture.project.writeFile(
      path.join('shared', 'CodeBlock.tsx'),
      'export function CodeBlock() { return null; }',
    );
    fixture.project.writeFile(path.join('shared', 'CodeBlock.css'), '');

    const entries = fixture.collectFile(file, emptyConfig);

    expect(entries.get('components/Renderer')).toBeUndefined();
  });

  test('collects styles from same-package file modules with sibling CSS', () => {
    const file = fixture.writeSource(
      'components/Renderer/index.tsx',
      "import { Button } from '#fixture/components/Button';",
    );
    fixture.writeFileModule('components/Button.tsx');

    const entries = fixture.collectFile(file, emptyConfig);

    expectStyles(entries, 'components/Renderer', [
      '../../Button/style/index.css',
    ]);
  });

  test('collects styles from same-package file modules with transitive style imports', () => {
    const file = fixture.writeSource(
      'components/Table/index.tsx',
      "import { TableView } from '#fixture/components/Table/TableView';",
    );
    const tableViewFile = fixture.writeSource(
      'components/Table/TableView.tsx',
      "import { Spinner } from '#fixture/components/Spinner';",
    );
    const spinnerFile = fixture.writeSource(
      'components/Spinner/index.tsx',
      'export function Spinner() { return null; }',
    );
    fixture.writeStyles('components/Spinner/index.css');

    const entries = fixture.collector.collect(
      [file, tableViewFile, spinnerFile],
      emptyConfig,
    );

    expectStyles(entries, 'components/Table', ['../TableView/style/index.css']);
    expectStyles(entries, 'components/Table/TableView', [
      '../../../Spinner/style/index.css',
    ]);
  });

  test('does not treat non-tsx source modules as transitive style modules', () => {
    const file = fixture.writeSource(
      'components/A/index.tsx',
      "import { B } from '#fixture/components/B';",
    );
    const bFile = fixture.writeSource(
      'components/B.ts',
      "import { C } from '#fixture/components/C';\nexport const B = C;",
    );
    const cFile = fixture.writeSource(
      'components/C/index.tsx',
      'export function C() { return null; }',
    );
    fixture.writeStyles('components/C/index.css');

    const entries = fixture.collector.collect(
      [file, bFile, cFile],
      emptyConfig,
    );

    expect(entries.get('components/A')).toBeUndefined();
    expect(entries.get('components/B')).toBeUndefined();
  });
});
