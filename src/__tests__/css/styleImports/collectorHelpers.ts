import path from 'node:path';
import { expect } from 'vitest';
import { ModuleStyleImportCollector } from '#auklet/css/core/styleImports/collector';
import type { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';
import { normalizeAukletConfig } from '#auklet/config';
import { createVirtualProject } from '../../fixtures/virtualProject';

export const defaultConfig = normalizeAukletConfig({
  styles: {
    dependencies: {
      '@scope/ui': {
        components: ['/pages/**.css', '/components/**.css'],
      },
    },
  },
});

export const singleRuleConfig = normalizeAukletConfig({
  styles: {
    dependencies: {
      '@scope/ui': {
        components: '/components/**.css',
      },
    },
  },
});

export const blockRuleConfig = normalizeAukletConfig({
  styles: {
    dependencies: {
      '@scope/ui': {
        components: ['/components/**.css', '/blocks/**.css'],
      },
    },
  },
});

export const emptyConfig = normalizeAukletConfig();

export type CollectorFixture = ReturnType<typeof createCollectorFixture>;

export function createCollectorFixture() {
  const project = createVirtualProject('auklet-css-');
  const srcRoot = project.resolve('src');
  const styleRoot = project.resolve('styles');

  project.writePackageJson({
    imports: {
      '#fixture/*': './src/*.js',
    },
  });

  const resolver = {
    resolveStyleDependency(specifier: string) {
      return path.join(styleRoot, specifier);
    },
  } as WorkspaceStyleResolver;

  const collector = new ModuleStyleImportCollector(
    srcRoot,
    project.root,
    resolver,
  );

  const writeSource = (relativePath: string, code: string) => {
    return project.writeFile(path.join('src', relativePath), code);
  };

  const writeDep = (specifier: string) => {
    project.writeFile(path.join('styles', specifier), '');
  };

  const writeStyle = (relativePath: string) => {
    project.writeFile(path.join('src', relativePath), '');
  };

  const writeDeps = (...specifiers: Array<string>) => {
    for (const specifier of specifiers) {
      writeDep(specifier);
    }
  };

  const writeStyles = (...relativePaths: Array<string>) => {
    for (const relativePath of relativePaths) {
      writeStyle(relativePath);
    }
  };

  const writeComponent = (sourceDir: string) => {
    const componentName = path.basename(sourceDir);
    writeSource(
      `${sourceDir}/index.tsx`,
      `export function ${componentName}() { return null; }`,
    );
    writeStyles(`${sourceDir}/index.css`);
  };

  const writeFileModule = (source: string) => {
    const moduleName = path.basename(source, path.extname(source));
    writeSource(source, `export function ${moduleName}() { return null; }`);
    writeStyles(source.replace(/\.[^.]+$/, '.css'));
  };

  const collectFile = (file: string, config = defaultConfig) => {
    return collector.collect([file], config);
  };

  const collectSource = (
    source: string,
    code: string,
    config = defaultConfig,
  ) => {
    return collectFile(writeSource(source, code), config);
  };

  return {
    project,
    collector,
    writeSource,
    writeDep,
    writeDeps,
    writeStyle,
    writeStyles,
    writeComponent,
    writeFileModule,
    collectFile,
    collectSource,
    cleanup: () => project.cleanup(),
  };
}

export function expectStyles(
  entries: Map<string, Array<string>>,
  module: string,
  styles: Array<string>,
) {
  expect(entries.get(module)).toEqual(styles);
}

export function expectNoStyles(entries: Map<string, Array<string>>) {
  expect(entries.size).toBe(0);
}
