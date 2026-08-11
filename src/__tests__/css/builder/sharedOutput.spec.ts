import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createGenerateScopedName } from '#auklet/css/modules/generateScopedName';
import { ModuleStyleBuilder } from '#auklet/css/production/builder';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

describe('styles.shared.output', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-shared-output-');
    project.writePackageJson({
      name: '@scope/ui',
      version: '0.0.1',
      type: 'module',
    });
  });

  afterEach(() => {
    project.cleanup();
  });

  test('compiles matched CSS Modules into dist/es|lib with JS locals', async () => {
    const moduleFile = project.writeFile(
      'src/shared/chip.module.less',
      '@import "./helpers.css";\n.chip { color: red; }\n',
    );
    project.writeFile(
      'src/shared/helpers.css',
      '.helper { display: block; }\n',
    );

    await new ModuleStyleBuilder({
      packageRoot: project.root,
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
      packageRoot: project.root,
      sourceRoot: project.resolve('src'),
    })('chip', moduleFile, '');
    const esCss = project.readFile('dist/es/shared/chip.scoped.css');
    const esJs = project.readFile('dist/es/shared/chip.module.less.js');
    const libJs = project.readFile('dist/lib/shared/chip.module.less.js');

    expect(esCss).toContain(`.${expectedClass}`);
    expect(esCss).toContain('@import');
    expect(project.readFile('dist/es/shared/helpers.css')).toContain('.helper');
    expect(esJs).toContain('import "./chip.scoped.css"');
    expect(esJs).toContain(
      `export default ${JSON.stringify({ chip: expectedClass })}`,
    );
    expect(libJs).toContain('require("./chip.scoped.css")');
    expect(libJs).toContain(
      `exports.default = ${JSON.stringify({ chip: expectedClass })}`,
    );
    expect(libJs).not.toContain('export default');
    expect(project.exists('dist/es/shared/chip.module.css')).toBe(false);
    expect(project.exists('dist/shared/chip.module.less')).toBe(false);
  });

  test('requires modules: true when output includes CSS Modules', async () => {
    project.writeFile('src/shared/chip.module.css', '.chip { color: red; }\n');

    await expect(
      new ModuleStyleBuilder({
        packageRoot: project.root,
        aukletConfig: {
          source: 'src',
          output: 'dist',
          modules: false,
          styles: {
            shared: {
              output: './src/shared/**/*.module.css',
            },
          },
        },
      }).build(),
    ).rejects.toThrow(
      'styles.shared.output CSS Modules entries require modules: true',
    );
  });

  test('copies plain css/less to dist without compiling Less', async () => {
    const lessSource =
      '@brand-color: #111827;\n.token { color: @brand-color; }\n';
    project.writeFile(
      'src/shared/helpers.css',
      '.helper { display: block; }\n',
    );
    project.writeFile('src/shared/tokens.less', lessSource);

    await new ModuleStyleBuilder({
      packageRoot: project.root,
      aukletConfig: {
        source: 'src',
        output: 'dist',
        modules: false,
        styles: {
          shared: {
            output: ['./src/shared/helpers.css', './src/shared/tokens.less'],
          },
        },
      },
    }).build();

    expect(project.readFile('dist/es/shared/helpers.css')).toContain('.helper');
    expect(project.readFile('dist/lib/shared/helpers.css')).toContain(
      '.helper',
    );
    expect(project.readFile('dist/es/shared/tokens.less')).toBe(lessSource);
    expect(project.readFile('dist/lib/shared/tokens.less')).toBe(lessSource);
    expect(project.exists('dist/es/shared/tokens.css')).toBe(false);
  });

  test('keeps shared.output helpers out of global style/module.css', async () => {
    project.writeFile(
      'src/components/Button/index.tsx',
      'export const Button = () => null;\n',
    );
    project.writeFile('src/components/Button/index.css', '.button {}\n');
    project.writeFile(
      'src/shared/chip.module.less',
      '@import "./helpers.css";\n.chip { color: red; }\n',
    );
    project.writeFile(
      'src/shared/helpers.css',
      '.helper { display: block; }\n',
    );

    await new ModuleStyleBuilder({
      packageRoot: project.root,
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

    const moduleCss = project.readFile('dist/es/style/module.css');
    expect(moduleCss).toContain('components/Button');
    expect(moduleCss).not.toContain('shared/helpers');
    expect(moduleCss).not.toContain('chip.scoped');
    expect(project.exists('dist/es/shared/helpers.css')).toBe(true);
  });

  test('emits cross-package sibling assets under shared-package/', async () => {
    project.writePackageJson({
      name: '@scope/app',
      version: '0.0.1',
      type: 'module',
      dependencies: {
        '@scope/ui': '0.0.1',
      },
    });
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './shared/helpers.css': './dist/shared/helpers.css',
      },
    });
    project.writeFile(
      'node_modules/@scope/ui/dist/shared/helpers.css',
      '.helper { display: block; }\n',
    );
    project.writeFile(
      'src/shared/chip.module.css',
      '@import "@scope/ui/shared/helpers.css";\n.chip { color: red; }\n',
    );

    await new ModuleStyleBuilder({
      packageRoot: project.root,
      aukletConfig: {
        source: 'src',
        output: 'dist',
        modules: true,
        styles: {
          shared: {
            output: './src/shared/**/*.module.css',
          },
        },
      },
    }).build();

    const assetRelative = 'shared-package/@scope/ui/dist/shared/helpers.css';
    expect(project.readFile(`dist/es/${assetRelative}`)).toContain('.helper');
    expect(project.readFile(`dist/lib/${assetRelative}`)).toContain('.helper');

    const esCss = project.readFile('dist/es/shared/chip.scoped.css');
    expect(esCss).toContain(
      '@import "../shared-package/@scope/ui/dist/shared/helpers.css"',
    );
    expect(esCss).not.toContain('node_modules');
  });

  test('rejects unsupported shared.output extensions', async () => {
    project.writeFile('src/shared/readme.md', '# shared\n');

    await expect(
      new ModuleStyleBuilder({
        packageRoot: project.root,
        aukletConfig: {
          source: 'src',
          output: 'dist',
          modules: false,
          styles: {
            shared: {
              output: './src/shared/**/*',
            },
          },
        },
      }).build(),
    ).rejects.toThrow('must match CSS Modules');
  });
});
