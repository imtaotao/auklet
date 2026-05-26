import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { normalizeFileKey } from '#auklet/utils';
import { normalizeGraphStyleStructure } from '../../fixtures/styleStructure';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';
import {
  appPackageRoot,
  createMonorepoGraph,
  expectContentOrder,
  expectWatchFile,
  getKatexStylePath,
  getKatexStyleSpecifier,
  setupMonorepoPackages,
  uiPackageRoot,
} from './helpers';

describe('ModuleStyleGraph entries', () => {
  let fixture: VirtualProject;

  beforeEach(() => {
    fixture = createVirtualProject('auklet-css-graph-');
    setupMonorepoPackages(fixture);
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('creates dev external CSS through recursive workspace kernel dependencies', async () => {
    fixture.writeFile(
      'packages/app-package/auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
          styles: {
            dependencies: {
              '@scope/ui': {
                entry: '/style.css',
                themes: {
                  light: '/themes/light.css',
                  dark: '/themes/dark.css',
                },
              },
            },
          },
        };
      `,
    );
    fixture.writeFile(
      'packages/ui-package/auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
          styles: {
            dependencies: {
              katex: {
                entry: '/dist/katex.min.css',
              },
            },
          },
        };
      `,
    );

    const graph = createMonorepoGraph(fixture);
    const parsed = graph.parsePackageStyleId('@scope/app/external.css');
    const result = await graph.createPackageStyleCode(parsed!);

    expect(result.code).toBe(`@import "${getKatexStyleSpecifier(fixture)}";`);
    expectWatchFile(
      result.watchFiles,
      fixture,
      appPackageRoot,
      'auklet.config.js',
    );
    expectWatchFile(
      result.watchFiles,
      fixture,
      uiPackageRoot,
      'auklet.config.js',
    );
    expect(result.watchFiles).toContain(
      normalizeFileKey(getKatexStylePath(fixture)),
    );
  });

  test('creates dev style CSS with themes before module styles', async () => {
    fixture.writeFile(
      'packages/app-package/auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
          styles: {
            themes: {
              light: './src/themes/light.css',
              dark: './src/themes/dark.css',
            },
            dependencies: {
              '@scope/ui': {
                entry: '/style.css',
                themes: {
                  light: '/themes/light.css',
                  dark: '/themes/dark.css',
                },
              },
            },
          },
        };
      `,
    );
    fixture.writeFile(
      'packages/ui-package/auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
          styles: {
            themes: {
              light: './src/themes/light.css',
              dark: './src/themes/dark.css',
            },
            dependencies: {
              katex: {
                entry: '/dist/katex.min.css',
              },
            },
          },
        };
      `,
    );
    fixture.writeFile(
      'packages/ui-package/src/themes/light.css',
      '.markdown-shell { --markdown-bg: white; }',
    );
    fixture.writeFile(
      'packages/ui-package/src/themes/dark.css',
      '.markdown-shell { --markdown-bg: black; }',
    );
    fixture.writeFile(
      'packages/ui-package/src/components/Renderer/index.css',
      '.markdown-prose { color: var(--markdown-text); }',
    );
    fixture.writeFile(
      'packages/app-package/src/themes/light.css',
      ':root { --bg: white; }',
    );
    fixture.writeFile(
      'packages/app-package/src/themes/dark.css',
      ':root[data-wk-theme="dark"] { --bg: black; }',
    );
    fixture.writeFile(
      'packages/app-package/src/pages/BlogArticlePage.css',
      '.article { background: var(--bg); }',
    );

    const graph = createMonorepoGraph(fixture);
    const result = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/app/style.css')!,
    );

    expect(
      result.code.indexOf(`@import "${getKatexStyleSpecifier(fixture)}";`),
    ).toBe(0);
    expectContentOrder(
      result.code,
      '.markdown-shell',
      ':root { --bg: white; }',
    );
    expectContentOrder(
      result.code,
      '.markdown-prose',
      ':root { --bg: white; }',
    );
    expectContentOrder(
      result.code,
      ':root { --bg: white; }',
      '.article { background: var(--bg); }',
    );
    expect(result.code).toContain(
      ':root[data-wk-theme="dark"] { --bg: black; }',
    );
    expect(result.code).not.toContain('src/themes/light.css');

    const structure = await normalizeGraphStyleStructure(
      graph,
      '@scope/app',
      path.join(fixture.root, appPackageRoot),
      ['style.css', 'themes/light.css', 'themes/dark.css'],
    );

    expect(structure.entries['style.css']?.imports).toEqual([
      getKatexStyleSpecifier(fixture),
    ]);
    expect(Object.keys(structure.themes).sort()).toEqual(['dark', 'light']);
    expectWatchFile(
      result.watchFiles,
      fixture,
      appPackageRoot,
      'auklet.config.js',
    );

    const lightTheme = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/app/themes/light.css')!,
    );
    const darkTheme = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/app/themes/dark.css')!,
    );

    expectContentOrder(
      lightTheme.code,
      '.markdown-shell',
      ':root { --bg: white; }',
    );
    expect(lightTheme.code).toContain(':root { --bg: white; }');
    expectContentOrder(
      darkTheme.code,
      '.markdown-shell',
      ':root[data-wk-theme="dark"]',
    );
    expect(darkTheme.code).toContain(
      ':root[data-wk-theme="dark"] { --bg: black; }',
    );
  });

  test('creates dev theme CSS from dependency themes without local theme files', async () => {
    fixture.writeFile(
      'packages/app-package/auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
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
      `,
    );
    fixture.writeFile(
      'packages/ui-package/auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
          styles: {
            themes: {
              light: './src/themes/light.css',
              dark: './src/themes/dark.css',
            },
          },
        };
      `,
    );
    fixture.writeFile(
      'packages/ui-package/src/themes/light.css',
      '.ui-light { color-scheme: light; }',
    );

    const graph = createMonorepoGraph(fixture);
    const result = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/app/themes/light.css')!,
    );

    expect(result.code).toContain('.ui-light { color-scheme: light; }');
    expectWatchFile(
      result.watchFiles,
      fixture,
      appPackageRoot,
      'auklet.config.js',
    );
    expectWatchFile(
      result.watchFiles,
      fixture,
      uiPackageRoot,
      'src/themes/light.css',
    );
  });

  test('creates source module CSS with dependency modules before own styles', async () => {
    fixture.writeFile(
      'packages/app-package/auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
          styles: {
            dependencies: {
              '@scope/ui': {
                entry: '/style.css',
                themes: {
                  light: '/themes/light.css',
                  dark: '/themes/dark.css',
                },
                components: ['/components/**.css'],
              },
            },
          },
        };
      `,
    );
    fixture.writeFile(
      'packages/ui-package/auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
          styles: {
            themes: {
              light: './src/themes/light.css',
              dark: './src/themes/dark.css',
            },
          },
        };
      `,
    );
    fixture.writeFile(
      'packages/app-package/src/pages/BlogArticlePage.tsx',
      `
        import { Renderer } from '@scope/ui';
        export function BlogArticlePage() { return Renderer; }
      `,
    );
    fixture.writeFile(
      'packages/app-package/src/pages/BlogArticlePage.css',
      '.article { color: var(--blog-text); }',
    );
    fixture.writeFile(
      'packages/ui-package/src/themes/light.css',
      '.markdown-shell { --markdown-bg: white; }',
    );
    fixture.writeFile(
      'packages/ui-package/src/components/Renderer/index.css',
      '.markdown-prose { color: var(--markdown-text); }',
    );

    const graph = createMonorepoGraph(fixture);
    const result = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/app/pages/BlogArticlePage.css')!,
    );

    expectContentOrder(result.code, '.markdown-prose', '.article');
    expect(result.code).not.toContain('.markdown-shell');
    expectWatchFile(
      result.watchFiles,
      fixture,
      appPackageRoot,
      'src/pages/BlogArticlePage.tsx',
    );
    expectWatchFile(
      result.watchFiles,
      fixture,
      appPackageRoot,
      'src/pages/BlogArticlePage.css',
    );
  });
});
