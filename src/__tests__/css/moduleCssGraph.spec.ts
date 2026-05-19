import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ModuleCssGraph } from '#auklet/css/core/moduleCssGraph';
import { normalizeCssFileKey } from '#auklet/css/core/path';
import { normalizeGraphStyleStructure } from '../fixtures/styleStructure';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

const appPackageRoot = 'packages/app-package';
const uiPackageRoot = 'packages/ui-package';

const createGraph = (fixture: VirtualProject) => {
  return new ModuleCssGraph({
    workspaceRoot: fixture.root,
  });
};

const packagePath = (
  fixture: VirtualProject,
  packageRoot: string,
  relativePath: string,
) => {
  return path.join(fixture.root, packageRoot, relativePath);
};

const expectWatchFile = (
  watchFiles: Array<string>,
  fixture: VirtualProject,
  packageRoot: string,
  relativePath: string,
) => {
  expect(watchFiles).toContain(
    normalizeCssFileKey(packagePath(fixture, packageRoot, relativePath)),
  );
};

const expectContentOrder = (content: string, before: string, after: string) => {
  expect(content.indexOf(before)).toBeLessThan(content.indexOf(after));
};

describe('ModuleCssGraph', () => {
  let fixture: VirtualProject;

  beforeEach(() => {
    fixture = createVirtualProject('auklet-css-graph-');
    fixture.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    fixture.writeJson(path.join(appPackageRoot, 'package.json'), {
      name: '@scope/app',
    });
    fixture.writeJson(path.join(uiPackageRoot, 'package.json'), {
      name: '@scope/ui',
    });
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('creates dev external CSS through recursive workspace kernel dependencies', async () => {
    fixture.writeFile(
      'packages/app-package/auklet.config.ts',
      `
        import type { AukletConfig } from '/auklet';

        export const config: AukletConfig = {
          sourceDir: 'src',
          outputDir: 'dist',
          cssDependencies: {
            '@scope/ui': {
              global: '/style.css',
              themes: {
                light: '/themes/light.css',
                dark: '/themes/dark.css',
              },
            },
          },
        };
      `,
    );
    fixture.writeFile(
      'packages/ui-package/auklet.config.ts',
      `
        import type { AukletConfig } from '/auklet';

        export const config: AukletConfig = {
          sourceDir: 'src',
          outputDir: 'dist',
          cssDependencies: {
            katex: {
              global: '/dist/katex.min.css',
            },
          },
        };
      `,
    );

    const graph = createGraph(fixture);
    const parsed = graph.parsePackageCssId('@scope/app/external.css');

    const result = await graph.createPackageCssCode(parsed!);

    expect(result.code).toBe('@import "katex/dist/katex.min.css";');
    expectWatchFile(
      result.watchFiles,
      fixture,
      appPackageRoot,
      'auklet.config.ts',
    );
    expectWatchFile(
      result.watchFiles,
      fixture,
      uiPackageRoot,
      'auklet.config.ts',
    );
  });

  test('creates dev style CSS with themes before module styles', async () => {
    fixture.writeFile(
      'packages/app-package/auklet.config.ts',
      `
        import type { AukletConfig } from '/auklet';

        export const config: AukletConfig = {
          sourceDir: 'src',
          outputDir: 'dist',
          themes: {
            light: './src/themes/light.css',
            dark: './src/themes/dark.css',
          },
          cssDependencies: {
            '@scope/ui': {
              global: '/style.css',
              themes: {
                light: '/themes/light.css',
                dark: '/themes/dark.css',
              },
            },
          },
        };
      `,
    );
    fixture.writeFile(
      'packages/ui-package/auklet.config.ts',
      `
        import type { AukletConfig } from '/auklet';

        export const config: AukletConfig = {
          sourceDir: 'src',
          outputDir: 'dist',
          themes: {
            light: './src/themes/light.css',
            dark: './src/themes/dark.css',
          },
          cssDependencies: {
            katex: {
              global: '/dist/katex.min.css',
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

    const graph = createGraph(fixture);
    const parsed = graph.parsePackageCssId('@scope/app/style.css');

    const result = await graph.createPackageCssCode(parsed!);

    expect(result.code.indexOf('@import "katex/dist/katex.min.css";')).toBe(0);
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
      'katex/dist/katex.min.css',
    ]);
    expect(Object.keys(structure.themes).sort()).toEqual(['dark', 'light']);
    expectWatchFile(
      result.watchFiles,
      fixture,
      appPackageRoot,
      'auklet.config.ts',
    );
    const lightTheme = await graph.createPackageCssCode(
      graph.parsePackageCssId('@scope/app/themes/light.css')!,
    );
    const darkTheme = await graph.createPackageCssCode(
      graph.parsePackageCssId('@scope/app/themes/dark.css')!,
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

  test('normalizes slash styles for workspace source graph checks and watch roots', () => {
    const graph = new ModuleCssGraph({
      workspaceRoot: 'C:\\repo\\workspace',
    });

    const sourceGraphFiles = [
      'C:\\repo\\workspace\\packages\\app-package\\src\\pages\\Blog\\index.css',
      'C:/repo/workspace/packages/app-package/src/pages/Blog/index.tsx',
      'C:\\repo\\workspace\\packages\\shared\\src\\index.css',
    ];

    for (const file of sourceGraphFiles) {
      expect(graph.isWorkspaceSourceGraphFile(file)).toBe(true);
    }

    expect(graph.getWatchRoots()).toEqual([
      'C:/repo/workspace/packages/*/src',
      'C:/repo/workspace/packages/*/auklet.config.ts',
    ]);
  });

  test('creates source module CSS with dependency modules before own styles', async () => {
    fixture.writeFile(
      'packages/app-package/auklet.config.ts',
      `
        import type { AukletConfig } from '/auklet';

        export const config: AukletConfig = {
          sourceDir: 'src',
          outputDir: 'dist',
          cssDependencies: {
            '@scope/ui': {
              global: '/style.css',
              themes: {
                light: '/themes/light.css',
                dark: '/themes/dark.css',
              },
              component: ['/components/**.css'],
            },
          },
        };
      `,
    );
    fixture.writeFile(
      'packages/ui-package/auklet.config.ts',
      `
        import type { AukletConfig } from '/auklet';

        export const config: AukletConfig = {
          sourceDir: 'src',
          outputDir: 'dist',
          themes: {
            light: './src/themes/light.css',
            dark: './src/themes/dark.css',
          },
        };
      `,
    );
    fixture.writeFile(
      'packages/app-package/src/pages/BlogArticlePage.tsx',
      `
        import { Renderer } from '@scope/ui';
        export const BlogArticlePage = () => Renderer;
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

    const graph = createGraph(fixture);
    const result = await graph.createPackageCssCode(
      graph.parsePackageCssId('@scope/app/pages/BlogArticlePage.css')!,
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
