import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { moduleCssBuildConfig } from '#auklet/css/core/config';
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
      resolveStyleDependency(specifier: string, fromDir: string) {
        if (specifier.startsWith('.')) return path.resolve(fromDir, specifier);
        return project.resolve('node_modules', specifier);
      },
    } as WorkspaceStyleResolver;

    processor = new StyleProcessor(moduleCssBuildConfig, resolver);
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

  test('collects only relative CSS imports', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./base.css";
        @import "./theme.module.css";
        @import "./ignored.txt";
        @import "@scope/ui/style.css";
      `,
    );
    const base = project.resolve('base.css');
    const themeModule = project.resolve('theme.module.css');

    const imported = processor.collectImportedStyleFiles([entry]);

    expect(imported).toEqual(new Set([base, themeModule]));
  });

  test('removes imports whose resolved file does not produce CSS content', () => {
    const entry = project.writeFile(
      'entry.css',
      `
        @import "./missing.css";
        .entry { color: red; }
      `,
    );

    const content = processor.readStyleFile(entry);

    expectNoImports(content);
    expect(content).toContain('.entry { color: red; }');
  });
});
