import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  blockRuleConfig,
  createCollectorFixture,
  defaultConfig,
  expectNoStyles,
  expectStyles,
  singleRuleConfig,
  type CollectorFixture,
} from './collectorHelpers';

type CollectCase = {
  name: string;
  source: string;
  code: string;
  deps: Array<string>;
  module: string;
  styles: Array<string>;
  config?: typeof defaultConfig;
};

describe('ModuleStyleImportCollector dependency imports', () => {
  let fixture: CollectorFixture;

  beforeEach(() => {
    fixture = createCollectorFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

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
      fixture.writeDeps(...item.deps);
      const entries = fixture.collectSource(
        item.source,
        item.code,
        item.config,
      );

      if (item.styles.length === 0) {
        expect(entries.get(item.module)).toBeUndefined();
        return;
      }
      expectStyles(entries, item.module, item.styles);
    });
  }

  test('skips inferred component styles that do not exist', () => {
    const entries = fixture.collectSource(
      'pages/Article.tsx',
      "import { MissingComponent } from '@scope/ui';",
    );

    expectNoStyles(entries);
  });

  test('throws when a local re-export cannot be resolved', () => {
    const file = fixture.writeSource(
      'pages/Article.tsx',
      'export { MissingButton };',
    );

    expect(() => fixture.collector.collect([file], defaultConfig)).toThrow(
      'Unable to resolve exported symbol "MissingButton"',
    );
  });
});
