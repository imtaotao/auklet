import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createCollectorFixture,
  defaultConfig,
  expectNoStyles,
  expectStyles,
  type CollectorFixture,
} from './collectorHelpers';

describe('ModuleStyleImportCollector syntax boundaries', () => {
  let fixture: CollectorFixture;

  beforeEach(() => {
    fixture = createCollectorFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('throws for export-all declarations', () => {
    const file = fixture.writeSource(
      'pages/Article.tsx',
      "export * from '@scope/ui/components/Button';",
    );
    fixture.writeDeps('@scope/ui/components/Button.css');

    expect(() => fixture.collector.collect([file], defaultConfig)).toThrow(
      'Export-all declarations are not supported for CSS auto import: @scope/ui/components/Button',
    );
  });

  test('throws for namespace imports from package entries', () => {
    const file = fixture.writeSource(
      'pages/Article.tsx',
      "import * as UI from '@scope/ui';",
    );

    expect(() => fixture.collector.collect([file], defaultConfig)).toThrow(
      'Namespace import is not supported for CSS auto import: @scope/ui',
    );
  });

  test('does not infer styles from package entry side-effect imports', () => {
    fixture.writeDeps('@scope/ui/components/Button.css');

    const entries = fixture.collectSource(
      'pages/Article.tsx',
      "import '@scope/ui';",
    );

    expectNoStyles(entries);
  });

  test('infers styles from deep component side-effect imports', () => {
    fixture.writeDeps('@scope/ui/components/Button.css');

    const entries = fixture.collectSource(
      'pages/Article.tsx',
      "import '@scope/ui/components/Button';",
    );

    expectStyles(entries, 'pages/Article', ['@scope/ui/components/Button.css']);
  });

  test('skips type-only imports and non-tsx files', () => {
    const sourceFile = fixture.writeSource(
      'pages/Article.tsx',
      "import type { Button } from '@scope/ui';",
    );
    const tsFile = fixture.writeSource(
      'pages/Article.ts',
      "import { Dialog } from '@scope/ui';",
    );
    const declarationFile = fixture.writeSource(
      'pages/Article.d.ts',
      "import { Dialog } from '@scope/ui';",
    );
    fixture.writeDeps(
      '@scope/ui/components/Button.css',
      '@scope/ui/components/Dialog.css',
    );

    const entries = fixture.collector.collect(
      [sourceFile, tsFile, declarationFile],
      defaultConfig,
    );

    expectNoStyles(entries);
  });
});
