import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  loadPackageStyleCss,
  resolvePlainPackageStyleFile,
} from '#auklet/css/core/packageStyleSource';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

describe('packageStyleSource', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-package-style-source-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('resolves exported package CSS and loads CSS text', async () => {
    project.writePackageJson({
      name: '@scope/app',
      dependencies: { '@scope/ui': '0.0.1' },
    });
    const cssFile = project.writeFile(
      'node_modules/@scope/ui/dist/shared/helpers.css',
      '.helper { display: block; }\n',
    );
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './shared/helpers.css': './dist/shared/helpers.css',
      },
    });

    expect(
      resolvePlainPackageStyleFile(
        '@scope/ui/shared/helpers.css',
        project.root,
      ),
    ).toBe(cssFile);
    expect(await loadPackageStyleCss(cssFile)).toBe(
      '.helper { display: block; }\n',
    );
  });

  test('compiles exported package Less to CSS text', async () => {
    project.writePackageJson({
      name: '@scope/app',
      dependencies: { '@scope/ui': '0.0.1' },
    });
    const lessFile = project.writeFile(
      'node_modules/@scope/ui/dist/shared/tokens.less',
      '@color: blue;\n.token { color: @color; }\n',
    );
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './shared/tokens.less': {
          less: './dist/shared/tokens.less',
          default: './dist/shared/tokens.less',
        },
      },
    });

    expect(
      resolvePlainPackageStyleFile(
        '@scope/ui/shared/tokens.less',
        project.root,
      ),
    ).toBe(lessFile);
    const css = await loadPackageStyleCss(lessFile);
    expect(css).toContain('.token');
    expect(css).toContain('color: blue');
  });

  test('ignores CSS Modules package specifiers', () => {
    project.writePackageJson({
      name: '@scope/app',
      dependencies: { '@scope/ui': '0.0.1' },
    });
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './chip.module.css': './dist/chip.module.css',
      },
    });
    project.writeFile(
      'node_modules/@scope/ui/dist/chip.module.css',
      '.chip {}\n',
    );

    expect(
      resolvePlainPackageStyleFile('@scope/ui/chip.module.css', project.root),
    ).toBeNull();
  });
});
