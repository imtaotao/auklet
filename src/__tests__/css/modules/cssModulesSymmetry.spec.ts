import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { build } from 'tsdown';
import { createCssModulesPlugin } from '#auklet/build/cssModulesPlugin';
import { compileCssModule } from '#auklet/css/modules/compileCssModule';
import { createCssModuleDevStyleSource } from '#auklet/css/vite/cssModuleStyleSource';
import { aukletStylePlugin } from '#auklet/css/vite/vitePlugin';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';
import {
  loadCssModuleDevPair,
  parseCssModuleDevModule,
  parseModuleLocalsFromChunk,
  readCssModuleProductionMarkers,
  parseCssSideEffect,
  readFileFromOutputs,
  findCssModuleJsOutput,
  readOutputFiles,
} from './helpers';

const writeCssModulesTsconfig = (project: VirtualProject) => {
  project.writeFile(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: true,
      },
      include: ['src'],
    }),
  );
};

const writeTagLessFixture = (project: VirtualProject) => {
  writeCssModulesTsconfig(project);
  project.writeFile(
    'src/css-modules.d.ts',
    `declare module '*.module.less' {\n  const classes: Record<string, string>;\n  export default classes;\n}\n`,
  );
  project.writeFile(
    'src/components/Tag/tokens.less',
    ':root { --tag-color: #0f766e; }',
  );
  const file = project.writeFile(
    'src/components/Tag/Tag.module.less',
    '@import "./tokens.less";\n.tag { color: var(--tag-color); font-size: 12px; }',
  );
  project.writeFile(
    'src/components/Tag/index.tsx',
    `import styles from './Tag.module.less';\nexport const className = styles.tag;\n`,
  );

  return file;
};

const writeButtonCssFixture = (project: VirtualProject) => {
  writeCssModulesTsconfig(project);
  project.writeFile(
    'src/css-modules.d.ts',
    `declare module '*.module.css' {\n  const classes: Record<string, string>;\n  export default classes;\n}\n`,
  );
  const file = project.writeFile(
    'src/components/Button/Button.module.css',
    '.button { color: red; }',
  );
  project.writeFile(
    'src/components/Button/index.tsx',
    `import styles from './Button.module.css';\nexport const className = styles.button;\n`,
  );

  return file;
};

const productionFormats = [
  { format: 'esm' as const, outDir: 'dist/es' },
  { format: 'cjs' as const, outDir: 'dist/lib' },
];

const buildProductionFormat = async (
  project: VirtualProject,
  sourceRoot: string,
  entry: Record<string, string>,
  item: (typeof productionFormats)[number],
) => {
  await build({
    cwd: project.root,
    root: project.root,
    entry,
    format: item.format,
    outDir: project.resolve(item.outDir),
    dts: false,
    unbundle: true,
    platform: 'neutral',
    target: 'es2020',
    tsconfig: path.join(project.root, 'tsconfig.json'),
    plugins: [createCssModulesPlugin({ sourceRoot })],
  });

  return readOutputFiles(project.resolve(item.outDir));
};

