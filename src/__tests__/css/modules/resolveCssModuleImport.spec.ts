import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { resolveCssModuleImport } from '#auklet/css/modules/resolveCssModuleImport';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

describe('resolveCssModuleImport', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-module-resolve-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('resolves relative imports from a TS importer directory', () => {
    const moduleFile = project.writeFile(
      'src/Button.module.css',
      '.button { color: red; }',
    );
    const importer = project.resolve('src/Button.tsx');

    expect(
      resolveCssModuleImport({
        source: './Button.module.css',
        importer,
      }),
    ).toBe(moduleFile);
  });

  test('resolves absolute module file imports', () => {
    const moduleFile = project.writeFile(
      'vendor/Widget.module.less',
      '.widget { color: red; }',
    );

    expect(
      resolveCssModuleImport({
        source: moduleFile,
        importer: project.resolve('src/App.tsx'),
      }),
    ).toBe(path.resolve(moduleFile));
  });

  test('rejects alias and bare specifiers', () => {
    project.writeFile('src/Button.module.css', '.button {}');
    const importer = project.resolve('src/Button.tsx');

    expect(
      resolveCssModuleImport({
        source: '@alias/Button.module.css',
        importer,
      }),
    ).toBeNull();
    expect(
      resolveCssModuleImport({
        source: 'Button.module.css',
        importer,
      }),
    ).toBeNull();
  });

  test('rejects foreign Vite virtual sources and importers', () => {
    project.writeFile('src/Button.module.css', '.button {}');
    const foreignImporters = [
      '\0virtual:mf:__mfe_internal__host__loadShare__react__loadShare__.js',
      '\0vite/preload-helper.js',
      '\0plugin-vue:export-helper',
    ];

    for (const foreignImporter of foreignImporters) {
      expect(
        resolveCssModuleImport({
          source: foreignImporter,
          importer: project.resolve('src/Button.tsx'),
        }),
      ).toBeNull();
      expect(
        resolveCssModuleImport({
          source: './Button.module.css',
          importer: foreignImporter,
        }),
      ).toBeNull();
    }
  });

  test('returns null when the module file does not exist', () => {
    const importer = project.resolve('src/Button.tsx');

    expect(
      resolveCssModuleImport({
        source: './Missing.module.css',
        importer,
      }),
    ).toBeNull();
  });

  test('allows missing files when requireExistingFile is false', () => {
    const importer = project.resolve('src/Button.tsx');
    const missing = path.resolve(path.dirname(importer), 'Future.module.css');

    expect(
      resolveCssModuleImport({
        source: './Future.module.css',
        importer,
        requireExistingFile: false,
      }),
    ).toBe(missing);
  });

  test('uses parseModuleFileFromId for synthetic module ids', () => {
    const moduleFile = project.writeFile(
      'src/components/Tag/Tag.module.less',
      '.tag {}',
    );
    const syntheticId = path.join(
      project.resolve('src'),
      'components/Tag/Tag.module.less.js',
    );

    expect(
      resolveCssModuleImport({
        source: syntheticId,
        parseModuleFileFromId: (id) =>
          id.endsWith('.module.less.js') ? id.slice(0, -'.js'.length) : null,
      }),
    ).toBe(path.resolve(moduleFile));
  });

  test('resolves package-exported CSS Modules through package exports', () => {
    project.writePackageJson({
      name: '@scope/app',
      dependencies: {
        '@scope/ui': '0.0.1',
      },
    });
    const moduleFile = project.writeFile(
      'node_modules/@scope/ui/dist/shared/chip.module.less',
      '.chip { color: red; }',
    );
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './shared/chip.module.less': {
          less: './dist/shared/chip.module.less',
          source: './dist/shared/chip.module.less',
          default: './dist/shared/chip.module.less',
        },
      },
    });
    const importer = project.writeFile('src/App.tsx', 'export {};');

    expect(
      resolveCssModuleImport({
        source: '@scope/ui/shared/chip.module.less',
        importer,
        importerPackageRoot: project.root,
      }),
    ).toBe(path.resolve(moduleFile));
  });

  test('passes through package exports that point at a published JS shim', () => {
    project.writePackageJson({
      name: '@scope/app',
      dependencies: {
        '@scope/ui': '0.0.1',
      },
    });
    project.writeFile(
      'node_modules/@scope/ui/dist/es/shared/chip.module.less.js',
      'import "./chip.scoped.css";\nexport default {"chip":"chip_x"};\n',
    );
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './shared/chip.module.less': {
          import: './dist/es/shared/chip.module.less.js',
          default: './dist/es/shared/chip.module.less.js',
        },
      },
    });
    const importer = project.writeFile('src/App.tsx', 'export {};');

    // null → let the bundler load the published shim as plain JS.
    expect(
      resolveCssModuleImport({
        source: '@scope/ui/shared/chip.module.less',
        importer,
        importerPackageRoot: project.root,
      }),
    ).toBeNull();
  });
});
