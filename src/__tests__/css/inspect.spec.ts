import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createCssInspectModel,
  resolveInspectCssOptions,
  runInspectCssCli,
} from '#auklet/css/inspect';
import {
  createStyleProject,
  type StyleProjectTemplate,
} from '../fixtures/styleProjectTemplate';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

const run = vi.mocked(execa);

describe('createCssInspectModel', () => {
  let fixture: StyleProjectTemplate;

  beforeEach(() => {
    fixture = createStyleProject();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fixture.project.cleanup();
  });

  test('explains configured CSS entries without writing output', async () => {
    const model = await createCssInspectModel({
      packageRoot: fixture.packageRoot,
      aukletConfig: {
        source: fixture.sourceDir,
        output: fixture.outputDir,
        modules: true,
        styles: {
          themes: {
            light: `./${fixture.sourceDir}/themes/light.css`,
            dark: `./${fixture.sourceDir}/themes/dark.css`,
          },
          dependencies: {
            '@scope/theme': {
              entry: '/style.css',
              themes: {
                light: '/themes/light.css',
                dark: '/themes/dark.css',
              },
            },
            '@scope/ui': {
              entry: '/style.css',
              components: ['/components/**.css'],
            },
          },
        },
      },
    });

    expect(model.details).toMatchObject({
      source: fixture.sourceDir,
      output: fixture.outputDir,
      modules: true,
      themes: 2,
      sharedOutputEntries: 0,
    });
    expect(model.sharedOutputEntries).toEqual([]);
    expect(model.packageEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entry: 'index.css',
          parts: [
            'dependencies: @scope/theme/style.css, @scope/ui/style.css',
            'themes: light, dark',
            'module',
          ],
        }),
        expect.objectContaining({
          entry: 'style/external.css',
          parts: ['dependencies: @scope/theme/style.css, @scope/ui/style.css'],
        }),
      ]),
    );
    expect(model.themeFiles).toEqual([
      {
        theme: 'light',
        file: `${fixture.sourceDir}/themes/light.css`,
      },
      {
        theme: 'dark',
        file: `${fixture.sourceDir}/themes/dark.css`,
      },
    ]);
    expect(model.moduleEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceDir: 'components/Button',
          ownStyles: [`${fixture.sourceDir}/components/Button/index.css`],
        }),
        expect.objectContaining({
          sourceDir: 'components/Card',
          imports: expect.arrayContaining([
            '@scope/ui/components/Button.css',
            '@scope/ui/components/Callout.css',
          ]),
        }),
      ]),
    );
    expect(fixture.outputFiles()).toEqual([]);
  });

  test('does not report module entries when modules are disabled', async () => {
    const model = await createCssInspectModel({
      packageRoot: fixture.packageRoot,
      aukletConfig: {
        source: fixture.sourceDir,
        output: fixture.outputDir,
        modules: false,
      },
    });

    expect(model.details.modules).toBe(false);
    expect(model.details.moduleEntries).toBe(0);
    expect(model.moduleEntries).toEqual([]);
  });

  test('does not report CSS entry rows when the package has no CSS inputs', async () => {
    const project = createVirtualProject('auklet-css-inspect-empty-');
    project.writeJson('package.json', {
      name: '@scope/empty',
    });

    const model = await createCssInspectModel({
      packageRoot: project.root,
      aukletConfig: {
        source: 'src',
        output: 'dist',
        modules: true,
      },
    });

    expect(model.details.styleFiles).toBe(0);
    expect(model.details.themes).toBe(0);
    expect(model.packageEntries).toEqual([]);

    project.cleanup();
  });

  test('sorts external dependencies before internal dependencies for inspection', async () => {
    fixture.writeStyle(
      `${fixture.sourceDir}/components/Sorted/index.tsx`,
      `
        import { Button as InternalButton } from "../Button";
        import { Callout } from "@scope/ui/components/Callout";
        import { Button } from "@scope/ui";
        export function Sorted() { return Callout ?? Button ?? InternalButton ?? null; }
      `,
    );
    const model = await createCssInspectModel({
      packageRoot: fixture.packageRoot,
      aukletConfig: {
        source: fixture.sourceDir,
        output: fixture.outputDir,
        modules: true,
        styles: {
          dependencies: {
            '@scope/ui': {
              components: ['/components/**.css'],
            },
          },
        },
      },
    });

    const entry = model.moduleEntries.find(
      (item) => item.sourceDir === 'components/Sorted',
    );

    expect(entry?.imports).toEqual([
      '@scope/ui/components/Button.css',
      '@scope/ui/components/Callout.css',
      '../../Button/style/index.css',
    ]);
  });
});

