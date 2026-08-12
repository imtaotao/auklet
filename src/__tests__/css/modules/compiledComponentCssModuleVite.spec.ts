import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { build } from 'tsdown';
import { createServer as createViteServer } from 'vite';
import { createCssModulesPlugin } from '#auklet/build/cssModulesPlugin';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import { isCompiledCssModuleScopedCssFile } from '#auklet/css/modules/cssModuleOutputPaths';
import { aukletStylePlugin } from '#auklet/css/vite/vitePlugin';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

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

describe('compiled component CSS Modules in Vite', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-compiled-component-vite-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('consumer Vite keeps producer locals and :global child selectors (no re-module)', async () => {
    const uiRoot = project.resolve('node_modules/@scope/ui');
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      version: '0.0.1',
      type: 'module',
    });
    project.writeFile(
      'node_modules/@scope/ui/src/components/OrderFilter/index.module.less',
      `.OrderFilter {
  :global {
    .filter-button { margin-top: 29px; }
  }
}
`,
    );
    project.writeFile(
      'node_modules/@scope/ui/src/components/OrderFilter/index.tsx',
      `import styles from './index.module.less';\nexport const className = styles.OrderFilter;\n`,
    );
    project.writeFile(
      'node_modules/@scope/ui/src/css-modules.d.ts',
      `declare module '*.module.less' {\n  const classes: Record<string, string>;\n  export default classes;\n}\n`,
    );
    project.writeJson('node_modules/@scope/ui/tsconfig.json', {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: true,
      },
      include: ['src'],
    });

    const sourceRoot = project.resolve('node_modules/@scope/ui/src');
    const outDir = project.resolve('node_modules/@scope/ui/dist/es');
    await build({
      cwd: uiRoot,
      root: uiRoot,
      entry: {
        OrderFilter: 'src/components/OrderFilter/index.tsx',
      },
      format: 'esm',
      outDir,
      dts: false,
      unbundle: true,
      platform: 'neutral',
      target: 'es2020',
      tsconfig: project.resolve('node_modules/@scope/ui/tsconfig.json'),
      plugins: [
        createCssModulesPlugin({
          packageRoot: uiRoot,
          sourceRoot,
        }),
      ],
    });

    const outputs = readOutputFiles(outDir);
    const scopedCss = outputs.find((file) =>
      file.relative.endsWith('components/OrderFilter/index.scoped.css'),
    );
    const shim = outputs.find((file) =>
      /(^|\/)index\.module\.less\.(js|mjs|cjs)$/.test(file.relative),
    );

    expect(scopedCss).toBeTruthy();
    expect(shim).toBeTruthy();
    expect(
      outputs.some((file) =>
        file.relative.endsWith('components/OrderFilter/index.module.css'),
      ),
    ).toBe(false);
    expect(isCssModuleFile(scopedCss!.full)).toBe(false);
    expect(isCompiledCssModuleScopedCssFile(scopedCss!.full)).toBe(true);

    const scopedCssText = fs.readFileSync(scopedCss!.full, 'utf8');
    const shimText = fs.readFileSync(shim!.full, 'utf8');
    expect(shimText).toContain('index.scoped.css');
    expect(shimText).toMatch(/"OrderFilter"\s*:/);
    expect(scopedCssText).toMatch(
      /\.[\w-]+OrderFilter[\w-]*\s+\.filter-button/,
    );
    expect(scopedCssText).toContain('margin-top: 29px');
    expect(scopedCssText).not.toMatch(/\.[\w-]*filter-button_/);

    const producerClass = /"OrderFilter"\s*:\s*"([^"]+)"/.exec(shimText)?.[1];
    expect(producerClass).toBeTruthy();

    project.writePackageJson({
      name: '@scope/app',
      type: 'module',
      dependencies: {
        '@scope/ui': '0.0.1',
      },
    });
    project.writeAukletConfig(`
      export const config = {
        source: 'src',
        modules: true,
      };
    `);
    const entryFile = project.writeFile(
      'src/entry.ts',
      `import styles from ${JSON.stringify(shim!.full)};\nexport const className = styles.OrderFilter;\n`,
    );

    const server = await createViteServer({
      configFile: false,
      logLevel: 'silent',
      root: project.root,
      optimizeDeps: {
        noDiscovery: true,
        include: [],
      },
      plugins: [
        aukletStylePlugin({
          root: project.root,
          mode: 'package',
        }),
      ],
    });

    try {
      const cssTransform = await server.transformRequest(scopedCss!.full);
      expect(cssTransform?.code).toContain(`.${producerClass} .filter-button`);
      expect(cssTransform?.code).toContain('margin-top: 29px');
      expect(cssTransform?.code).not.toMatch(
        /export\s+default\s+\{\s*OrderFilter\s*:/,
      );
      expect(cssTransform?.code).not.toMatch(/filter-button_/);

      const resolvedShim = await server.pluginContainer.resolveId(
        shim!.full,
        entryFile,
      );
      expect(resolvedShim?.id).toBe(shim!.full);
    } finally {
      await server.close();
    }
  }, 60_000);
});
