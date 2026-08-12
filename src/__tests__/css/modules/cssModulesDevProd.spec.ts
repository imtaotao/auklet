import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { build } from 'tsdown';
import { createCssModulesPlugin } from '#auklet/build/cssModulesPlugin';
import {
  compileCssModule,
  createCssModuleLocalsViteLoadCode,
} from '#auklet/css/modules/compileCssModule';
import { createCssModuleDevStyleSource } from '#auklet/css/vite/cssModuleStyleSource';
import {
  toCssModuleStyleAssetBrowserUrl,
  toCssModuleStyleVirtualId,
} from '#auklet/css/vite/hmr/cssModule';
import { aukletStylePlugin } from '#auklet/css/vite/vitePlugin';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';
import {
  findCssModuleJsOutput,
  loadCssModuleDevPair,
  parseCssModuleDevModule,
  parseCssModuleLocalsLoad,
  parseCssModuleStyleLoad,
  parseModuleLocalsFromChunk,
  readCssModuleProductionMarkers,
  readPluginLoadCode,
  readOutputFiles,
} from './helpers';

const writeCssModulesFixture = (project: VirtualProject) => {
  const sourceRoot = project.resolve('src');
  const file = project.writeFile(
    'src/components/Button/Button.module.css',
    '.button { color: red; }',
  );
  project.writeFile(
    'src/components/Button/index.tsx',
    `import styles from './Button.module.css';\nexport const className = styles.button;\n`,
  );
  project.writeFile(
    'src/css-modules.d.ts',
    `declare module '*.module.css' {\n  const classes: Record<string, string>;\n  export default classes;\n}\n`,
  );
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

  return { sourceRoot, file };
};

