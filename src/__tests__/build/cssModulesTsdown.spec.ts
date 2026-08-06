import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { build } from 'tsdown';
import { createCssModulesPlugin } from '#auklet/build/cssModulesPlugin';
import { normalizeFileKey } from '#auklet/utils';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

const expectedScopedName = (localName: string, filename: string) => {
  const base = path.basename(filename).replace(/\.module\.(css|less)$/i, '');
  const hash = createHash('sha256')
    .update(`${normalizeFileKey(filename)}:${localName}`)
    .digest('base64url')
    .slice(0, 6);
  return `${base}_${localName}_${hash}`;
};

const readOutputFiles = (dir: string, prefix = '') => {
  if (!fs.existsSync(dir))
    return [] as Array<{ relative: string; full: string }>;
  const files: Array<{ relative: string; full: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readOutputFiles(full, relative));
      continue;
    }
    files.push({ relative, full });
  }
  return files;
};

const parseCssImport = (code: string) => {
  const match = code.match(/import\s+("([^"]+)"|'([^']+)')\s*;/);
  return match?.[2] ?? match?.[3] ?? null;
};

const findCssModuleJsOutput = (
  outputs: Array<{ relative: string; full: string }>,
  moduleBaseName: string,
) => {
  const escaped = moduleBaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|/)${escaped}\\.(js|cjs|mjs)$`);
  return outputs.find((file) => pattern.test(file.relative));
};

const parseCssSideEffect = (code: string) => {
  const importPath = parseCssImport(code);
  if (importPath) return importPath;

  const requireMatch = code.match(/require\(("([^"]+)"|'([^']+)')\)/);
  return requireMatch?.[2] ?? requireMatch?.[3] ?? null;
};

describe('css modules via tsdown build', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-modules-tsdown-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('emits css partial assets for *.module.css local imports in build-js output', async () => {
    const sourceRoot = project.resolve('src');
    const moduleCss = project.writeFile(
      'src/components/Button/Button.module.css',
      `
        @import "./tokens.css";
        .button { color: var(--button-color); }
      `,
    );
    project.writeFile(
      'src/components/Button/tokens.css',
      ':root { --button-color: tomato; }',
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

    const outputs = readOutputFiles(outDir);
    const cssOutput = outputs.find(
      (file) => file.relative === 'components/Button/Button.module.css',
    );
    expect(cssOutput).toBeTruthy();
    expect(
      outputs.some((file) => file.relative === 'components/Button/tokens.css'),
    ).toBe(true);

    const scoped = expectedScopedName('button', moduleCss);
    const moduleCssCode = fs.readFileSync(cssOutput!.full, 'utf8');
    expect(moduleCssCode).toContain('@import "./tokens.css"');
    expect(moduleCssCode).toContain(`.${scoped}`);
  }, 30_000);

  test('emits hashed CSS and JS locals without css-guard failure', async () => {
    const sourceRoot = project.resolve('src');
    const moduleCss = project.writeFile(
      'src/Button.module.css',
      '.button { color: tomato; }',
    );
    project.writeFile(
      'src/Button.tsx',
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

    const outDir = project.resolve('dist/es');
    await build({
      cwd: project.root,
      root: project.root,
      entry: {
        Button: 'src/Button.tsx',
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
    const cssOutput = outputs.find(
      (file) => file.relative === 'Button.module.css',
    );
    expect(cssOutput).toBeTruthy();

    const scoped = expectedScopedName('button', moduleCss);
    expect(fs.readFileSync(cssOutput!.full, 'utf8')).toContain(`.${scoped}`);

    const moduleJs = outputs.find((file) =>
      file.relative.endsWith('Button.module.css.js'),
    );
    expect(moduleJs).toBeTruthy();

    const moduleCode = fs.readFileSync(moduleJs!.full, 'utf8');
    const cssImport = parseCssImport(moduleCode);
    expect(cssImport).toBeTruthy();
    expect(
      fs.existsSync(path.resolve(path.dirname(moduleJs!.full), cssImport!)),
    ).toBe(true);
    expect(moduleCode).toContain(scoped);
  }, 30_000);

  test('nested component CSS import resolves to emitted CSS asset', async () => {
    const sourceRoot = project.resolve('src');
    const moduleCss = project.writeFile(
      'src/components/Button/Button.module.css',
      '.button { color: tomato; }',
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

    const outputs = readOutputFiles(outDir);
    const cssOutput = outputs.find(
      (file) => file.relative === 'components/Button/Button.module.css',
    );
    expect(cssOutput).toBeTruthy();

    const moduleJs = outputs.find((file) =>
      file.relative.endsWith('Button.module.css.js'),
    );
    expect(moduleJs).toBeTruthy();

    const moduleCode = fs.readFileSync(moduleJs!.full, 'utf8');
    const cssImport = parseCssImport(moduleCode);
    expect(cssImport).toBeTruthy();
    expect(
      fs.existsSync(path.resolve(path.dirname(moduleJs!.full), cssImport!)),
    ).toBe(true);
    expect(path.resolve(path.dirname(moduleJs!.full), cssImport!)).toBe(
      cssOutput!.full,
    );
    expect(moduleCode).toContain(expectedScopedName('button', moduleCss));
  }, 30_000);

  test('nested component Less module import resolves to emitted CSS asset', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile(
      'src/components/Card/tokens.less',
      `
        @brand: tomato;
        :root { --brand: @brand; }
      `,
    );
    const moduleLess = project.writeFile(
      'src/components/Card/Card.module.less',
      `
        @import "./tokens.less";
        .card { color: var(--brand); }
      `,
    );
    project.writeFile(
      'src/components/Card/index.tsx',
      `import styles from './Card.module.less';\nexport const className = styles.card;\n`,
    );
    project.writeFile(
      'src/css-modules.d.ts',
      `declare module '*.module.css' {\n  const classes: Record<string, string>;\n  export default classes;\n}\n` +
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

    const outDir = project.resolve('dist/es');
    await build({
      cwd: project.root,
      root: project.root,
      entry: {
        Card: 'src/components/Card/index.tsx',
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
    const cssOutput = outputs.find(
      (file) => file.relative === 'components/Card/Card.module.css',
    );
    expect(cssOutput).toBeTruthy();

    const moduleJs = outputs.find((file) =>
      file.relative.endsWith('Card.module.less.js'),
    );
    expect(moduleJs).toBeTruthy();

    const scoped = expectedScopedName('card', moduleLess);
    const css = fs.readFileSync(cssOutput!.full, 'utf8');
    expect(css).toContain(`.${scoped}`);
    expect(css).toContain('color: var(--brand)');

    const moduleCode = fs.readFileSync(moduleJs!.full, 'utf8');
    const cssImport = parseCssImport(moduleCode);
    expect(cssImport).toBeTruthy();
    expect(
      fs.existsSync(path.resolve(path.dirname(moduleJs!.full), cssImport!)),
    ).toBe(true);
    expect(path.resolve(path.dirname(moduleJs!.full), cssImport!)).toBe(
      cssOutput!.full,
    );
    expect(moduleCode).toContain(scoped);
  }, 30_000);

  test('emits matching CSS Modules assets under dist/es and dist/lib', async () => {
    const sourceRoot = project.resolve('src');
    const moduleCss = project.writeFile(
      'src/components/Button/Button.module.css',
      '.button { color: tomato; }',
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

    const scoped = expectedScopedName('button', moduleCss);
    const buildOptions = {
      cwd: project.root,
      root: project.root,
      entry: {
        Button: 'src/components/Button/index.tsx',
      },
      dts: false,
      unbundle: true,
      platform: 'neutral' as const,
      target: 'es2020',
      tsconfig: path.join(project.root, 'tsconfig.json'),
      plugins: [createCssModulesPlugin({ sourceRoot })],
    };

    const formatOutputs: Record<
      'es' | 'lib',
      {
        css: string;
        moduleCode: string;
        cssImport: string;
      }
    > = {
      es: { css: '', moduleCode: '', cssImport: '' },
      lib: { css: '', moduleCode: '', cssImport: '' },
    };

    for (const { format, outFormat, outDir } of [
      { format: 'esm' as const, outFormat: 'es' as const, outDir: 'dist/es' },
      { format: 'cjs' as const, outFormat: 'lib' as const, outDir: 'dist/lib' },
    ]) {
      const outputDir = project.resolve(outDir);
      await build({
        ...buildOptions,
        format,
        outDir: outputDir,
      });

      const outputs = readOutputFiles(outputDir);
      const cssOutput = outputs.find(
        (file) => file.relative === 'components/Button/Button.module.css',
      );
      const moduleJs = findCssModuleJsOutput(outputs, 'Button.module.css');

      expect(cssOutput).toBeTruthy();
      expect(moduleJs).toBeTruthy();

      const css = fs.readFileSync(cssOutput!.full, 'utf8');
      const moduleCode = fs.readFileSync(moduleJs!.full, 'utf8');
      const cssImport = parseCssSideEffect(moduleCode);

      expect(css).toContain(`.${scoped}`);
      expect(cssImport).toBeTruthy();
      expect(
        fs.existsSync(path.resolve(path.dirname(moduleJs!.full), cssImport!)),
      ).toBe(true);
      expect(path.resolve(path.dirname(moduleJs!.full), cssImport!)).toBe(
        cssOutput!.full,
      );
      expect(moduleCode).toContain(scoped);

      formatOutputs[outFormat] = { css, moduleCode, cssImport: cssImport! };
    }

    expect(formatOutputs.es.css).toBe(formatOutputs.lib.css);
    expect(formatOutputs.es.cssImport).toBe(formatOutputs.lib.cssImport);
    expect(formatOutputs.es.moduleCode).toContain(
      `import ${JSON.stringify(formatOutputs.es.cssImport)};`,
    );
    expect(formatOutputs.lib.moduleCode).toContain(
      `require(${JSON.stringify(formatOutputs.lib.cssImport)});`,
    );
    expect(formatOutputs.es.moduleCode).toContain(scoped);
    expect(formatOutputs.lib.moduleCode).toContain(scoped);
  }, 60_000);

  test('keeps CJS CSS side effects when esm and cjs module builds share one tsdown session', async () => {
    const sourceRoot = project.resolve('src');
    const moduleCss = project.writeFile(
      'src/components/Badge/Badge.module.css',
      '.badge { color: tomato; }',
    );
    project.writeFile(
      'src/components/Badge/index.tsx',
      `import styles from './Badge.module.css';\nexport const className = styles.badge;\n`,
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

    const sharedPlugin = createCssModulesPlugin({ sourceRoot });
    const moduleEntries = {
      Badge: 'src/components/Badge/index.tsx',
    };
    const commonOptions = {
      cwd: project.root,
      root: project.root,
      entry: moduleEntries,
      dts: false,
      unbundle: true,
      platform: 'neutral' as const,
      target: 'es2020',
      tsconfig: path.join(project.root, 'tsconfig.json'),
      outExtensions: () => ({
        js: '.js',
        dts: '.d.ts',
      }),
      plugins: [sharedPlugin],
    };

    await build({
      ...commonOptions,
      format: 'esm',
      outDir: project.resolve('dist/es'),
    });
    await build({
      ...commonOptions,
      format: 'cjs',
      outDir: project.resolve('dist/lib'),
    });

    const libModuleJs = findCssModuleJsOutput(
      readOutputFiles(project.resolve('dist/lib')),
      'Badge.module.css',
    );
    expect(libModuleJs).toBeTruthy();

    const moduleCode = fs.readFileSync(libModuleJs!.full, 'utf8');
    const cssImport = parseCssSideEffect(moduleCode);
    expect(cssImport).toBeTruthy();
    expect(moduleCode).toContain(`require(${JSON.stringify(cssImport)});`);
    expect(
      fs.existsSync(path.resolve(path.dirname(libModuleJs!.full), cssImport!)),
    ).toBe(true);
    expect(moduleCode).toContain(expectedScopedName('badge', moduleCss));
  }, 60_000);

  test('keeps Tag partial css assets when esm and cjs module builds share one plugin', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile(
      'src/components/Tag/tokens.less',
      ':root { --tag-color: #0f766e; }',
    );
    project.writeFile(
      'src/components/Tag/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
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

    const sharedPlugin = createCssModulesPlugin({ sourceRoot });
    const commonOptions = {
      cwd: project.root,
      root: project.root,
      entry: {
        Tag: 'src/components/Tag/index.tsx',
      },
      dts: false,
      unbundle: true,
      platform: 'neutral' as const,
      target: 'es2020',
      tsconfig: path.join(project.root, 'tsconfig.json'),
      outExtensions: () => ({
        js: '.js',
        dts: '.d.ts',
      }),
      plugins: [sharedPlugin],
    };

    await build({
      ...commonOptions,
      format: 'esm',
      outDir: project.resolve('dist/es'),
    });
    await build({
      ...commonOptions,
      format: 'cjs',
      outDir: project.resolve('dist/lib'),
    });

    for (const outDir of ['dist/es', 'dist/lib']) {
      const tokens = project.resolve(`${outDir}/components/Tag/tokens.css`);
      const moduleCss = project.resolve(
        `${outDir}/components/Tag/Tag.module.css`,
      );
      expect(fs.existsSync(tokens)).toBe(true);
      expect(fs.readFileSync(tokens, 'utf8')).toContain('--tag-color: #0f766e');
      expect(fs.readFileSync(moduleCss, 'utf8')).toContain(
        '@import "./tokens.css"',
      );
    }
  }, 60_000);

  test('parallel esm and cjs module builds emit css assets with separate plugins', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile(
      'src/components/Badge/Badge.module.css',
      '.badge { color: tomato; }',
    );
    project.writeFile(
      'src/components/Badge/index.tsx',
      `import styles from './Badge.module.css';\nexport const className = styles.badge;\n`,
    );
    project.writeFile(
      'src/components/Tag/tokens.less',
      ':root { --tag-color: #0f766e; }',
    );
    project.writeFile(
      'src/components/Tag/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );
    project.writeFile(
      'src/components/Tag/index.tsx',
      `import styles from './Tag.module.less';\nexport const className = styles.tag;\n`,
    );
    project.writeFile(
      'src/css-modules.d.ts',
      `declare module '*.module.css' {\n  const classes: Record<string, string>;\n  export default classes;\n}\n` +
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

    const commonOptions = {
      cwd: project.root,
      root: project.root,
      entry: {
        Badge: 'src/components/Badge/index.tsx',
        Tag: 'src/components/Tag/index.tsx',
      },
      dts: false,
      unbundle: true,
      platform: 'neutral' as const,
      target: 'es2020',
      tsconfig: path.join(project.root, 'tsconfig.json'),
      outExtensions: () => ({
        js: '.js',
        dts: '.d.ts',
      }),
    };

    await Promise.all([
      build({
        ...commonOptions,
        format: 'esm',
        outDir: project.resolve('dist/es'),
        plugins: [createCssModulesPlugin({ sourceRoot })],
      }),
      build({
        ...commonOptions,
        format: 'cjs',
        outDir: project.resolve('dist/lib'),
        plugins: [createCssModulesPlugin({ sourceRoot })],
      }),
    ]);

    for (const outDir of ['dist/es', 'dist/lib']) {
      expect(
        fs.existsSync(
          project.resolve(`${outDir}/components/Badge/Badge.module.css`),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(project.resolve(`${outDir}/components/Tag/tokens.css`)),
      ).toBe(true);
      expect(
        fs.existsSync(
          project.resolve(`${outDir}/components/Tag/Tag.module.css`),
        ),
      ).toBe(true);
    }
  }, 60_000);
});
