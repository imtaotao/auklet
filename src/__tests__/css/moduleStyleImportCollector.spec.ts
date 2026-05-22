import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ModuleStyleImportCollector } from '#auklet/css/core/styleImports/collector';
import { normalizeAukletConfig } from '#auklet/config';
import type { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

const defaultConfig = normalizeAukletConfig({
  styles: {
    dependencies: {
      '@scope/ui': {
        components: ['/pages/**.css', '/components/**.css'],
      },
    },
  },
});

const singleRuleConfig = normalizeAukletConfig({
  styles: {
    dependencies: {
      '@scope/ui': {
        components: '/components/**.css',
      },
    },
  },
});

const blockRuleConfig = normalizeAukletConfig({
  styles: {
    dependencies: {
      '@scope/ui': {
        components: ['/components/**.css', '/blocks/**.css'],
      },
    },
  },
});

const emptyConfig = normalizeAukletConfig();

const expectStyles = (
  entries: Map<string, Array<string>>,
  module: string,
  styles: Array<string>,
) => {
  expect(entries.get(module)).toEqual(styles);
};

type CollectCase = {
  name: string;
  source: string;
  code: string;
  deps: Array<string>;
  module: string;
  styles: Array<string>;
  config?: typeof defaultConfig;
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

  const writeSource = (relativePath: string, code: string) => {
    return project.writeFile(path.join('src', relativePath), code);
  };

  const writeDep = (specifier: string) => {
    project.writeFile(path.join('styles', specifier), '');
  };

  const writeStyle = (relativePath: string) => {
    project.writeFile(path.join('src', relativePath), '');
  };

  const writeDeps = (...specifiers: Array<string>) => {
    for (const specifier of specifiers) {
      writeDep(specifier);
    }
  };

  const writeStyles = (...relativePaths: Array<string>) => {
    for (const relativePath of relativePaths) {
      writeStyle(relativePath);
    }
  };

  const writeComponent = (sourceDir: string) => {
    const componentName = path.basename(sourceDir);
    writeSource(
      `${sourceDir}/index.tsx`,
      `export function ${componentName}() { return null; }`,
    );
    writeStyles(`${sourceDir}/index.css`);
  };

  const writeFileModule = (source: string) => {
    const moduleName = path.basename(source, path.extname(source));
    writeSource(source, `export function ${moduleName}() { return null; }`);
    writeStyles(source.replace(/\.[^.]+$/, '.css'));
  };

  const collectSource = (
    source: string,
    code: string,
    config = defaultConfig,
  ) => {
    const file = writeSource(source, code);
    return collectFile(file, config);
  };

  const collectFile = (file: string, config = defaultConfig) => {
    return collector.collect([file], config);
  };

  const expectNoStyles = (entries: Map<string, Array<string>>) => {
    expect(entries.size).toBe(0);
  };

  const expectCase = (item: CollectCase) => {
    writeDeps(...item.deps);
    const entries = collectSource(item.source, item.code, item.config);

    if (item.styles.length === 0) {
      expect(entries.get(item.module)).toBeUndefined();
      return;
    }
    expectStyles(entries, item.module, item.styles);
  };

  const cases: Array<CollectCase> = [
    {
      name: 'collects component styles from package entry named imports',
      source: 'pages/Article.tsx',
      code: "import { Button, Dialog } from '@scope/ui';",
      deps: [
        '@scope/ui/components/Button.css',
        '@scope/ui/components/Dialog.css',
      ],
      module: 'pages/Article',
      styles: [
        '@scope/ui/components/Button.css',
        '@scope/ui/components/Dialog.css',
      ],
    },
    {
      name: 'collects styles from a single string rule',
      source: 'pages/Article.tsx',
      code: "import { Button } from '@scope/ui';",
      deps: ['@scope/ui/components/Button.css'],
      module: 'pages/Article',
      styles: ['@scope/ui/components/Button.css'],
      config: singleRuleConfig,
    },
    {
      name: 'uses exported component names when named imports are aliased',
      source: 'pages/Article.tsx',
      code: "import { Button as PrimaryButton } from '@scope/ui';",
      deps: ['@scope/ui/components/Button.css'],
      module: 'pages/Article',
      styles: ['@scope/ui/components/Button.css'],
    },
    {
      name: 'ignores local aliases when package entry import names match component files',
      source: 'pages/Article.tsx',
      code: "import { Image as WillaImage } from '@scope/ui';",
      deps: ['@scope/ui/components/Image.css'],
      module: 'pages/Article',
      styles: ['@scope/ui/components/Image.css'],
    },
    {
      name: 'does not map package entry aliases back to differently named component files',
      source: 'pages/Article.tsx',
      code: "import { WillaImage } from '@scope/ui';",
      deps: ['@scope/ui/components/Image.css'],
      module: 'pages/Article',
      styles: [],
    },
    {
      name: 'matches deep imports against non-component component rules',
      source: 'pages/Article.tsx',
      code: "import { Callout } from '@scope/ui/blocks/Callout';",
      deps: ['@scope/ui/blocks/Callout.css'],
      module: 'pages/Article',
      styles: ['@scope/ui/blocks/Callout.css'],
      config: blockRuleConfig,
    },
    {
      name: 'collects component styles directly from deep component imports',
      source: 'pages/Article.tsx',
      code: "import { Button as PrimaryButton } from '@scope/ui/components/Button';",
      deps: ['@scope/ui/components/Button.css'],
      module: 'pages/Article',
      styles: ['@scope/ui/components/Button.css'],
    },
    {
      name: 'uses deep import paths regardless of imported export names',
      source: 'pages/Article.tsx',
      code: "import { Anything } from '@scope/ui/components/Image';",
      deps: ['@scope/ui/components/Image.css'],
      module: 'pages/Article',
      styles: ['@scope/ui/components/Image.css'],
    },
    {
      name: 'does not infer component styles from unmatched deep import paths',
      source: 'pages/Article.tsx',
      code: "import { Image } from '@scope/ui/media/Image';",
      deps: ['@scope/ui/components/Image.css'],
      module: 'pages/Article',
      styles: [],
    },
    {
      name: 'collects page styles from package entry named imports',
      source: 'routes/App.tsx',
      code: "import { DashboardPage } from '@scope/ui';",
      deps: ['@scope/ui/pages/DashboardPage.css'],
      module: 'routes/App',
      styles: ['@scope/ui/pages/DashboardPage.css'],
    },
    {
      name: 'collects page styles directly from deep page imports',
      source: 'routes/App.tsx',
      code: "import { DashboardPage } from '@scope/ui/pages/DashboardPage';",
      deps: ['@scope/ui/pages/DashboardPage.css'],
      module: 'routes/App',
      styles: ['@scope/ui/pages/DashboardPage.css'],
    },
    {
      name: 'collects direct styles from deep namespace imports',
      source: 'routes/App.tsx',
      code: "import * as DashboardPage from '@scope/ui/pages/DashboardPage';",
      deps: ['@scope/ui/pages/DashboardPage.css'],
      module: 'routes/App',
      styles: ['@scope/ui/pages/DashboardPage.css'],
    },
    {
      name: 'collects direct styles from deep namespace imports regardless of rule order',
      source: 'pages/Article.tsx',
      code: "import * as Button from '@scope/ui/components/Button';",
      deps: ['@scope/ui/components/Button.css'],
      module: 'pages/Article',
      styles: ['@scope/ui/components/Button.css'],
    },
    {
      name: 'collects component styles from package entry named re-exports',
      source: 'pages/Article.tsx',
      code: "export { Button as PrimaryButton } from '@scope/ui';",
      deps: ['@scope/ui/components/Button.css'],
      module: 'pages/Article',
      styles: ['@scope/ui/components/Button.css'],
    },
    {
      name: 'collects direct styles from deep named re-exports',
      source: 'pages/Article.tsx',
      code: "export { Button } from '@scope/ui/components/Button';",
      deps: ['@scope/ui/components/Button.css'],
      module: 'pages/Article',
      styles: ['@scope/ui/components/Button.css'],
    },
    {
      name: 'resolves local re-exports through import bindings',
      source: 'pages/Article.tsx',
      code: `
        import { Button as BaseButton } from '@scope/ui';
        export { BaseButton as Button };
      `,
      deps: ['@scope/ui/components/Button.css'],
      module: 'pages/Article',
      styles: ['@scope/ui/components/Button.css'],
    },
  ];

  for (const item of cases) {
    test(item.name, () => {
      expectCase(item);
    });
  }

  test('throws when a local re-export cannot be resolved', () => {
    const file = writeSource('pages/Article.tsx', 'export { MissingButton };');

    expect(() => collector.collect([file], defaultConfig)).toThrow(
      'Unable to resolve exported symbol "MissingButton"',
    );
  });

  test('throws for export-all declarations', () => {
    const file = writeSource(
      'pages/Article.tsx',
      "export * from '@scope/ui/components/Button';",
    );
    writeDeps('@scope/ui/components/Button.css');

    expect(() => collector.collect([file], defaultConfig)).toThrow(
      'Export-all declarations are not supported for CSS auto import: @scope/ui/components/Button',
    );
  });

  test('throws for namespace imports from package entries', () => {
    const file = writeSource(
      'pages/Article.tsx',
      "import * as UI from '@scope/ui';",
    );

    expect(() => collector.collect([file], defaultConfig)).toThrow(
      'Namespace import is not supported for CSS auto import: @scope/ui',
    );
  });

  test('collects styles from source alias imports in the same package', () => {
    const file = writeSource(
      'components/Renderer/index.tsx',
      `
        import { CodeBlock } from '#fixture/components/CodeBlock';
        import type { Heading } from '#fixture/components/Heading';
      `,
    );
    writeComponent('components/CodeBlock');
    writeSource(
      'components/Heading.ts',
      'export type Heading = { title: string };',
    );
    writeStyles('components/Renderer/index.css');

    const entries = collectFile(file);

    expectStyles(entries, 'components/Renderer', [
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
    const file = writeSource(
      'components/Mdx/index.tsx',
      "import { EnglishCards } from '#widgets/components/EnglishCards';",
    );
    writeComponent('widgets/components/EnglishCards');

    const entries = collectFile(file, emptyConfig);

    expectStyles(entries, 'components/Mdx', [
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
    const file = writeSource(
      'components/Mdx/index.tsx',
      "import { EnglishCards } from '#widgets/components/EnglishCards';\n" +
        "import { CodeBlock } from '#content/components/CodeBlock';",
    );
    writeComponent('components/EnglishCards');

    const entries = collectFile(file, emptyConfig);

    expectStyles(entries, 'components/Mdx', [
      '../../EnglishCards/style/index.css',
    ]);
  });

  test('collects same-package styles without dependency config', () => {
    const file = writeSource(
      'components/Renderer/index.tsx',
      "import { CodeBlock } from '#fixture/components/CodeBlock';",
    );
    writeComponent('components/CodeBlock');
    writeStyles('components/Renderer/index.css');

    const entries = collectFile(file, emptyConfig);

    expectStyles(entries, 'components/Renderer', [
      '../../CodeBlock/style/index.css',
    ]);
  });

  test('collects styles from relative imports in the same package', () => {
    const file = writeSource(
      'components/Chat/index.tsx',
      "import { DetailsBlock } from '../DetailsBlock';",
    );
    writeComponent('components/DetailsBlock');
    writeStyles('components/Chat/index.css');

    const entries = collectFile(file);

    expectStyles(entries, 'components/Chat', [
      '../../DetailsBlock/style/index.css',
    ]);
  });

  test('ignores relative source imports outside the source root', () => {
    const file = writeSource(
      'components/Renderer/index.tsx',
      "import { CodeBlock } from '../../shared/CodeBlock';",
    );
    project.writeFile(
      path.join('shared', 'CodeBlock.tsx'),
      'export function CodeBlock() { return null; }',
    );
    project.writeFile(path.join('shared', 'CodeBlock.css'), '');

    const entries = collectFile(file, emptyConfig);

    expect(entries.get('components/Renderer')).toBeUndefined();
  });

  test('collects styles from same-package file modules with sibling CSS', () => {
    const file = writeSource(
      'components/Renderer/index.tsx',
      "import { Button } from '#fixture/components/Button';",
    );
    writeFileModule('components/Button.tsx');

    const entries = collectFile(file, emptyConfig);

    expectStyles(entries, 'components/Renderer', [
      '../../Button/style/index.css',
    ]);
  });

  test('skips inferred component styles that do not exist', () => {
    const file = writeSource(
      'pages/Article.tsx',
      "import { MissingComponent } from '@scope/ui';",
    );

    const entries = collectFile(file);

    expectNoStyles(entries);
  });

  test('does not infer styles from package entry side-effect imports', () => {
    const file = writeSource('pages/Article.tsx', "import '@scope/ui';");
    writeDeps('@scope/ui/components/Button.css');

    const entries = collectFile(file);

    expectNoStyles(entries);
  });

  test('infers styles from deep component side-effect imports', () => {
    const file = writeSource(
      'pages/Article.tsx',
      "import '@scope/ui/components/Button';",
    );
    writeDeps('@scope/ui/components/Button.css');

    const entries = collectFile(file);

    expectStyles(entries, 'pages/Article', ['@scope/ui/components/Button.css']);
  });

  test('skips type-only imports and non-tsx files', () => {
    const sourceFile = writeSource(
      'pages/Article.tsx',
      "import type { Button } from '@scope/ui';",
    );
    const tsFile = writeSource(
      'pages/Article.ts',
      "import { Dialog } from '@scope/ui';",
    );
    const declarationFile = writeSource(
      'pages/Article.d.ts',
      "import { Dialog } from '@scope/ui';",
    );
    writeDeps(
      '@scope/ui/components/Button.css',
      '@scope/ui/components/Dialog.css',
    );

    const entries = collector.collect(
      [sourceFile, tsFile, declarationFile],
      defaultConfig,
    );

    expectNoStyles(entries);
  });
});
