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

  test('inlines nested CSS imports with PostCSS AST order preserved', async () => {
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

    const content = await processor.readStyleFile(entry);

    expectNoImports(content);
    expect(content).toContain('.tokens { color: green; }');
    expect(content).toContain('.base { color: blue; }');
    expect(content).toContain('.entry { color: red; }');
    expectContentOrder(content, ['.tokens', '.base', '.entry']);
  });

  test('inlines long mixed relative and alias CSS import chains in dependency order', async () => {
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

    const content = await processor.readStyleFile(entry);

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

  test('inlines url imports and avoids repeating circular imports', async () => {
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

    const content = await processor.readStyleFile(entry);

    expectNoImports(content);
    expect(content.match(/\.entry/g)).toHaveLength(1);
    expect(content.match(/\.base/g)).toHaveLength(1);
  });

  test('inlines long circular CSS import chains without repeating styles', async () => {
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

    const content = await processor.readStyleFile(entry);

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

  test('detects self CSS import cycles before preserving import graphs', async () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./entry.css";
        .entry { color: red; }
      `,
    );

    await expect(
      processor.assertNoLocalStyleImportCycles([entry]),
    ).rejects.toThrow('[css] circular CSS import detected:');
  });

  test('detects mutual CSS import cycles before preserving import graphs', async () => {
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

    await expect(
      processor.assertNoLocalStyleImportCycles([entry]),
    ).rejects.toThrow('[css] circular CSS import detected:');
  });

  test('collects relative and local alias CSS imports', async () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./base.css";
        @import "#local/alias.css";
        @import "./theme.extra.css";
        @import "./ignored.txt";
        @import "@scope/ui/style.css";
      `,
    );
    const base = project.resolve('base.css');
    const alias = project.resolve('alias.css');
    const themeExtra = project.resolve('theme.extra.css');
    project.writeFile('base.css', '.base {}');
    project.writeFile('alias.css', '.alias {}');
    project.writeFile('theme.extra.css', '.theme {}');

    const imported = await processor.collectImportedStyleFiles([entry]);

    expect(imported).toEqual(new Set([base, alias, themeExtra]));
  });

  test('rejects CSS Modules files in the global style pipeline', async () => {
    const moduleFile = project.writeFile(
      'Button.module.css',
      '.button { color: red; }',
    );

    await expect(processor.readStyleFile(moduleFile)).rejects.toThrow(
      'CSS Modules files are handled by the css/modules protocol',
    );
  });

  test('rejects importing CSS Modules from global style entries', async () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./Button.module.css";
        .entry { color: red; }
      `,
    );
    project.writeFile('Button.module.css', '.button { color: blue; }');

    await expect(processor.readStyleFile(entry)).rejects.toThrow(
      'CSS Modules files cannot be imported from global style entries',
    );
  });

  test.each(['Button.module.css', 'Button.module.less'])(
    'rejects plain Less importing %s',
    async (moduleName) => {
      const entry = project.writeFile(
        'entry.less',
        `@import "./${moduleName}";\n.entry { color: red; }`,
      );
      project.writeFile(moduleName, '.button { color: blue; }');

      await expect(processor.readStyleFile(entry)).rejects.toThrow(
        'CSS Modules files cannot be imported from global style entries',
      );
    },
  );

  test('rejects missing local CSS imports', async () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./missing.css";
        .entry { color: red; }
      `,
    );

    await expect(processor.readStyleFile(entry)).rejects.toThrow(
      '[css] local CSS import not found: ./missing.css from',
    );
  });

  test('rejects unresolved source CSS alias imports without falling back to packages', async () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "#styles/missing.css";
        .entry { color: red; }
      `,
    );

    await expect(processor.readStyleFile(entry)).rejects.toThrow(
      '[css] local CSS import not found: #styles/missing.css from',
    );
  });

  test('rejects unresolved extensionless source CSS alias imports', async () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "#styles/missing";
        .entry { color: red; }
      `,
    );

    await expect(processor.readStyleFile(entry)).rejects.toThrow(
      '[css] local CSS import not found: #styles/missing from',
    );
  });

  test('preserves valid local and external imports when expansion is disabled', async () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./base.css";
        @import "@scope/ui/style.css";
        .entry { color: red; }
      `,
    );
    project.writeFile('base.css', '.base { color: blue; }');

    const content = await processor.readStyleFile(entry, undefined, {
      shouldExpandImport: () => false,
    });

    expect(content).toContain('@import "./base.css"');
    expect(content).toContain('@import "@scope/ui/style.css"');
    expect(content).toContain('.entry { color: red; }');
  });

  test('rejects source-root escaping local imports when expansion is disabled', async () => {
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

    await expect(
      sourceRootProcessor.readStyleFile(entry, undefined, {
        shouldExpandImport: () => false,
      }),
    ).rejects.toThrow('[css] local CSS import escapes source root:');
  });

  test('rejects source-root escaping local imports when expansion is enabled', async () => {
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

    await expect(sourceRootProcessor.readStyleFile(entry)).rejects.toThrow(
      '[css] local CSS import escapes source root:',
    );
  });

  test('preserves import conditions when remapping string import specifiers', async () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "#local/base.css" layer(shared) screen and (min-width: 640px);
        .entry { color: red; }
      `,
    );
    project.writeFile('base.css', '.base { color: blue; }');

    const content = await processor.readStyleFile(entry, undefined, {
      mapImportSpecifier: () => './mapped/base.css',
      shouldExpandImport: () => false,
    });

    expect(content).toContain(
      '@import "./mapped/base.css" layer(shared) screen and (min-width: 640px)',
    );
    expect(content).toContain('.entry { color: red; }');
  });

  test('preserves import conditions when remapping url import specifiers', async () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import url( "#local/base.css" ) supports(display: grid);
        .entry { color: red; }
      `,
    );
    project.writeFile('base.css', '.base { color: blue; }');

    const content = await processor.readStyleFile(entry, undefined, {
      mapImportSpecifier: () => './mapped/base.css',
      shouldExpandImport: () => false,
    });

    expect(content).toContain(
      '@import url( "./mapped/base.css" ) supports(display: grid)',
    );
    expect(content).toContain('.entry { color: red; }');
  });

  test('rejects missing local CSS imports when expansion is disabled', async () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./missing.css";
        .entry { color: red; }
      `,
    );

    await expect(
      processor.readStyleFile(entry, undefined, {
        shouldExpandImport: () => false,
      }),
    ).rejects.toThrow('[css] local CSS import not found: ./missing.css from');
  });

  test('compiles Less nesting and variables on disk read', async () => {
    const entry = project.writeFile(
      'entry.less',
      `
        @color: red;
        .entry {
          color: @color;
          .child { color: blue; }
        }
      `,
    );

    const content = await processor.readStyleFile(entry);

    expect(content).toContain('color: red');
    expect(content).toContain('.entry .child');
    expect(content).not.toContain('@color');
  });

  test('preserves Less partial imports as CSS imports when the import graph is preserved', async () => {
    const tokens = project.writeFile(
      'tokens.less',
      '@text: green;\n.tokens { color: @text; }',
    );
    project.writeFile('base.css', '.base { color: blue; }');
    const entry = project.writeFile(
      'entry.less',
      `
        @import "./tokens.less";
        @import "./base.css";
        .entry { color: red; }
      `,
    );

    const content = await processor.readStyleFile(entry, undefined, {
      preserveLessImportGraph: true,
      shouldExpandImport: () => false,
    });
    const lessImports = await processor.collectLessImportFiles(entry);
    const imported = await processor.collectImportedStyleFiles([entry]);

    expect(content).toContain('@import "./tokens.css"');
    expect(content).toMatch(/@import\s+"base\.css"/);
    expect(content).toContain('.entry');
    expect(content).toContain('color: red');
    expect(content).not.toContain('.tokens');
    expect(content).not.toContain('color: green');
    expect(content).not.toContain('@import "./tokens.less"');
    expect(lessImports).toEqual([tokens]);
    expect(imported).toEqual(new Set([tokens, project.resolve('base.css')]));
  });

  test.each([
    ['media', 'screen and (min-width: 640px)'],
    ['supports', 'supports(display: grid)'],
    ['layer', 'layer(theme)'],
  ])(
    'preserves %s conditions on preserved Less imports',
    async (_condition, tail) => {
      project.writeFile(
        'tokens.less',
        '@text: green;\n.tokens { color: @text; }',
      );
      const entry = project.writeFile(
        'entry.less',
        `@import "./tokens.less" ${tail};\n.entry { color: red; }`,
      );

      const content = await processor.readStyleFile(entry, undefined, {
        preserveLessImportGraph: true,
        shouldExpandImport: () => false,
      });

      expect(content).toContain(`@import "./tokens.css" ${tail}`);
      expect(content).not.toContain('@import "./tokens.less"');
      expect(content).not.toContain('.tokens');
    },
  );

  test('preserves reference and inline semantics with the Less graph enabled', async () => {
    project.writeFile(
      'reference.less',
      '.reference-only { color: red; }\n.reference-mixin() { border-color: teal; }',
    );
    project.writeFile('inline.css', '.inline-only { color: blue; }');
    const entry = project.writeFile(
      'entry.less',
      [
        '@import (reference) "./reference.less";',
        '@import (inline) "./inline.css";',
        '.entry { .reference-mixin(); }',
      ].join('\n'),
    );

    const content = await processor.readStyleFile(entry, undefined, {
      preserveLessImportGraph: true,
      shouldExpandImport: () => false,
    });

    expect(content).toContain('border-color: teal');
    expect(content).toContain('.inline-only');
    expect(content).not.toContain('.reference-only');
    expect(content).not.toContain('@import');
  });

  test('inlines Less imports when preserveLessImportGraph is disabled', async () => {
    project.writeFile(
      'tokens.less',
      '@text: green;\n.tokens { color: @text; }',
    );
    project.writeFile('base.css', '.base { color: blue; }');
    const entry = project.writeFile(
      'entry.less',
      `
        @import "./tokens.less";
        @import "./base.css";
        .entry { color: red; }
      `,
    );

    const content = await processor.readStyleFile(entry, undefined, {
      shouldExpandImport: () => false,
    });

    expect(content).toContain('.tokens');
    expect(content).toContain('color: green');
    expect(content).toMatch(/@import\s+"base\.css"/);
    expect(content).not.toContain('@import "./tokens.less"');
  });

  test('allows Less to import CSS and rejects CSS importing Less', async () => {
    project.writeFile('base.css', '.base { color: blue; }');
    const lessEntry = project.writeFile(
      'entry.less',
      `
        @import "./base.css";
        .entry { color: red; }
      `,
    );
    project.writeFile('theme.less', '.theme { color: green; }');
    const cssEntry = project.writeFile(
      'entry.css',
      `
        @import "./theme.less";
        .entry { color: red; }
      `,
    );

    const content = await processor.readStyleFile(lessEntry);
    expect(content).toContain('.base');
    expect(content).toContain('color: blue');
    expect(content).toContain('.entry');
    expect(content).toContain('color: red');

    await expect(processor.readStyleFile(cssEntry)).rejects.toThrow(
      '[css] CSS must not import Less:',
    );
  });

  test('applies styles.prefix once on the root read and not again via appendStyleContent', async () => {
    const resolver = {
      resolveSourceStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        return null;
      },
      resolveStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        return project.resolve('node_modules', specifier);
      },
      isInsideSourceRoot(file: string) {
        const relative = path.relative(project.root, file);
        return (
          Boolean(relative) &&
          !relative.startsWith('..') &&
          !path.isAbsolute(relative)
        );
      },
    } as WorkspaceStyleResolver;
    const prefixed = new StyleProcessor(moduleStyleBuildConfig, resolver, {
      prefix: '.mf-app',
    });
    const entry = project.writeFile(
      'entry.less',
      `
        @keyframes fade {
          from { opacity: 0; }
        }
        .entry { color: red; }
      `,
    );

    const content = await prefixed.readStyleFile(entry, undefined, {
      applyPrefix: true,
    });
    expect(content).toContain('.mf-app .entry');
    expect(content).not.toContain('.mf-app .mf-app .entry');
    expect(content).toContain('@keyframes fade');
    expect(content).toContain('opacity: 0');
    expect(content).not.toContain('.mf-app from');

    const root = prefixed.createRoot();
    prefixed.appendStyleContent(root, content, entry);
    const appended = prefixed.stringify(root);

    expect(appended).toContain('.mf-app .entry');
    expect(appended).not.toContain('.mf-app .mf-app .entry');
  });

  test('prefixes nested CSS import expansion only at the root call', async () => {
    const resolver = {
      resolveSourceStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        return null;
      },
      resolveStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        return project.resolve('node_modules', specifier);
      },
      isInsideSourceRoot(_file: string) {
        return true;
      },
    } as WorkspaceStyleResolver;
    const prefixed = new StyleProcessor(moduleStyleBuildConfig, resolver, {
      prefix: '.mf-app',
    });
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./base.css";
        .entry { color: red; }
      `,
    );
    project.writeFile('base.css', '.base { color: blue; }');

    const content = await prefixed.readStyleFile(entry, undefined, {
      applyPrefix: true,
    });

    expectNoImports(content);
    expect(content).toContain('.mf-app .base');
    expect(content).toContain('.mf-app .entry');
    expect(content).not.toContain('.mf-app .mf-app');
  });

  test('does not apply styles.prefix unless applyPrefix is opted in', async () => {
    const resolver = {
      resolveSourceStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        return null;
      },
      resolveStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        return project.resolve('node_modules', specifier);
      },
      isInsideSourceRoot(_file: string) {
        return true;
      },
    } as WorkspaceStyleResolver;
    const prefixed = new StyleProcessor(moduleStyleBuildConfig, resolver, {
      prefix: '.mf-app',
    });
    const entry = project.writeFile('entry.css', '.entry { color: red; }');

    const content = await prefixed.readStyleFile(entry);

    expect(content).toContain('.entry { color: red; }');
    expect(content).not.toContain('.mf-app .entry');
  });

  test('applies prefix to every top-level own file when reusing a shared seen set', async () => {
    const resolver = {
      resolveSourceStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        return null;
      },
      resolveStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        return project.resolve('node_modules', specifier);
      },
      isInsideSourceRoot(file: string) {
        const relative = path.relative(project.root, file);
        return (
          Boolean(relative) &&
          !relative.startsWith('..') &&
          !path.isAbsolute(relative)
        );
      },
    } as WorkspaceStyleResolver;
    const prefixed = new StyleProcessor(moduleStyleBuildConfig, resolver, {
      prefix: '.mf-app',
    });
    const first = project.writeFile('first.css', '.first { color: red; }');
    const second = project.writeFile('second.css', '.second { color: blue; }');
    const dependency = project.writeFile(
      'node_modules/dep.css',
      '.dependency { color: purple; }',
    );
    const seen = new Set<string>();

    const firstContent = await prefixed.readStyleFile(first, seen, {
      applyPrefix: true,
    });
    const dependencyContent = await prefixed.readStyleFile(dependency, seen, {
      applyPrefix: false,
    });
    const secondContent = await prefixed.readStyleFile(second, seen, {
      applyPrefix: true,
    });

    expect(firstContent).toContain('.mf-app .first');
    expect(secondContent).toContain('.mf-app .second');
    expect(dependencyContent).toContain('.dependency { color: purple; }');
    expect(dependencyContent).not.toContain('.mf-app .dependency');
  });

  test('reuses Less compile cache until clearLessCache', async () => {
    const entry = project.writeFile('entry.less', '.entry { color: red; }');

    await processor.warmLessCache([entry]);
    const first = await processor.readStyleFile(entry);
    project.writeFile('entry.less', '.entry { color: blue; }');
    const cached = await processor.readStyleFile(entry);
    processor.clearLessCache();
    const refreshed = await processor.readStyleFile(entry);

    expect(first).toContain('color: red');
    expect(cached).toContain('color: red');
    expect(refreshed).toContain('color: blue');
  });
});
