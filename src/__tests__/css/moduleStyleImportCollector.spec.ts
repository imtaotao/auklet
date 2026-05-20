import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ModuleStyleImportCollector } from '#auklet/css/core/moduleStyleImportCollector';
import { normalizeAukletConfig } from '#auklet/config';
import type { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

const normalizedConfig = normalizeAukletConfig({
  styles: {
    dependencies: {
      '@scope/ui': {
        components: ['/pages/**.css', '/components/**.css'],
      },
    },
  },
});

const singleComponentRuleOptions = normalizeAukletConfig({
  styles: {
    dependencies: {
      '@scope/ui': {
        components: '/components/**.css',
      },
    },
  },
});

const emptyOptions = normalizeAukletConfig();

const writeSourceFile = (
  project: VirtualProject,
  relativePath: string,
  code: string,
) => {
  return project.writeFile(path.join('src', relativePath), code);
};

const writeStyleDependency = (project: VirtualProject, specifier: string) => {
  project.writeFile(path.join('styles', specifier), '');
};

const writeSourceCss = (project: VirtualProject, relativePath: string) => {
  project.writeFile(path.join('src', relativePath), '');
};

const expectCollectedStyles = (
  entries: Map<string, Array<string>>,
  moduleId: string,
  styles: Array<string>,
) => {
  expect(entries.get(moduleId)).toEqual(styles);
};

describe('ModuleStyleImportCollector', () => {
  let project: VirtualProject;
  let srcRoot: string;
  let styleRoot: string;
  let collector: ModuleStyleImportCollector;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-');
    srcRoot = project.resolve('src');
    styleRoot = project.resolve('styles');
    project.writePackageJson({
      imports: {
        '#fixture/*': './src/*.js',
      },
    });

    const resolver = {
      resolveStyleDependency(specifier: string) {
        return path.join(styleRoot, specifier);
      },
    } as WorkspaceStyleResolver;

    collector = new ModuleStyleImportCollector(srcRoot, project.root, resolver);
  });

  afterEach(() => {
    project.cleanup();
  });

  test('collects component styles from package entry named imports', () => {
    const file = writeSourceFile(
      project,
      'pages/Article.tsx',
      `
        import {
          Button,
          Dialog,
        } from '@scope/ui';
      `,
    );
    writeStyleDependency(project, '@scope/ui/components/Button.css');
    writeStyleDependency(project, '@scope/ui/components/Dialog.css');

    const entries = collector.collect([file], normalizedConfig);

    expectCollectedStyles(entries, 'pages/Article', [
      '@scope/ui/components/Button.css',
      '@scope/ui/components/Dialog.css',
    ]);
  });

  test('collects styles from a single string rule', () => {
    const file = writeSourceFile(
      project,
      'pages/Article.tsx',
      "import { Button } from '@scope/ui';",
    );
    writeStyleDependency(project, '@scope/ui/components/Button.css');

    const entries = collector.collect([file], singleComponentRuleOptions);

    expectCollectedStyles(entries, 'pages/Article', [
      '@scope/ui/components/Button.css',
    ]);
  });

  test('uses exported component names when named imports are aliased', () => {
    const file = writeSourceFile(
      project,
      'pages/Article.tsx',
      `
        import {
          Button as PrimaryButton,
        } from '@scope/ui';
      `,
    );
    writeStyleDependency(project, '@scope/ui/components/Button.css');

    const entries = collector.collect([file], normalizedConfig);

    expectCollectedStyles(entries, 'pages/Article', [
      '@scope/ui/components/Button.css',
    ]);
  });

  test('collects component styles directly from deep component imports', () => {
    const file = writeSourceFile(
      project,
      'pages/Article.tsx',
      "import { Button as PrimaryButton } from '@scope/ui/components/Button';",
    );
    writeStyleDependency(project, '@scope/ui/components/Button.css');

    const entries = collector.collect([file], normalizedConfig);

    expectCollectedStyles(entries, 'pages/Article', [
      '@scope/ui/components/Button.css',
    ]);
  });

  test('collects page styles from package entry named imports', () => {
    const file = writeSourceFile(
      project,
      'routes/App.tsx',
      "import { DashboardPage } from '@scope/ui';",
    );
    writeStyleDependency(project, '@scope/ui/pages/DashboardPage.css');

    const entries = collector.collect([file], normalizedConfig);

    expectCollectedStyles(entries, 'routes/App', [
      '@scope/ui/pages/DashboardPage.css',
    ]);
  });

  test('collects page styles directly from deep page imports', () => {
    const file = writeSourceFile(
      project,
      'routes/App.tsx',
      "import { DashboardPage } from '@scope/ui/pages/DashboardPage';",
    );
    writeStyleDependency(project, '@scope/ui/pages/DashboardPage.css');

    const entries = collector.collect([file], normalizedConfig);

    expectCollectedStyles(entries, 'routes/App', [
      '@scope/ui/pages/DashboardPage.css',
    ]);
  });

  test('collects direct styles from deep namespace imports', () => {
    const file = writeSourceFile(
      project,
      'routes/App.tsx',
      "import * as DashboardPage from '@scope/ui/pages/DashboardPage';",
    );
    writeStyleDependency(project, '@scope/ui/pages/DashboardPage.css');

    const entries = collector.collect([file], normalizedConfig);

    expectCollectedStyles(entries, 'routes/App', [
      '@scope/ui/pages/DashboardPage.css',
    ]);
  });

  test('collects direct styles from deep namespace imports regardless of rule order', () => {
    const file = writeSourceFile(
      project,
      'pages/Article.tsx',
      "import * as Button from '@scope/ui/components/Button';",
    );
    writeStyleDependency(project, '@scope/ui/components/Button.css');

    const entries = collector.collect([file], normalizedConfig);

    expectCollectedStyles(entries, 'pages/Article', [
      '@scope/ui/components/Button.css',
    ]);
  });

  test('throws for namespace imports from package entries', () => {
    const file = writeSourceFile(
      project,
      'pages/Article.tsx',
      "import * as UI from '@scope/ui';",
    );

    expect(() => collector.collect([file], normalizedConfig)).toThrow(
      'Namespace import is not supported for CSS auto import: @scope/ui',
    );
  });

  test('collects styles from source alias imports in the same package', () => {
    const file = writeSourceFile(
      project,
      'components/Renderer/index.tsx',
      `
        import { CodeBlock } from '#fixture/components/CodeBlock';
        import type { Heading } from '#fixture/components/Heading';
      `,
    );
    writeSourceFile(
      project,
      'components/CodeBlock/index.tsx',
      'export const CodeBlock = () => null;',
    );
    writeSourceFile(
      project,
      'components/Heading.ts',
      'export type Heading = { title: string };',
    );
    writeSourceCss(project, 'components/Renderer/index.css');
    writeSourceCss(project, 'components/CodeBlock/index.css');

    const entries = collector.collect([file], normalizedConfig);

    expectCollectedStyles(entries, 'components/Renderer', [
      '../../CodeBlock/style/index.css',
    ]);
  });

  test('collects same-package styles without cssDependencies', () => {
    const file = writeSourceFile(
      project,
      'components/Renderer/index.tsx',
      "import { CodeBlock } from '#fixture/components/CodeBlock';",
    );
    writeSourceFile(
      project,
      'components/CodeBlock/index.tsx',
      'export const CodeBlock = () => null;',
    );
    writeSourceCss(project, 'components/Renderer/index.css');
    writeSourceCss(project, 'components/CodeBlock/index.css');

    const entries = collector.collect([file], emptyOptions);

    expectCollectedStyles(entries, 'components/Renderer', [
      '../../CodeBlock/style/index.css',
    ]);
  });

  test('collects styles from relative imports in the same package', () => {
    const file = writeSourceFile(
      project,
      'components/Chat/index.tsx',
      "import { DetailsBlock } from '../DetailsBlock';",
    );
    writeSourceFile(
      project,
      'components/DetailsBlock/index.tsx',
      'export const DetailsBlock = () => null;',
    );
    writeSourceCss(project, 'components/Chat/index.css');
    writeSourceCss(project, 'components/DetailsBlock/index.css');

    const entries = collector.collect([file], normalizedConfig);

    expectCollectedStyles(entries, 'components/Chat', [
      '../../DetailsBlock/style/index.css',
    ]);
  });

  test('collects styles from same-package file modules with sibling CSS', () => {
    const file = writeSourceFile(
      project,
      'components/Renderer/index.tsx',
      "import { Button } from '#fixture/components/Button';",
    );
    writeSourceFile(
      project,
      'components/Button.tsx',
      'export const Button = () => null;',
    );
    writeSourceCss(project, 'components/Button.css');

    const entries = collector.collect([file], emptyOptions);

    expectCollectedStyles(entries, 'components/Renderer', [
      '../../Button/style/index.css',
    ]);
  });

  test('skips inferred component styles that do not exist', () => {
    const file = writeSourceFile(
      project,
      'pages/Article.tsx',
      "import { MissingComponent } from '@scope/ui';",
    );

    const entries = collector.collect([file], normalizedConfig);

    expect(entries.size).toBe(0);
  });

  test('does not infer styles from package entry side-effect imports', () => {
    const file = writeSourceFile(
      project,
      'pages/Article.tsx',
      "import '@scope/ui';",
    );
    writeStyleDependency(project, '@scope/ui/components/Button.css');

    const entries = collector.collect([file], normalizedConfig);

    expect(entries.size).toBe(0);
  });

  test('skips type-only imports and declaration files', () => {
    const sourceFile = writeSourceFile(
      project,
      'pages/Article.tsx',
      "import type { Button } from '@scope/ui';",
    );
    const declarationFile = writeSourceFile(
      project,
      'pages/Article.d.ts',
      "import { Dialog } from '@scope/ui';",
    );
    writeStyleDependency(project, '@scope/ui/components/Button.css');
    writeStyleDependency(project, '@scope/ui/components/Dialog.css');

    const entries = collector.collect(
      [sourceFile, declarationFile],
      normalizedConfig,
    );

    expect(entries.size).toBe(0);
  });
});