describe('CSS Modules dev and production symmetry', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-modules-symmetry-');
    project.writeJson('package.json', { name: '@scope/app' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    project.cleanup();
  });

  test('Tag.module.less keeps dev references aligned while esm and cjs production stay symmetric', async () => {
    const file = writeTagLessFixture(project);
    const sourceRoot = project.resolve('src');
    const protocol = await compileCssModule({
      file,
      packageRoot: project.root,
      sourceRoot,
    });
    const plugin = aukletStylePlugin({ root: project.root });
    const { localsCode, styleCode } = await loadCssModuleDevPair(
      plugin,
      { addWatchFile: vi.fn() },
      file,
    );
    const dev = parseCssModuleDevModule(localsCode!, styleCode!);

    expect(dev.locals).toEqual(protocol.locals);
    expect(dev.css).toBe(createCssModuleDevStyleSource(file, protocol));
    expect(dev.css).not.toContain('--tag-color: #0f766e');
    expect(dev.css).toContain(Object.values(protocol.locals)[0]);
    expect(dev.css).toContain('@import');

    const outputsByFormat = new Map<
      (typeof productionFormats)[number]['format'],
      ReturnType<typeof readOutputFiles>
    >();

    for (const item of productionFormats) {
      outputsByFormat.set(
        item.format,
        await buildProductionFormat(
          project,
          sourceRoot,
          { Tag: 'src/components/Tag/index.tsx' },
          item,
        ),
      );
    }

    const esOutputs = outputsByFormat.get('esm')!;
    const cjsOutputs = outputsByFormat.get('cjs')!;

    const esModuleJs = findCssModuleJsOutput(esOutputs, 'Tag.module.less');
    const cjsModuleJs = findCssModuleJsOutput(cjsOutputs, 'Tag.module.less');

    expect(esModuleJs).toBeTruthy();
    expect(cjsModuleJs).toBeTruthy();

    const esModuleJsCode = fs.readFileSync(esModuleJs!.full, 'utf8');
    const cjsModuleJsCode = fs.readFileSync(cjsModuleJs!.full, 'utf8');

    const esLocals = parseModuleLocalsFromChunk(esModuleJsCode);
    const cjsLocals = parseModuleLocalsFromChunk(cjsModuleJsCode);

    expect(esLocals).toEqual(protocol.locals);
    expect(cjsLocals).toEqual(protocol.locals);

    const esModuleCss = readFileFromOutputs(
      esOutputs,
      'components/Tag/Tag.module.css',
    );
    const cjsModuleCss = readFileFromOutputs(
      cjsOutputs,
      'components/Tag/Tag.module.css',
    );
    const esTokensCss = readFileFromOutputs(
      esOutputs,
      'components/Tag/tokens.css',
    );
    const cjsTokensCss = readFileFromOutputs(
      cjsOutputs,
      'components/Tag/tokens.css',
    );

    expect(esModuleCss).toBe(cjsModuleCss);
    expect(esTokensCss).toBe(cjsTokensCss);
    expect(esModuleCss).toContain('@import "./tokens.css"');
    expect(esModuleCss).toContain('color: var(--tag-color)');
    expect(esModuleCss).toContain(Object.values(protocol.locals)[0]);
    expect(esModuleCss).not.toContain('--tag-color: #0f766e');
    expect(esTokensCss).toContain('--tag-color: #0f766e');

    const esSideEffect = parseCssSideEffect(
      fs.readFileSync(esModuleJs!.full, 'utf8'),
    );
    const cjsSideEffect = parseCssSideEffect(
      fs.readFileSync(cjsModuleJs!.full, 'utf8'),
    );

    expect(esSideEffect).toBe(cjsSideEffect);
    expect(esSideEffect).toBe('./components/Tag/Tag.module.css');
    expect(
      fs.existsSync(
        path.resolve(path.dirname(esModuleJs!.full), esSideEffect!),
      ),
    ).toBe(true);
    expect(fs.readFileSync(esModuleJs!.full, 'utf8')).toMatch(/^import\s+/m);
    expect(fs.readFileSync(cjsModuleJs!.full, 'utf8')).toContain('require(');

    for (const outputs of [esOutputs, cjsOutputs]) {
      for (const output of outputs) {
        const code = fs.readFileSync(output.full, 'utf8');
        const markers = readCssModuleProductionMarkers(code);
        expect(markers.hasHotAccept).toBe(false);
        expect(markers.hasDocumentInjection).toBe(false);
        expect(markers.hasDevRuntimePrefix).toBe(false);
        expect(markers.hasDocumentHeadInjection).toBe(false);
      }
    }
  }, 60_000);

  test('Button.module.css keeps dev inject and esm/cjs production css symmetric', async () => {
    const file = writeButtonCssFixture(project);
    const sourceRoot = project.resolve('src');
    const protocol = await compileCssModule({
      file,
      packageRoot: project.root,
      sourceRoot,
    });
    const plugin = aukletStylePlugin({ root: project.root });
    const { localsCode, styleCode } = await loadCssModuleDevPair(
      plugin,
      { addWatchFile: vi.fn() },
      file,
    );
    const dev = parseCssModuleDevModule(localsCode!, styleCode!);

    expect(dev.locals).toEqual(protocol.locals);
    expect(dev.css).toBe(protocol.css);

    const outputsByFormat = new Map<
      (typeof productionFormats)[number]['format'],
      ReturnType<typeof readOutputFiles>
    >();

    for (const item of productionFormats) {
      outputsByFormat.set(
        item.format,
        await buildProductionFormat(
          project,
          sourceRoot,
          { Button: 'src/components/Button/index.tsx' },
          item,
        ),
      );
    }

    const esOutputs = outputsByFormat.get('esm')!;
    const cjsOutputs = outputsByFormat.get('cjs')!;

    const esModuleJs = findCssModuleJsOutput(esOutputs, 'Button.module.css');
    const cjsModuleJs = findCssModuleJsOutput(cjsOutputs, 'Button.module.css');

    expect(esModuleJs).toBeTruthy();
    expect(cjsModuleJs).toBeTruthy();

    const esLocals = parseModuleLocalsFromChunk(
      fs.readFileSync(esModuleJs!.full, 'utf8'),
    );
    const cjsLocals = parseModuleLocalsFromChunk(
      fs.readFileSync(cjsModuleJs!.full, 'utf8'),
    );

    expect(esLocals).toEqual(protocol.locals);
    expect(cjsLocals).toEqual(protocol.locals);

    const esModuleCss = readFileFromOutputs(
      esOutputs,
      'components/Button/Button.module.css',
    );
    const cjsModuleCss = readFileFromOutputs(
      cjsOutputs,
      'components/Button/Button.module.css',
    );

    expect(esModuleCss).toBe(cjsModuleCss);
    expect(esModuleCss.trim()).toBe(protocol.css.trim());
    expect(dev.css).toBe(esModuleCss.trim());

    const esSideEffect = parseCssSideEffect(
      fs.readFileSync(esModuleJs!.full, 'utf8'),
    );
    const cjsSideEffect = parseCssSideEffect(
      fs.readFileSync(cjsModuleJs!.full, 'utf8'),
    );

    expect(esSideEffect).toBe(cjsSideEffect);
    expect(esSideEffect).toBe('./components/Button/Button.module.css');
    expect(
      fs.existsSync(
        path.resolve(path.dirname(esModuleJs!.full), esSideEffect!),
      ),
    ).toBe(true);
  }, 60_000);
});
