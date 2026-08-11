import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createServer as createViteServer } from 'vite';
import { createCssModulesPlugin } from '#auklet/build/cssModulesPlugin';
import { createGenerateScopedName } from '#auklet/css/modules/generateScopedName';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import { resolveCssModuleImport } from '#auklet/css/modules/resolveCssModuleImport';
import { ModuleStyleBuilder } from '#auklet/css/production/builder';
import { aukletStylePlugin } from '#auklet/css/vite/vitePlugin';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

describe('published shared.output CSS in Vite', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-published-shared-vite-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('consumer Vite keeps producer locals aligned with .scoped.css (no re-module)', async () => {
    const uiRoot = project.resolve('node_modules/@scope/ui');
    const moduleFile = project.writeFile(
      'node_modules/@scope/ui/src/shared/chip.module.less',
      '.chip { color: red; }\n',
    );
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      version: '0.0.1',
      type: 'module',
      exports: {
        './shared/chip.module.less': {
          import: './dist/es/shared/chip.module.less.js',
          default: './dist/es/shared/chip.module.less.js',
        },
      },
    });

    await new ModuleStyleBuilder({
      packageRoot: uiRoot,
      aukletConfig: {
        source: 'src',
        output: 'dist',
        modules: true,
        styles: {
          shared: {
            output: './src/shared/**/*.module.{less,css}',
          },
        },
      },
    }).build();

    const expectedClass = createGenerateScopedName({
      packageRoot: uiRoot,
      sourceRoot: project.resolve('node_modules/@scope/ui/src'),
    })('chip', moduleFile, '');
    const scopedCssFile = project.resolve(
      'node_modules/@scope/ui/dist/es/shared/chip.scoped.css',
    );
    expect(
      project.readFile('node_modules/@scope/ui/dist/es/shared/chip.scoped.css'),
    ).toContain(`.${expectedClass}`);
    expect(isCssModuleFile(scopedCssFile)).toBe(false);
    expect(
      project.exists('node_modules/@scope/ui/dist/es/shared/chip.module.css'),
    ).toBe(false);
    expect(
      project.readFile(
        'node_modules/@scope/ui/dist/es/shared/chip.module.less.js',
      ),
    ).toContain('import "./chip.scoped.css"');

    project.writePackageJson({
      name: '@scope/app',
      type: 'module',
      dependencies: {
        '@scope/ui': '0.0.1',
      },
    });
    project.writeAukletConfig(`
      export const config = {
        source: 'src',
        modules: true,
      };
    `);
    project.writeFile(
      'src/css-modules.d.ts',
      `declare module '@scope/ui/shared/chip.module.less' {\n  const classes: Record<string, string>;\n  export default classes;\n}\n`,
    );
    const entryFile = project.writeFile(
      'src/entry.ts',
      `import styles from '@scope/ui/shared/chip.module.less';\nexport const className = styles.chip;\n`,
    );

    const server = await createViteServer({
      configFile: false,
      logLevel: 'silent',
      root: project.root,
      optimizeDeps: {
        noDiscovery: true,
        include: [],
      },
      plugins: [
        aukletStylePlugin({
          root: project.root,
          mode: 'package',
        }),
      ],
    });

    try {
      const resolved = await server.pluginContainer.resolveId(
        '@scope/ui/shared/chip.module.less',
        entryFile,
      );
      expect(resolved?.id).toMatch(/chip\.module\.less\.js$/);

      const cssTransform = await server.transformRequest(scopedCssFile);
      expect(cssTransform?.code).toContain(expectedClass);
      // CSS Modules transforms export a locals map; plain CSS must keep the
      // producer hash and must not invent a second locals export for `.chip`.
      expect(cssTransform?.code).not.toMatch(
        /export\s+default\s+\{\s*chip\s*:/,
      );

      const shim = project.readFile(
        'node_modules/@scope/ui/dist/es/shared/chip.module.less.js',
      );
      expect(shim).toContain(JSON.stringify({ chip: expectedClass }));
      expect(shim).toContain('import "./chip.scoped.css"');

      // Consumer import styles from 'pkg/...': resolve releases the shim, and
      // published locals stay aligned with the scoped CSS asset.
      expect(
        resolveCssModuleImport({
          source: '@scope/ui/shared/chip.module.less',
          importer: entryFile,
          importerPackageRoot: project.root,
        }),
      ).toBeNull();
      const consumerPlugin = createCssModulesPlugin({
        packageRoot: project.root,
        sourceRoot: project.resolve('src'),
      });
      await expect(
        consumerPlugin.resolveId.handler(
          '@scope/ui/shared/chip.module.less',
          entryFile,
        ),
      ).resolves.toEqual({
        id: '@scope/ui/shared/chip.module.less',
        external: true,
      });
      expect(shim).toContain(`"${expectedClass}"`);
      expect(
        project.readFile(
          'node_modules/@scope/ui/dist/es/shared/chip.scoped.css',
        ),
      ).toContain(`.${expectedClass}`);
    } finally {
      await server.close();
    }
  });
});
