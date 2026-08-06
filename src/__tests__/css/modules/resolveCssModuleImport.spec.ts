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
});