describe('CSS Modules dev and production semantics', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-modules-dev-prod-');
    project.writeJson('package.json', { name: '@scope/app' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    project.cleanup();
  });

  const compile = (file: string) =>
    compileCssModule({
      file,
      packageRoot: project.root,
      sourceRoot: project.resolve('src'),
    });

  test('compileCssModule matches aukletStylePlugin load for *.module.css', async () => {
    const file = project.writeFile(
      'src/components/Button/Button.module.css',
      `
        .button { color: red; }
        :global(.theme) { color: blue; }
      `,
    );
    const production = await compile(file);
    const plugin = aukletStylePlugin({ root: project.root });
    const loadContext = { addWatchFile: vi.fn() };
    const { localsCode, styleCode } = await loadCssModuleDevPair(
      plugin,
      loadContext,
      file,
    );

    expect(localsCode).toBeTruthy();
    expect(styleCode).toBeTruthy();
    const dev = parseCssModuleDevModule(localsCode!, styleCode!);

    expect(dev.locals).toEqual(production.locals);
    expect(dev.css).toBe(production.css);
  });

  test('compileCssModule matches aukletStylePlugin load for *.module.less', async () => {
    project.writeFile(
      'src/components/Card/tokens.less',
      `
        @brand: tomato;
        :root { --brand: @brand; }
      `,
    );
    const file = project.writeFile(
      'src/components/Card/Card.module.less',
      `
        @import "./tokens.less";
        .card { color: var(--brand); }
      `,
    );
    const production = await compile(file);
    const plugin = aukletStylePlugin({ root: project.root });
    const loadContext = { addWatchFile: vi.fn() };
    const { localsCode, styleCode } = await loadCssModuleDevPair(
      plugin,
      loadContext,
      file,
    );

    expect(localsCode).toBeTruthy();
    expect(styleCode).toBeTruthy();
    const dev = parseCssModuleDevModule(localsCode!, styleCode!);

    expect(dev.locals).toEqual(production.locals);
    expect(dev.css).toBe(createCssModuleDevStyleSource(file, production));
    expect(production.css).toContain('@import "./tokens.css"');
  });

  test('Tag-like module.less keeps imports in production and dev CSS sources', async () => {
    project.writeFile(
      'src/components/Tag/tokens.less',
      ':root { --tag-color: #0f766e; }',
    );
    const file = project.writeFile(
      'src/components/Tag/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );
    const result = await compile(file);
    const plugin = aukletStylePlugin({ root: project.root });
    const loadContext = { addWatchFile: vi.fn() };
    const { localsCode, styleCode } = await loadCssModuleDevPair(
      plugin,
      loadContext,
      file,
    );

    expect(result.css).toContain('@import "./tokens.css"');
    expect(result.css).toContain('color: var(--tag-color)');
    expect(result.styleAssets).toEqual([
      expect.objectContaining({
        file: path.resolve(project.root, 'src/components/Tag/tokens.less'),
      }),
    ]);

    const devStyleSource = createCssModuleDevStyleSource(file, result);
    expect(devStyleSource).toContain('color: var(--tag-color)');
    expect(devStyleSource).toContain(
      toCssModuleStyleAssetBrowserUrl(
        file,
        project.resolve('src/components/Tag/tokens.less'),
      ),
    );
    expect(devStyleSource).not.toContain('--tag-color: #0f766e');

    expect(readPluginLoadCode(localsCode)).toBe(
      createCssModuleLocalsViteLoadCode(
        result,
        toCssModuleStyleVirtualId(path.resolve(file)),
      ),
    );
    expect(readPluginLoadCode(styleCode)).toBe(devStyleSource);
    expect(parseCssModuleStyleLoad(styleCode!).css).toBe(devStyleSource);
    expect(parseCssModuleLocalsLoad(localsCode!).locals).toEqual(result.locals);
  });

  test('protocol, Vite load, and tsdown virtual chunk share locals', async () => {
    const { sourceRoot, file } = writeCssModulesFixture(project);
    const protocol = await compile(file);

    const plugin = aukletStylePlugin({ root: project.root });
    const loadContext = { addWatchFile: vi.fn() };
    const { localsCode } = await loadCssModuleDevPair(
      plugin,
      loadContext,
      file,
    );
    const dev = parseCssModuleLocalsLoad(localsCode!);

    const outDir = project.resolve('dist/es');
    await build({
      cwd: project.root,
      root: project.root,
      entry: {
        Button: 'src/components/Button/index.tsx',
      },
      format: 'esm',
      outDir,
      dts: false,
      unbundle: true,
      platform: 'neutral',
      target: 'es2020',
      tsconfig: path.join(project.root, 'tsconfig.json'),
      plugins: [createCssModulesPlugin({ sourceRoot })],
    });

    const moduleJs = findCssModuleJsOutput(
      readOutputFiles(outDir),
      'Button.module.css',
    );
    expect(moduleJs).toBeTruthy();

    const tsdownLocals = parseModuleLocalsFromChunk(
      fs.readFileSync(moduleJs!.full, 'utf8'),
    );

    expect(dev.locals).toEqual(protocol.locals);
    expect(tsdownLocals).toEqual(protocol.locals);
  }, 30_000);

  test('Vite dev load stays dev-only while tsdown production avoids browser runtime', async () => {
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
    project.writeFile(
      'src/css-modules.d.ts',
      `declare module '*.module.less' {\n  const classes: Record<string, string>;\n  export default classes;\n}\n`,
    );
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

    const protocol = await compile(file);
    const plugin = aukletStylePlugin({ root: project.root });
    const loadContext = { addWatchFile: vi.fn() };
    const { localsCode, styleCode } = await loadCssModuleDevPair(
      plugin,
      loadContext,
      file,
    );

    const devModule = parseCssModuleDevModule(localsCode!, styleCode!);

    expect(devModule.hasHotAccept).toBe(false);
    expect(devModule.hasDocumentInjection).toBe(false);
    expect(parseCssModuleLocalsLoad(localsCode!).locals).toEqual(
      protocol.locals,
    );
    expect(parseCssModuleStyleLoad(styleCode!).css).toBe(
      createCssModuleDevStyleSource(file, protocol),
    );

    const sourceRoot = project.resolve('src');
    const outDir = project.resolve('dist/es');
    await build({
      cwd: project.root,
      root: project.root,
      entry: {
        Tag: 'src/components/Tag/index.tsx',
      },
      format: 'esm',
      outDir,
      dts: false,
      unbundle: true,
      platform: 'neutral',
      target: 'es2020',
      tsconfig: path.join(project.root, 'tsconfig.json'),
      plugins: [createCssModulesPlugin({ sourceRoot })],
    });

    const outputs = readOutputFiles(outDir);
    const moduleJs = findCssModuleJsOutput(outputs, 'Tag.module.less');
    const moduleCss = outputs.find((item) =>
      item.relative.endsWith('components/Tag/Tag.scoped.css'),
    );
    const tokensCss = outputs.find((item) =>
      item.relative.endsWith('components/Tag/tokens.css'),
    );

    expect(moduleJs).toBeTruthy();
    expect(moduleCss).toBeTruthy();
    expect(tokensCss).toBeTruthy();

    const moduleJsCode = fs.readFileSync(moduleJs!.full, 'utf8');
    const moduleCssCode = fs.readFileSync(moduleCss!.full, 'utf8');
    const tokensCssCode = fs.readFileSync(tokensCss!.full, 'utf8');
    const entryCode = fs.readFileSync(
      outputs.find((item) => item.relative === 'Tag.mjs')!.full,
      'utf8',
    );

    const productionMarkers = readCssModuleProductionMarkers(moduleJsCode);
    const entryMarkers = readCssModuleProductionMarkers(entryCode);

    expect(parseModuleLocalsFromChunk(moduleJsCode)).toEqual(protocol.locals);
    expect(productionMarkers.hasHotAccept).toBe(false);
    expect(productionMarkers.hasDocumentInjection).toBe(false);
    expect(productionMarkers.hasDevRuntimePrefix).toBe(false);
    expect(entryMarkers.hasHotAccept).toBe(false);
    expect(entryMarkers.hasDocumentInjection).toBe(false);
    expect(entryMarkers.hasDevRuntimePrefix).toBe(false);
    expect(entryMarkers.hasDocumentHeadInjection).toBe(false);
    expect(entryCode).toContain('Tag.module.less.mjs');
    expect(moduleJsCode).toMatch(/Tag\.scoped\.css/);
    expect(moduleCssCode).toContain('@import "./tokens.css"');
    expect(moduleCssCode).toContain('color: var(--tag-color)');
    expect(moduleCssCode).toContain(Object.values(protocol.locals)[0]);
    expect(tokensCssCode).toContain('--tag-color: #0f766e');
    expect(moduleCssCode).not.toContain('import.meta.hot');
    expect(moduleCssCode).not.toContain('data-auklet-css-modules');
  }, 30_000);

  test('edited Tag.module.less keeps dev CSS source aligned with the compile protocol', async () => {
    project.writeFile(
      'src/components/Tag/tokens.less',
      ':root { --tag-color: #0f766e; }',
    );
    const file = project.writeFile(
      'src/components/Tag/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );
    const plugin = aukletStylePlugin({ root: project.root });
    const loadContext = { addWatchFile: vi.fn() };

    const firstProtocol = await compile(file);
    const firstDev = await loadCssModuleDevPair(plugin, loadContext, file);
    expect(parseCssModuleStyleLoad(firstDev.styleCode!).css).toBe(
      createCssModuleDevStyleSource(file, firstProtocol),
    );

    project.writeFile(
      'src/components/Tag/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); font-weight: 700; }',
    );
    project.writeFile(
      'src/components/Tag/tokens.less',
      ':root { --tag-color: #111827; }',
    );

    const secondProtocol = await compile(file);
    const secondDev = await loadCssModuleDevPair(plugin, loadContext, file);

    expect(parseCssModuleStyleLoad(secondDev.styleCode!).css).toBe(
      createCssModuleDevStyleSource(file, secondProtocol),
    );
    expect(parseCssModuleStyleLoad(secondDev.styleCode!).css).toContain(
      'font-weight: 700',
    );
    expect(parseCssModuleStyleLoad(secondDev.styleCode!).css).toContain(
      toCssModuleStyleAssetBrowserUrl(
        file,
        project.resolve('src/components/Tag/tokens.less'),
      ),
    );
    expect(parseCssModuleLocalsLoad(secondDev.localsCode!).locals).toEqual(
      secondProtocol.locals,
    );
    expect(parseCssModuleStyleLoad(secondDev.styleCode!).css).not.toBe(
      parseCssModuleStyleLoad(firstDev.styleCode!).css,
    );
  });
});
