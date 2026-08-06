import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { normalizeAukletConfig } from '#auklet/config';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

describe('StylePackageContext style file discovery', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-style-package-context-');
    project.writePackageJson({ name: '@scope/app' });
  });

  afterEach(() => {
    project.cleanup();
  });

  test('excludes CSS Modules files from styleFiles', () => {
    project.writeFile('src/components/Button/index.css', '.button {}');
    project.writeFile('src/components/Button/Button.module.css', '.mod {}');
    project.writeFile('src/components/Card/Card.module.less', '.card {}');

    const packageContext = new StylePackageContext({
      config: moduleStyleBuildConfig,
      context: {
        packageRoot: project.root,
        sourceDir: 'src',
        outputDir: 'dist',
      },
      normalizedConfig: normalizeAukletConfig({
        source: 'src',
        output: 'dist',
        modules: true,
      }),
    });

    for (const styleFile of packageContext.styleFiles) {
      expect(isCssModuleFile(styleFile)).toBe(false);
    }

    expect(packageContext.styleFiles).toEqual(
      expect.arrayContaining([
        project.resolve('src/components/Button/index.css'),
      ]),
    );
    expect(
      packageContext.styleFiles.some((styleFile) =>
        styleFile.endsWith('Button.module.css'),
      ),
    ).toBe(false);
    expect(
      packageContext.styleFiles.some((styleFile) =>
        styleFile.endsWith('Card.module.less'),
      ),
    ).toBe(false);
  });

  test('excludes Less partials referenced only by CSS Modules from styleFiles', async () => {
    project.writeFile('src/components/Tag/tokens.less', '@tag-color: purple;');
    project.writeFile(
      'src/components/Tag/Tag.module.less',
      `
        @import "./tokens.less";
        .tag { color: @tag-color; }
      `,
    );
    project.writeFile(
      'src/components/Card/tokens.css',
      '.card-token { margin: 0; }',
    );
    project.writeFile(
      'src/components/Card/index.css',
      '@import "./tokens.css";\n.card {}',
    );

    const packageContext = new StylePackageContext({
      config: moduleStyleBuildConfig,
      context: {
        packageRoot: project.root,
        sourceDir: 'src',
        outputDir: 'dist',
      },
      normalizedConfig: normalizeAukletConfig({
        source: 'src',
        output: 'dist',
        modules: true,
      }),
    });

    expect(
      packageContext.styleFiles.some((styleFile) =>
        styleFile.endsWith('Tag/tokens.less'),
      ),
    ).toBe(true);

    await packageContext.prepareStyleLanguage();

    expect(
      packageContext.styleFiles.some((styleFile) =>
        styleFile.endsWith('Tag/tokens.less'),
      ),
    ).toBe(false);
    expect(
      packageContext.styleFiles.some((styleFile) =>
        styleFile.endsWith('Card/tokens.css'),
      ),
    ).toBe(true);
  });

  test('keeps css partials referenced only by CSS Modules in styleFiles', async () => {
    project.writeFile(
      'src/components/Button/tokens.css',
      ':root { --button-color: tomato; }',
    );
    project.writeFile(
      'src/components/Button/Button.module.css',
      '@import "./tokens.css";\n.button {}',
    );
    project.writeFile('src/components/Tag/tokens.less', '@tag-color: purple;');
    project.writeFile(
      'src/components/Tag/Tag.module.less',
      '@import "./tokens.less";\n.tag {}',
    );

    const packageContext = new StylePackageContext({
      config: moduleStyleBuildConfig,
      context: {
        packageRoot: project.root,
        sourceDir: 'src',
        outputDir: 'dist',
      },
      normalizedConfig: normalizeAukletConfig({
        source: 'src',
        output: 'dist',
        modules: true,
      }),
    });

    await packageContext.prepareStyleLanguage();

    expect(
      packageContext.styleFiles.some((styleFile) =>
        styleFile.endsWith('Button/tokens.css'),
      ),
    ).toBe(true);
    expect(
      packageContext.styleFiles.some((styleFile) =>
        styleFile.endsWith('Tag/tokens.less'),
      ),
    ).toBe(false);
  });
});
