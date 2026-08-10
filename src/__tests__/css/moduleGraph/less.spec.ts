import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { StyleProcessor } from '#auklet/css/core/styleProcessor';
import { toFsSpecifier } from '#auklet/utils';
import { collectStyleImports } from '../../fixtures/styleStructure';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';
import {
  appPackageRoot,
  createMonorepoGraph,
  expectWatchFile,
  packagePath,
  setupMonorepoPackages,
} from './helpers';

describe('ModuleStyleGraph Less entries', () => {
  let fixture: VirtualProject;

  beforeEach(() => {
    fixture = createVirtualProject('auklet-css-graph-less-');
    setupMonorepoPackages(fixture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fixture.cleanup();
  });

  test('recompiles Less after HMR-style load result invalidation', async () => {
    fixture.writeFile(
      'packages/app-package/auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
          modules: true,
        };
      `,
    );
    fixture.writeFile(
      'packages/app-package/src/components/Button/index.tsx',
      'export function Button() { return null; }',
    );
    const entryFile = fixture.writeFile(
      'packages/app-package/src/components/Button/index.less',
      '@accent: red;\n.button { color: @accent; }',
    );
    const clearLessCache = vi.spyOn(StyleProcessor.prototype, 'clearLessCache');
    const graph = createMonorepoGraph(fixture);
    const parsed = graph.parsePackageStyleId(
      '@scope/app/components/Button.css',
    )!;

    const first = await graph.createPackageStyleCode(parsed);
    fixture.writeFile(
      'packages/app-package/src/components/Button/index.less',
      '@accent: blue;\n.button { color: @accent; }',
    );
    expect(graph.invalidateFileLoadResults(entryFile)).toBe('@scope/app');
    const second = await graph.createPackageStyleCode(parsed);

    expect(first.code).toContain('color: red');
    expect(first.code).not.toContain('color: blue');
    expect(second.code).toContain('color: blue');
    expect(second.code).not.toContain('color: red');
    expect(clearLessCache).toHaveBeenCalled();
  });

  test('recompiles Less when a watched Less partial changes', async () => {
    fixture.writeFile(
      'packages/app-package/auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
          modules: true,
        };
      `,
    );
    fixture.writeFile(
      'packages/app-package/src/components/Button/index.tsx',
      'export function Button() { return null; }',
    );
    const tokensFile = fixture.writeFile(
      'packages/app-package/src/components/Button/tokens.less',
      '@accent: red;\n',
    );
    fixture.writeFile(
      'packages/app-package/src/components/Button/index.less',
      '@import "./tokens.less";\n.button { color: @accent; }',
    );
    const graph = createMonorepoGraph(fixture);
    const parsed = graph.parsePackageStyleId(
      '@scope/app/components/Button.css',
    )!;

    const first = await graph.createPackageStyleCode(parsed);
    fixture.writeFile(
      'packages/app-package/src/components/Button/tokens.less',
      '@accent: green;\n',
    );
    expect(graph.invalidateFileLoadResults(tokensFile)).toBe('@scope/app');
    const second = await graph.createPackageStyleCode(parsed);

    expect(first.code).toContain('color: red');
    expect(second.code).toContain('color: green');
    expectWatchFile(
      first.watchFiles,
      fixture,
      appPackageRoot,
      'src/components/Button/tokens.less',
    );
  });

  test('compiles Less through processor without prefix while CSS stays on /@fs', async () => {
    fixture.writeFile(
      'packages/app-package/auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
          modules: true,
        };
      `,
    );
    fixture.writeFile(
      'packages/app-package/src/components/Button/tokens.less',
      '@accent: blue;\n',
    );
    fixture.writeFile(
      'packages/app-package/src/components/Button/index.tsx',
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      'packages/app-package/src/components/Button/index.less',
      `
        @import "./tokens.less";
        .button { color: @accent; }
      `,
    );
    fixture.writeFile(
      'packages/app-package/src/components/Card/index.tsx',
      'export function Card() { return null; }',
    );
    fixture.writeFile(
      'packages/app-package/src/components/Card/index.css',
      '.card { color: red; }',
    );

    const graph = createMonorepoGraph(fixture);
    const button = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/app/components/Button.css')!,
    );
    const card = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/app/components/Card.css')!,
    );
    const module = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/app/module.css')!,
    );

    const buttonLessPath = packagePath(
      fixture,
      appPackageRoot,
      'src/components/Button/index.less',
    );
    const cardCssPath = packagePath(
      fixture,
      appPackageRoot,
      'src/components/Card/index.css',
    );

    expect(button.code).toContain('.button');
    expect(button.code).toContain('color: blue');
    expect(button.code).not.toContain('@accent');
    expect(button.code).not.toContain(toFsSpecifier(buttonLessPath));
    expect(collectStyleImports(button.code)).toEqual([
      toFsSpecifier(
        packagePath(
          fixture,
          appPackageRoot,
          'src/components/Button/tokens.css',
        ),
      ),
    ]);

    expect(collectStyleImports(card.code)).toEqual([]);
    expect(card.code).toContain('.card');
    expect(card.code).not.toContain(toFsSpecifier(cardCssPath));

    expect(module.code).toContain('.button');
    expect(module.code).toContain('color: blue');
    expect(module.code).not.toContain(toFsSpecifier(buttonLessPath));
    expect(collectStyleImports(module.code)).toEqual([
      toFsSpecifier(cardCssPath),
      toFsSpecifier(
        packagePath(
          fixture,
          appPackageRoot,
          'src/components/Button/tokens.css',
        ),
      ),
    ]);

    expectWatchFile(
      button.watchFiles,
      fixture,
      appPackageRoot,
      'src/components/Button/index.less',
    );
    expectWatchFile(
      button.watchFiles,
      fixture,
      appPackageRoot,
      'src/components/Button/tokens.less',
    );
  });

  test('compiles Less and prefixes own CSS in module.css without raw /@fs', async () => {
    fixture.writeFile(
      'packages/app-package/auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
          modules: true,
          styles: {
            prefix: '.mf-app',
          },
        };
      `,
    );
    fixture.writeFile(
      'packages/app-package/src/components/Button/tokens.less',
      '@accent: blue;\n',
    );
    fixture.writeFile(
      'packages/app-package/src/components/Button/index.tsx',
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      'packages/app-package/src/components/Button/index.less',
      `
        @import "./tokens.less";
        .button { color: @accent; }
      `,
    );
    fixture.writeFile(
      'packages/app-package/src/components/Card/index.tsx',
      'export function Card() { return null; }',
    );
    fixture.writeFile(
      'packages/app-package/src/components/Card/index.css',
      '.card { color: red; }',
    );

    const graph = createMonorepoGraph(fixture);
    const button = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/app/components/Button.css')!,
    );
    const card = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/app/components/Card.css')!,
    );
    const module = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/app/module.css')!,
    );

    const buttonLessPath = packagePath(
      fixture,
      appPackageRoot,
      'src/components/Button/index.less',
    );
    const cardCssPath = packagePath(
      fixture,
      appPackageRoot,
      'src/components/Card/index.css',
    );

    expect(button.code).toContain('.mf-app .button');
    expect(button.code).toContain('color: blue');
    expect(button.code).not.toContain('@accent');
    expect(button.code).not.toContain(toFsSpecifier(buttonLessPath));
    expect(collectStyleImports(button.code)).toEqual([]);

    expect(card.code).toContain('.mf-app .card');
    expect(card.code).not.toContain(toFsSpecifier(cardCssPath));

    expect(module.code).toContain('.mf-app .button');
    expect(module.code).toContain('.mf-app .card');
    expect(module.code).not.toContain(toFsSpecifier(buttonLessPath));
    expect(module.code).not.toContain(toFsSpecifier(cardCssPath));
    expect(collectStyleImports(module.code)).toEqual([]);

    expectWatchFile(
      button.watchFiles,
      fixture,
      appPackageRoot,
      'src/components/Button/index.less',
    );
    expectWatchFile(
      button.watchFiles,
      fixture,
      appPackageRoot,
      'src/components/Button/tokens.less',
    );
  });

  test('prefixes preserved shared CSS imports in Vite component entries', async () => {
    fixture.writeFile(
      'packages/app-package/auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
          modules: true,
          styles: {
            prefix: '.mf-app',
            shared: './src/internal/syntaxHighlight.css',
          },
        };
      `,
    );
    fixture.writeFile(
      'packages/app-package/src/internal/syntaxHighlight.css',
      '.syntax-highlight { color: green; }',
    );
    fixture.writeFile(
      'packages/app-package/src/components/CodeBlock/index.tsx',
      'export function CodeBlock() { return null; }',
    );
    fixture.writeFile(
      'packages/app-package/src/components/CodeBlock/index.css',
      '@import "../../internal/syntaxHighlight.css";\n.code-block {}',
    );

    const graph = createMonorepoGraph(fixture);
    const codeBlock = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/app/components/CodeBlock.css')!,
    );
    const sharedPath = packagePath(
      fixture,
      appPackageRoot,
      'src/internal/syntaxHighlight.css',
    );

    expect(codeBlock.code).toContain('.mf-app .syntax-highlight');
    expect(codeBlock.code).toContain('.mf-app .code-block');
    expect(codeBlock.code).not.toContain(toFsSpecifier(sharedPath));
    expect(collectStyleImports(codeBlock.code)).toEqual([]);
  });

  test('tracks consumer package.json as a cache input for external Less without watching it', async () => {
    const consumerPackageJson = fixture.writeJson(
      path.join(appPackageRoot, 'package.json'),
      {
        name: '@scope/app',
        dependencies: { tokens: '1.0.0' },
      },
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'auklet.config.js'),
      `
        export const config = {
          source: 'src',
          output: 'dist',
          modules: true,
        };
      `,
    );
    fixture.writeJson(
      path.join(appPackageRoot, 'node_modules/tokens/package.json'),
      {
        name: 'tokens',
        exports: { './theme.less': './theme.less' },
      },
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'node_modules/tokens/theme.less'),
      '@brand: teal;',
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.tsx'),
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.less'),
      '@import (reference) "tokens/theme.less";\n.button { color: @brand; }',
    );

    const graph = createMonorepoGraph(fixture);
    const result = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/app/components/Button.css')!,
    );

    expect(result.code).toContain('color: teal');
    expect(result.cacheInputFiles).toContain(consumerPackageJson);
    expect(result.watchFiles).not.toContain(consumerPackageJson);
    expect(result.dependencyPackages).toContain('tokens');
  });

  test('recompiles external Less after consumer dependency declarations change', async () => {
    const consumerPackageJson = fixture.writeJson(
      path.join(appPackageRoot, 'package.json'),
      {
        name: '@scope/app',
        dependencies: { tokens: '1.0.0' },
      },
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'auklet.config.js'),
      `
        export const config = {
          source: 'src',
          output: 'dist',
          modules: true,
        };
      `,
    );
    fixture.writeJson(
      path.join(appPackageRoot, 'node_modules/tokens/package.json'),
      {
        name: 'tokens',
        exports: { './theme.less': './theme.less' },
      },
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'node_modules/tokens/theme.less'),
      '@brand: teal;',
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.tsx'),
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.less'),
      '@import (reference) "tokens/theme.less";\n.button { color: @brand; }',
    );

    const graph = createMonorepoGraph(fixture);
    const parsed = graph.parsePackageStyleId(
      '@scope/app/components/Button.css',
    )!;
    const first = await graph.createPackageStyleCode(parsed);
    expect(first.code).toContain('color: teal');

    fixture.writeJson(path.join(appPackageRoot, 'package.json'), {
      name: '@scope/app',
    });
    expect(graph.invalidateFile(consumerPackageJson)).toBe('@scope/app');

    await expect(graph.createPackageStyleCode(parsed)).rejects.toThrow(
      'direct dependency',
    );
  });

  test('tracks optional missing external Less packages for cache invalidation', async () => {
    fixture.writeJson(path.join(appPackageRoot, 'package.json'), {
      name: '@scope/app',
      optionalDependencies: { tokens: '1.0.0' },
    });
    fixture.writeFile(
      path.join(appPackageRoot, 'auklet.config.js'),
      `
        export const config = {
          source: 'src',
          output: 'dist',
          modules: true,
        };
      `,
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.tsx'),
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.less'),
      [
        '@brand: teal;',
        '@import (optional, reference) "tokens/theme.less";',
        '.button { color: @brand; }',
      ].join('\n'),
    );

    const graph = createMonorepoGraph(fixture);
    const result = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/app/components/Button.css')!,
    );

    expect(result.code).toContain('color: teal');
    expect(result.dependencyPackages).toContain('tokens');
    expect(result.cacheInputFiles).toContain(
      packagePath(fixture, appPackageRoot, 'node_modules/tokens/package.json'),
    );
  });

  test.each([
    ['style.css', 'color: teal', 'color: purple'],
    ['module.css', 'color: teal', 'color: purple'],
    ['themes/light.css', '--brand: teal', '--brand: purple'],
  ] as const)(
    'invalidates aggregate %s when a workspace external Less provider changes',
    async (stylePath, firstToken, secondToken) => {
      const consumerPackageJson = fixture.writeJson(
        path.join(appPackageRoot, 'package.json'),
        {
          name: '@scope/app',
          dependencies: { tokens: 'workspace:*' },
        },
      );
      fixture.writeFile(
        path.join(appPackageRoot, 'auklet.config.js'),
        `
          export const config = {
            source: 'src',
            output: 'dist',
            modules: true,
            styles: {
              themes: {
                light: './src/themes/light.less',
              },
            },
          };
        `,
      );
      fixture.writeJson('packages/tokens/package.json', {
        name: 'tokens',
        exports: { './theme.less': './theme.less' },
      });
      const providerFile = fixture.writeFile(
        'packages/tokens/theme.less',
        '@brand: teal;\n.brand-color() { color: @brand; }\n:root { --brand: @brand; }',
      );
      const link = fixture.resolve(
        path.join(appPackageRoot, 'node_modules/tokens'),
      );
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(fixture.resolve('packages/tokens'), link, 'dir');
      fixture.writeFile(
        path.join(appPackageRoot, 'src/components/Button/index.tsx'),
        'export function Button() { return null; }',
      );
      fixture.writeFile(
        path.join(appPackageRoot, 'src/components/Button/index.less'),
        '@import (reference) "tokens/theme.less";\n.button { .brand-color(); }',
      );
      fixture.writeFile(
        path.join(appPackageRoot, 'src/themes/light.less'),
        '@import (reference) "tokens/theme.less";\n:root { --brand: @brand; }',
      );

      const graph = createMonorepoGraph(fixture);
      const parsed = graph.parsePackageStyleId(`@scope/app/${stylePath}`)!;
      const first = await graph.createPackageStyleCode(parsed);

      expect(first.code).toContain(firstToken);
      expect(first.watchFiles).toContain(providerFile);
      expect(first.cacheInputFiles).toContain(consumerPackageJson);
      expect(first.watchFiles).not.toContain(consumerPackageJson);
      expect(first.dependencyPackages).toContain('tokens');

      fixture.writeFile(
        'packages/tokens/theme.less',
        '@brand: purple;\n.brand-color() { color: @brand; }\n:root { --brand: @brand; }',
      );
      // Provider file lives in workspace package `tokens`; dependents of that
      // package (including `@scope/app` aggregate entries) are invalidated too.
      expect(graph.invalidateFileLoadResults(providerFile)).toBe('tokens');
      const second = await graph.createPackageStyleCode(parsed);

      expect(second.code).toContain(secondToken);
      expect(second.code).not.toContain(firstToken);
    },
  );

  test('keeps aggregate style.css persistent cache non-fresh after provider Less changes', async () => {
    fixture.writeJson(path.join(appPackageRoot, 'package.json'), {
      name: '@scope/app',
      dependencies: { tokens: 'workspace:*' },
    });
    fixture.writeFile(
      path.join(appPackageRoot, 'auklet.config.js'),
      `
        export const config = {
          source: 'src',
          output: 'dist',
          modules: true,
        };
      `,
    );
    fixture.writeJson('packages/tokens/package.json', {
      name: 'tokens',
      exports: { './theme.less': './theme.less' },
    });
    fixture.writeFile(
      'packages/tokens/theme.less',
      '@brand: teal;\n.brand-color() { color: @brand; }',
    );
    const link = fixture.resolve(
      path.join(appPackageRoot, 'node_modules/tokens'),
    );
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(fixture.resolve('packages/tokens'), link, 'dir');
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.tsx'),
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.less'),
      '@import (reference) "tokens/theme.less";\n.button { .brand-color(); }',
    );

    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };
    const firstGraph = createMonorepoGraph(fixture);
    const first = await firstGraph.createPackageStyleCode(parsed);
    expect(first.code).toContain('color: teal');

    fixture.writeFile(
      'packages/tokens/theme.less',
      '@brand: purple;\n.brand-color() { color: @brand; }',
    );
    const secondGraph = createMonorepoGraph(fixture);
    const second = await secondGraph.createPackageStyleCode(parsed);

    expect(second.code).toContain('color: purple');
    expect(second.code).not.toContain('color: teal');
  });
});
