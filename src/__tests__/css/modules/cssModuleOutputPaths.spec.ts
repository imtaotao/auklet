import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  SHARED_PACKAGE_STYLE_OUTPUT_PREFIX,
  toCssModuleOutputFileName,
  toCssModuleOutputImportPath,
  rewriteCssModuleOutputImportSpecifiers,
} from '#auklet/css/modules/cssModuleOutputPaths';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

describe('cssModuleOutputPaths', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-module-output-paths-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('keeps in-source assets relative to sourceRoot', () => {
    const file = project.writeFile('src/shared/helpers.css', '.helper {}\n');
    expect(
      toCssModuleOutputFileName({
        file,
        sourceRoot: project.resolve('src'),
        consumerPackageRoot: project.root,
      }),
    ).toBe('shared/helpers.css');
  });

  test('rewrites compiled CSS Modules to *.scoped.css', () => {
    const cssModule = project.writeFile(
      'src/components/Button/Button.module.css',
      '.button {}\n',
    );
    const lessModule = project.writeFile(
      'src/components/Tag/Tag.module.less',
      '.tag {}\n',
    );
    expect(
      toCssModuleOutputFileName({
        file: cssModule,
        sourceRoot: project.resolve('src'),
        consumerPackageRoot: project.root,
      }),
    ).toBe('components/Button/Button.scoped.css');
    expect(
      toCssModuleOutputFileName({
        file: lessModule,
        sourceRoot: project.resolve('src'),
        consumerPackageRoot: project.root,
      }),
    ).toBe('components/Tag/Tag.scoped.css');
  });

  test('maps dependency package assets under shared-package/', () => {
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
    });
    const file = project.writeFile(
      'node_modules/@scope/ui/dist/shared/helpers.css',
      '.helper {}\n',
    );

    expect(
      toCssModuleOutputFileName({
        file,
        sourceRoot: project.resolve('src'),
        consumerPackageRoot: project.root,
      }),
    ).toBe(
      `${SHARED_PACKAGE_STYLE_OUTPUT_PREFIX}/@scope/ui/dist/shared/helpers.css`,
    );
  });

  test('rewrites relative @import to shared-package output paths', () => {
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
    });
    const importer = project.writeFile(
      'src/shared/chip.module.css',
      '@import "../../node_modules/@scope/ui/dist/shared/helpers.css";\n.chip {}\n',
    );
    const asset = project.writeFile(
      'node_modules/@scope/ui/dist/shared/helpers.css',
      '.helper {}\n',
    );

    const rewritten = rewriteCssModuleOutputImportSpecifiers({
      css: '@import "../../node_modules/@scope/ui/dist/shared/helpers.css";\n.chip {}\n',
      importerFile: importer,
      importerOutputFileName: 'shared/chip.scoped.css',
      styleAssets: [{ file: asset }],
      sourceRoot: project.resolve('src'),
      consumerPackageRoot: project.root,
    });

    expect(rewritten).toContain(
      '@import "../shared-package/@scope/ui/dist/shared/helpers.css"',
    );
    expect(
      toCssModuleOutputImportPath(
        'shared/chip.scoped.css',
        'shared-package/@scope/ui/dist/shared/helpers.css',
      ),
    ).toBe('../shared-package/@scope/ui/dist/shared/helpers.css');
  });

  test('uses basename for same-package files outside sourceRoot', () => {
    project.writePackageJson({ name: '@scope/app' });
    const file = project.writeFile('root-extra.css', '.extra {}\n');
    expect(
      toCssModuleOutputFileName({
        file,
        sourceRoot: project.resolve('src'),
        consumerPackageRoot: project.root,
      }),
    ).toBe('root-extra.css');
  });
});
