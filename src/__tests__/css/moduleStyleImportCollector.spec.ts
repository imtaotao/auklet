import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ModuleStyleImportCollector } from '#auklet/css/core/styleImports/collector';
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

const writeSourceStyle = (project: VirtualProject, relativePath: string) => {
  project.writeFile(path.join('src', relativePath), '');
};

const expectCollectedStyles = (
  entries: Map<string, Array<string>>,
  moduleId: string,
  styles: Array<string>,
) => {
  expect(entries.get(moduleId)).toEqual(styles);
};

type CollectCase = {
  name: string;
  sourcePath: string;
  code: string;
  dependencies: Array<string>;
  moduleId: string;
  expected: Array<string>;
  config?: typeof normalizedConfig;
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

  const writeStyleDependencies = (...specifiers: Array<string>) => {
    for (const specifier of specifiers) {
      writeStyleDependency(project, specifier);
    }
  };

  const writeSourceStyles = (...relativePaths: Array<string>) => {
    for (const relativePath of relativePaths) {
      writeSourceStyle(project, relativePath);
    }
  };

  const writeComponent = (sourceDir: string) => {
    const componentName = path.basename(sourceDir);
    writeSourceFile(
      project,
      `${sourceDir}/index.tsx`,
      `export function ${componentName}() { return null; }`,
    );
    writeSourceStyles(`${sourceDir}/index.css`);
  };

  const writeFileModule = (sourcePath: string) => {
    const moduleName = path.basename(sourcePath, path.extname(sourcePath));
    writeSourceFile(
      project,
      sourcePath,
      `export function ${moduleName}() { return null; }`,
    );
    writeSourceStyles(sourcePath.replace(/\.[^.]+$/, '.css'));
  };

  const collectSource = (
    sourcePath: string,
    code: string,
    config = normalizedConfig,
  ) => {
    const file = writeSourceFile(project, sourcePath, code);
    return collectFile(file, config);
  };

  const collectFile = (file: string, config = normalizedConfig) => {
    return collector.collect([file], config);
  };

  const expectNoStyles = (entries: Map<string, Array<string>>) => {
    expect(entries.size).toBe(0);
  };

  const expectCollectCase = (item: CollectCase) => {
    writeStyleDependencies(...item.dependencies);
    const entries = collectSource(
      item.sourcePath,
      item.code,
      item.config ?? normalizedConfig,
    );

    expectCollectedStyles(entries, item.moduleId, item.expected);
  };

  const externalStyleCases: Array<CollectCase> = [
    {
      name: 'collects component styles from package entry named imports',
      sourcePath: 'pages/Article.tsx',
      code: "import { Button, Dialog } from '@scope/ui';",
      dependencies: [
        '@scope/ui/components/Button.css',
        '@scope/ui/components/Dialog.css',
      ],
      moduleId: 'pages/Article',
      expected: [
        '@scope/ui/components/Button.css',
        '@scope/ui/components/Dialog.css',
      ],
    },
    {
      name: 'collects styles from a single string rule',
      sourcePath: 'pages/Article.tsx',
      code: "import { Button } from '@scope/ui';",
      dependencies: ['@scope/ui/components/Button.css'],
      moduleId: 'pages/Article',
      expected: ['@scope/ui/components/Button.css'],
      config: singleComponentRuleOptions,
    },
    {
      name: 'uses exported component names when named imports are aliased',
      sourcePath: 'pages/Article.tsx',
      code: "import { Button as PrimaryButton } from '@scope/ui';",
      dependencies: ['@scope/ui/components/Button.css'],
      moduleId: 'pages/Article',
      expected: ['@scope/ui/components/Button.css'],
    },
    {
      name: 'collects component styles directly from deep component imports',
      sourcePath: 'pages/Article.tsx',
      code: "import { Button as PrimaryButton } from '@scope/ui/components/Button';",
      dependencies: ['@scope/ui/components/Button.css'],
      moduleId: 'pages/Article',
      expected: ['@scope/ui/components/Button.css'],
    },
    {
      name: 'collects page styles from package entry named imports',
      sourcePath: 'routes/App.tsx',
      code: "import { DashboardPage } from '@scope/ui';",
      dependencies: ['@scope/ui/pages/DashboardPage.css'],
      moduleId: 'routes/App',
      expected: ['@scope/ui/pages/DashboardPage.css'],
    },
    {
      name: 'collects page styles directly from deep page imports',
      sourcePath: 'routes/App.tsx',
      code: "import { DashboardPage } from '@scope/ui/pages/DashboardPage';",
      dependencies: ['@scope/ui/pages/DashboardPage.css'],
      moduleId: 'routes/App',
      expected: ['@scope/ui/pages/DashboardPage.css'],
    },
    {
      name: 'collects direct styles from deep namespace imports',
      sourcePath: 'routes/App.tsx',
      code: "import * as DashboardPage from '@scope/ui/pages/DashboardPage';",
      dependencies: ['@scope/ui/pages/DashboardPage.css'],
      moduleId: 'routes/App',
      expected: ['@scope/ui/pages/DashboardPage.css'],
    },
    {
      name: 'collects direct styles from deep namespace imports regardless of rule order',
      sourcePath: 'pages/Article.tsx',
      code: "import * as Button from '@scope/ui/components/Button';",
      dependencies: ['@scope/ui/components/Button.css'],
      moduleId: 'pages/Article',
      expected: ['@scope/ui/components/Button.css'],
    },
    {
      name: 'collects component styles from package entry named re-exports',
      sourcePath: 'pages/Article.tsx',
      code: "export { Button as PrimaryButton } from '@scope/ui';",
      dependencies: ['@scope/ui/components/Button.css'],
      moduleId: 'pages/Article',
      expected: ['@scope/ui/components/Button.css'],
    },
    {
      name: 'collects direct styles from deep named re-exports',
      sourcePath: 'pages/Article.tsx',
      code: "export { Button } from '@scope/ui/components/Button';",
      dependencies: ['@scope/ui/components/Button.css'],
      moduleId: 'pages/Article',
      expected: ['@scope/ui/components/Button.css'],
    },
    {
      name: 'resolves local re-exports through import bindings',
      sourcePath: 'pages/Article.tsx',
      code: `
        import { Button as BaseButton } from '@scope/ui';
        export { BaseButton as Button };
      `,
      dependencies: ['@scope/ui/components/Button.css'],
      moduleId: 'pages/Article',
      expected: ['@scope/ui/components/Button.css'],
    },
  ];

  for (const item of externalStyleCases) {
    test(item.name, () => {
      expectCollectCase(item);
    });
  }

  test('throws when a local re-export cannot be resolved', () => {
    const file = writeSourceFile(
      project,
      'pages/Article.tsx',
      'export { MissingButton };',
    );

    expect(() => collector.collect([file], normalizedConfig)).toThrow(
      'Unable to resolve exported symbol "MissingButton"',
    );
  });

  test('throws for export-all declarations', () => {
    const file = writeSourceFile(
      project,
      'pages/Article.tsx',
      "export * from '@scope/ui/components/Button';",
    );
    writeStyleDependencies('@scope/ui/components/Button.css');

    expect(() => collector.collect([file], normalizedConfig)).toThrow(
      'Export-all declarations are not supported for CSS auto import: @scope/ui/components/Button',
    );
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
    writeComponent('components/CodeBlock');
    writeSourceFile(
      project,
      'components/Heading.ts',
      'export type Heading = { title: string };',
    );
    writeSourceStyles('components/Renderer/index.css');

    const entries = collectFile(file);

    expectCollectedStyles(entries, 'components/Renderer', [
      '../../CodeBlock/style/index.css',
    ]);
  });

  test('maps package imports targets to source aliases', () => {
    project.writePackageJson({
      imports: {
        '#widgets/*': {
          source: './src/widgets/*',
          import: './dist/es/widgets/*.js',
          default: './dist/es/widgets/*.js',
        },
      },
    });
    const file = writeSourceFile(
      project,
      'components/Mdx/index.tsx',
      "import { EnglishCards } from '#widgets/components/EnglishCards';",
    );
    writeComponent('widgets/components/EnglishCards');

    const entries = collectFile(file, emptyOptions);

    expectCollectedStyles(entries, 'components/Mdx', [
      '../../../widgets/components/EnglishCards/style/index.css',
    ]);
  });

  test('collects styles from tsconfig paths in the same package', () => {
    project.writeJson('tsconfig.json', {
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '#widgets/*': ['./src/*'],
          '#content/*': ['../content/src/*'],
        },
      },
    });
    const file = writeSourceFile(
      project,
      'components/Mdx/index.tsx',
      "import { EnglishCards } from '#widgets/components/EnglishCards';\n" +
        "import { CodeBlock } from '#content/components/CodeBlock';",
    );
    writeComponent('components/EnglishCards');

    const entries = collectFile(file, emptyOptions);

    expectCollectedStyles(entries, 'components/Mdx', [
      '../../EnglishCards/style/index.css',
    ]);
  });

  test('collects same-package styles without dependency config', () => {
    const file = writeSourceFile(
      project,
      'components/Renderer/index.tsx',
      "import { CodeBlock } from '#fixture/components/CodeBlock';",
    );
    writeComponent('components/CodeBlock');
    writeSourceStyles('components/Renderer/index.css');

    const entries = collectFile(file, emptyOptions);

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
    writeComponent('components/DetailsBlock');
    writeSourceStyles('components/Chat/index.css');

    const entries = collectFile(file);

    expectCollectedStyles(entries, 'components/Chat', [
      '../../DetailsBlock/style/index.css',
    ]);
  });

  test('ignores relative source imports outside the source root', () => {
    const file = writeSourceFile(
      project,
      'components/Renderer/index.tsx',
      "import { CodeBlock } from '../../shared/CodeBlock';",
    );
    project.writeFile(
      path.join('shared', 'CodeBlock.tsx'),
      'export function CodeBlock() { return null; }',
    );
    project.writeFile(path.join('shared', 'CodeBlock.css'), '');

    const entries = collectFile(file, emptyOptions);

    expect(entries.get('components/Renderer')).toBeUndefined();
  });

  test('collects styles from same-package file modules with sibling CSS', () => {
    const file = writeSourceFile(
      project,
      'components/Renderer/index.tsx',
      "import { Button } from '#fixture/components/Button';",
    );
    writeFileModule('components/Button.tsx');

    const entries = collectFile(file, emptyOptions);

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

    const entries = collectFile(file);

    expectNoStyles(entries);
  });

  test('does not infer styles from package entry side-effect imports', () => {
    const file = writeSourceFile(
      project,
      'pages/Article.tsx',
      "import '@scope/ui';",
    );
    writeStyleDependencies('@scope/ui/components/Button.css');

    const entries = collectFile(file);

    expectNoStyles(entries);
  });

  test('skips type-only imports and non-tsx files', () => {
    const sourceFile = writeSourceFile(
      project,
      'pages/Article.tsx',
      "import type { Button } from '@scope/ui';",
    );
    const tsFile = writeSourceFile(
      project,
      'pages/Article.ts',
      "import { Dialog } from '@scope/ui';",
    );
    const declarationFile = writeSourceFile(
      project,
      'pages/Article.d.ts',
      "import { Dialog } from '@scope/ui';",
    );
    writeStyleDependencies(
      '@scope/ui/components/Button.css',
      '@scope/ui/components/Dialog.css',
    );

    const entries = collector.collect(
      [sourceFile, tsFile, declarationFile],
      normalizedConfig,
    );

    expectNoStyles(entries);
  });
});