describe('runInspectCssCli shared.output checks', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-inspect-shared-output-');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    project.cleanup();
  });

  test('exits 1 when shared.output export or dist checks fail', async () => {
    project.writePackageJson({
      name: '@scope/ui',
      type: 'module',
      exports: {
        '.': './dist/es/index.js',
      },
    });
    project.writeAukletConfig(`
      export const config = {
        source: 'src',
        output: 'dist',
        modules: true,
        styles: {
          shared: {
            output: './src/shared/**/*.module.css',
          },
        },
      };
    `);
    project.writeFile('src/shared/chip.module.css', '.chip { color: red; }\n');
    vi.spyOn(process, 'cwd').mockReturnValue(project.root);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(runInspectCssCli([])).resolves.toBe(1);

    const model = await createCssInspectModel({
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
    });
    expect(model.sharedOutputEntries).toEqual([
      expect.objectContaining({
        source: 'shared/chip.module.css',
        exportOk: false,
        distOk: false,
      }),
    ]);
  });

  test('exits 0 when shared.output export and dist checks pass', async () => {
    project.writePackageJson({
      name: '@scope/ui',
      type: 'module',
      exports: {
        './shared/chip.module.css': {
          import: './dist/es/shared/chip.module.css.js',
          default: './dist/es/shared/chip.module.css.js',
        },
      },
    });
    project.writeAukletConfig(`
      export const config = {
        source: 'src',
        output: 'dist',
        modules: true,
        styles: {
          shared: {
            output: './src/shared/**/*.module.css',
          },
        },
      };
    `);
    project.writeFile('src/shared/chip.module.css', '.chip { color: red; }\n');
    project.writeFile(
      'dist/es/shared/chip.module.css.js',
      'import "./chip.scoped.css";\nexport default {"chip":"chip_x"};\n',
    );
    project.writeFile('dist/es/shared/chip.scoped.css', '.chip_x {}\n');
    project.writeFile(
      'dist/lib/shared/chip.module.css.js',
      'require("./chip.scoped.css");\nexports.default = {"chip":"chip_x"};\n',
    );
    project.writeFile('dist/lib/shared/chip.scoped.css', '.chip_x {}\n');
    vi.spyOn(process, 'cwd').mockReturnValue(project.root);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(runInspectCssCli([])).resolves.toBe(0);
  });
});

describe('resolveInspectCssOptions', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-inspect-monorepo-');
    run.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    project.cleanup();
  });

  test('uses workspace child packages when inspect css runs at the workspace root', async () => {
    project.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    project.writeJson('package.json', {
      name: '@scope/root',
      private: true,
    });
    project.writeJson('packages/ui/package.json', {
      name: '@scope/ui',
      private: false,
    });
    project.writeJson('packages/theme/package.json', {
      name: '@scope/theme',
      private: true,
    });
    project.writeFile(
      'packages/ui/auklet.config.js',
      'export const config = { source: "source", modules: true };',
    );

    run.mockResolvedValueOnce({
      failed: false,
      stdout: JSON.stringify([
        {
          name: '@scope/root',
          path: project.root,
          private: true,
        },
        {
          name: '@scope/ui',
          path: project.resolve('packages/ui'),
          private: false,
        },
        {
          name: '@scope/theme',
          path: project.resolve('packages/theme'),
          private: true,
        },
      ]),
      stderr: '',
    } as never);
    vi.spyOn(process, 'cwd').mockReturnValue(project.root);

    const options = await resolveInspectCssOptions(['--output', 'build']);

    expect(options.targets.map((target) => target.packageName)).toEqual([
      '@scope/ui',
      '@scope/theme',
    ]);
    expect(options.targets.map((target) => target.packageRoot)).toEqual([
      project.resolve('packages/ui'),
      project.resolve('packages/theme'),
    ]);
    expect(options.targets[0]?.aukletConfig).toEqual({
      source: 'source',
      output: 'build',
      modules: true,
    });
    expect(options.targets[1]?.aukletConfig).toEqual({
      output: 'build',
    });
  });
});
