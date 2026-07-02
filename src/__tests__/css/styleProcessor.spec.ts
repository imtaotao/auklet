import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { StyleProcessor } from '#auklet/css/core/styleProcessor';
import type { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

const expectContentOrder = (content: string, selectors: Array<string>) => {
  for (let index = 1; index < selectors.length; index += 1) {
    expect(content.indexOf(selectors[index - 1])).toBeLessThan(
      content.indexOf(selectors[index]),
    );
  }
};

const expectNoImports = (content: string) => {
  expect(content).not.toContain('@import');
};

describe('StyleProcessor', () => {
  let project: VirtualProject;
  let processor: StyleProcessor;

  beforeEach(() => {
    project = createVirtualProject('auklet-style-');

    const resolver = {
      resolveSourceStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        if (specifier.startsWith('#local/')) {
          return project.resolve(specifier.slice('#local/'.length));
        }
        return null;
      },
      resolveStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        if (specifier.startsWith('#local/')) {
          return project.resolve(specifier.slice('#local/'.length));
        }
        return project.resolve('node_modules', specifier);
      },
      isInsideSourceRoot(file: string) {
        if (file.includes(`${path.sep}node_modules${path.sep}`)) return false;
        const relative = path.relative(project.root, file);
        return (
          Boolean(relative) &&
          !relative.startsWith('..') &&
          !path.isAbsolute(relative)
        );
      },
    } as WorkspaceStyleResolver;

    processor = new StyleProcessor(moduleStyleBuildConfig, resolver);
  });

  afterEach(() => {
    project.cleanup();
  });

  test('inlines nested CSS imports with PostCSS AST order preserved', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./base.css";
        .entry { color: red; }
      `,
    );
    project.writeFile(
      'base.css',
      `
        @import "./tokens.css";
        .base { color: blue; }
      `,
    );
    project.writeFile('tokens.css', '.tokens { color: green; }');

    const content = processor.readStyleFile(entry);

    expectNoImports(content);
    expect(content).toContain('.tokens { color: green; }');
    expect(content).toContain('.base { color: blue; }');
    expect(content).toContain('.entry { color: red; }');
    expectContentOrder(content, ['.tokens', '.base', '.entry']);
  });

  test('inlines long mixed relative and alias CSS import chains in dependency order', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./layers/base.css";
        .entry { color: red; }
      `,
    );
    project.writeFile(
      'layers/base.css',
      `
        @import "#local/layers/theme.css";
        .layer-base { color: blue; }
      `,
    );
    project.writeFile(
      'layers/theme.css',
      `
        @import "./tokens.css";
        .layer-theme { color: green; }
      `,
    );
    project.writeFile(
      'layers/tokens.css',
      `
        @import "../reset.css";
        .layer-tokens { color: purple; }
      `,
    );
    project.writeFile('reset.css', '.reset { box-sizing: border-box; }');

    const content = processor.readStyleFile(entry);

    expectNoImports(content);
    expect(content).toContain('.reset { box-sizing: border-box; }');
    expect(content).toContain('.layer-tokens { color: purple; }');
    expect(content).toContain('.layer-theme { color: green; }');
    expect(content).toContain('.layer-base { color: blue; }');
    expect(content).toContain('.entry { color: red; }');
    expectContentOrder(content, [
      '.reset',
      '.layer-tokens',
      '.layer-theme',
      '.layer-base',
      '.entry',
    ]);
  });

  test('inlines url imports and avoids repeating circular imports', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import url("./base.css");
        .entry { color: red; }
      `,
    );
    project.writeFile(
      'base.css',
      `
        @import url('./entry.css');
        .base { color: blue; }
      `,
    );

    const content = processor.readStyleFile(entry);

    expectNoImports(content);
    expect(content.match(/\.entry/g)).toHaveLength(1);
    expect(content.match(/\.base/g)).toHaveLength(1);
  });

  test('inlines long circular CSS import chains without repeating styles', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./cycles/a.css";
        .entry { color: red; }
      `,
    );
    project.writeFile(
      'cycles/a.css',
      `
        @import "./b.css";
        .cycle-a { color: blue; }
      `,
    );
    project.writeFile(
      'cycles/b.css',
      `
        @import "#local/cycles/c.css";
        .cycle-b { color: green; }
      `,
    );
    project.writeFile(
      'cycles/c.css',
      `
        @import "./d.css";
        .cycle-c { color: purple; }
      `,
    );
    project.writeFile(
      'cycles/d.css',
      `
        @import "./b.css";
        .cycle-d { color: black; }
      `,
    );

    const content = processor.readStyleFile(entry);

    expectNoImports(content);
    expect(content.match(/\.entry\s*\{/g)).toHaveLength(1);
    expect(content.match(/\.cycle-a\s*\{/g)).toHaveLength(1);
    expect(content.match(/\.cycle-b\s*\{/g)).toHaveLength(1);
    expect(content.match(/\.cycle-c\s*\{/g)).toHaveLength(1);
    expect(content.match(/\.cycle-d\s*\{/g)).toHaveLength(1);
    expectContentOrder(content, [
      '.cycle-d',
      '.cycle-c',
      '.cycle-b',
      '.cycle-a',
      '.entry',
    ]);
  });

  test('detects self CSS import cycles before preserving import graphs', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./entry.css";
        .entry { color: red; }
      `,
    );

    expect(() => processor.assertNoLocalStyleImportCycles([entry])).toThrow(
      '[css] circular CSS import detected:',
    );
  });

  test('detects mutual CSS import cycles before preserving import graphs', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./base.css";
        .entry { color: red; }
      `,
    );
    project.writeFile(
      'base.css',
      `
        @import "#local/entry.css";
        .base { color: blue; }
      `,
    );

    expect(() => processor.assertNoLocalStyleImportCycles([entry])).toThrow(
      '[css] circular CSS import detected:',
    );
  });

  test('collects relative and local alias CSS imports', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./base.css";
        @import "#local/alias.css";
        @import "./theme.module.css";
        @import "./ignored.txt";
        @import "@scope/ui/style.css";
      `,
    );
    const base = project.resolve('base.css');
    const alias = project.resolve('alias.css');
    const themeModule = project.resolve('theme.module.css');
    project.writeFile('base.css', '.base {}');
    project.writeFile('alias.css', '.alias {}');
    project.writeFile('theme.module.css', '.theme {}');

    const imported = processor.collectImportedStyleFiles([entry]);

    expect(imported).toEqual(new Set([base, alias, themeModule]));
  });

  test('rejects missing local CSS imports', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./missing.css";
        .entry { color: red; }
      `,
    );

    expect(() => processor.readStyleFile(entry)).toThrow(
      '[css] local CSS import not found: ./missing.css from',
    );
  });

  test('rejects unresolved source CSS alias imports without falling back to packages', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "#styles/missing.css";
        .entry { color: red; }
      `,
    );

    expect(() => processor.readStyleFile(entry)).toThrow(
      '[css] local CSS import not found: #styles/missing.css from',
    );
  });

  test('rejects unresolved extensionless source CSS alias imports', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "#styles/missing";
        .entry { color: red; }
      `,
    );

    expect(() => processor.readStyleFile(entry)).toThrow(
      '[css] local CSS import not found: #styles/missing from',
    );
  });

  test('preserves valid local and external imports when expansion is disabled', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./base.css";
        @import "@scope/ui/style.css";
        .entry { color: red; }
      `,
    );
    project.writeFile('base.css', '.base { color: blue; }');

    const content = processor.readStyleFile(entry, undefined, {
      shouldExpandImport: () => false,
    });

    expect(content).toContain('@import "./base.css"');
    expect(content).toContain('@import "@scope/ui/style.css"');
    expect(content).toContain('.entry { color: red; }');
  });

  test('rejects source-root escaping local imports when expansion is disabled', () => {
    const sourceRoot = project.resolve('src');
    const sourceRootProcessor = new StyleProcessor(moduleStyleBuildConfig, {
      resolveSourceStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        return null;
      },
      resolveStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        return project.resolve('node_modules', specifier);
      },
      isInsideSourceRoot(file: string) {
        const relative = path.relative(sourceRoot, file);
        return (
          Boolean(relative) &&
          !relative.startsWith('..') &&
          !path.isAbsolute(relative)
        );
      },
    } as WorkspaceStyleResolver);
    const entry = project.writeFile(
      'src/components/entry.css',
      `
        @import "../../outside.css";
        .entry { color: red; }
      `,
    );
    project.writeFile('outside.css', '.outside { color: blue; }');

    expect(() =>
      sourceRootProcessor.readStyleFile(entry, undefined, {
        shouldExpandImport: () => false,
      }),
    ).toThrow('[css] local CSS import escapes source root:');
  });

  test('rejects source-root escaping local imports when expansion is enabled', () => {
    const sourceRoot = project.resolve('src');
    const sourceRootProcessor = new StyleProcessor(moduleStyleBuildConfig, {
      resolveSourceStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        return null;
      },
      resolveStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        return project.resolve('node_modules', specifier);
      },
      isInsideSourceRoot(file: string) {
        const relative = path.relative(sourceRoot, file);
        return (
          Boolean(relative) &&
          !relative.startsWith('..') &&
          !path.isAbsolute(relative)
        );
      },
    } as WorkspaceStyleResolver);
    const entry = project.writeFile(
      'src/components/entry.css',
      `
        @import "../../outside.css";
        .entry { color: red; }
      `,
    );
    project.writeFile('outside.css', '.outside { color: blue; }');

    expect(() => sourceRootProcessor.readStyleFile(entry)).toThrow(
      '[css] local CSS import escapes source root:',
    );
  });

  test('preserves import conditions when remapping string import specifiers', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "#local/base.css" layer(shared) screen and (min-width: 640px);
        .entry { color: red; }
      `,
    );
    project.writeFile('base.css', '.base { color: blue; }');

    const content = processor.readStyleFile(entry, undefined, {
      mapImportSpecifier: () => './mapped/base.css',
      shouldExpandImport: () => false,
    });

    expect(content).toContain(
      '@import "./mapped/base.css" layer(shared) screen and (min-width: 640px)',
    );
    expect(content).toContain('.entry { color: red; }');
  });

  test('preserves import conditions when remapping url import specifiers', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import url( "#local/base.css" ) supports(display: grid);
        .entry { color: red; }
      `,
    );
    project.writeFile('base.css', '.base { color: blue; }');

    const content = processor.readStyleFile(entry, undefined, {
      mapImportSpecifier: () => './mapped/base.css',
      shouldExpandImport: () => false,
    });

    expect(content).toContain(
      '@import url( "./mapped/base.css" ) supports(display: grid)',
    );
    expect(content).toContain('.entry { color: red; }');
  });

  test('rejects missing local CSS imports when expansion is disabled', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./missing.css";
        .entry { color: red; }
      `,
    );

    expect(() =>
      processor.readStyleFile(entry, undefined, {
        shouldExpandImport: () => false,
      }),
    ).toThrow('[css] local CSS import not found: ./missing.css from');
  });
});
