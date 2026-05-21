import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { toFsSpecifier } from '#auklet/utils';
import { loadAukletConfig } from '#auklet/configLoader';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import { ModuleStyleBuilder } from '#auklet/css/production/builder';
import {
  createStyleProject,
  type StyleProjectTemplate,
} from '../fixtures/styleProjectTemplate';
import {
  normalizeBuildStyleStructure,
  normalizeGraphStyleStructure,
  type StyleStructure,
} from '../fixtures/styleStructure';

const graphStyleEntries = [
  'style.css',
  'external.css',
  'module.css',
  'themes/light.css',
  'themes/dark.css',
  'components/Button.css',
  'components/Card.css',
];

const expectedOutputFiles = [
  'es/components/Button/index.css',
  'es/components/Button/style/index.css',
  'es/components/Card/index.css',
  'es/components/Card/style/index.css',
  'es/components/Card/tokens.css',
  'es/style/external.css',
  'es/style/index.css',
  'es/style/module.css',
  'es/style/themes/dark.css',
  'es/style/themes/light.css',
  'es/themes/dark.css',
  'es/themes/light.css',
  'index.css',
  'lib/components/Button/index.css',
  'lib/components/Button/style/index.css',
  'lib/components/Card/index.css',
  'lib/components/Card/style/index.css',
  'lib/components/Card/tokens.css',
  'lib/style/external.css',
  'lib/style/index.css',
  'lib/style/module.css',
  'lib/style/themes/dark.css',
  'lib/style/themes/light.css',
  'lib/themes/dark.css',
  'lib/themes/light.css',
];

const packageEntryContent = [
  ':root { --color: white; }',
  ':root[data-theme="dark"] { --color: black; }',
  '.external-theme { color: blue; }',
  '.external-ui { display: block; }',
  '.button { color: green; }',
  '.card { color: red; }',
];

const expectedComponents = ['components/Button', 'components/Card'];
const expectedThemes = ['dark', 'light'];

const expectEntryImports = (
  structure: StyleStructure,
  entryId: string,
  imports: Array<string>,
) => {
  expect(structure.entries[entryId]?.imports).toEqual(imports);
};

const expectEntryContent = (
  structure: StyleStructure,
  entryId: string,
  content: Array<string>,
) => {
  for (const item of content) {
    expect(structure.entries[entryId]?.content).toContain(item);
  }
};

const expectPackageEntryContent = (
  structure: StyleStructure,
  content: Array<string>,
) => {
  for (const item of content) {
    expect(structure.packageEntry?.content).toContain(item);
  }
};

const expectComponentStyleImports = (
  structure: StyleStructure,
  componentId: string,
  imports: Array<string>,
) => {
  const component = structure.components[componentId];

  expect(component?.styleEntry?.imports).toEqual(imports);
};

const expectStyleKeys = (structure: StyleStructure) => {
  expect(Object.keys(structure.components).sort()).toEqual(expectedComponents);
  expect(Object.keys(structure.themes).sort()).toEqual(expectedThemes);
};

const nodeModuleStyleSpecifier = (
  fixture: StyleProjectTemplate,
  specifier: string,
) => {
  return toFsSpecifier(`${fixture.packageRoot}/node_modules/${specifier}`);
};

describe('module style project output', () => {
  let fixture: StyleProjectTemplate;

  beforeEach(() => {
    fixture = createStyleProject();
  });

  afterEach(() => {
    fixture.project.cleanup();
  });

  test('builds project output and dev graph entries with complete style dependency chains', async () => {
    const aukletConfig = await loadAukletConfig(fixture.packageRoot, {
      cacheBust: true,
    });

    await new ModuleStyleBuilder({
      packageRoot: fixture.packageRoot,
      aukletConfig,
    }).build();

    const buildStructure = normalizeBuildStyleStructure(
      fixture.packageRoot,
      fixture.outputDir,
    );
    const graph = new ModuleStyleGraph({
      workspaceRoot: fixture.workspaceRoot,
    });
    const graphStructure = await normalizeGraphStyleStructure(
      graph,
      fixture.packageName,
      fixture.packageRoot,
      graphStyleEntries,
    );

    expect(fixture.outputFiles()).toEqual(expectedOutputFiles);
    expectPackageEntryContent(buildStructure, packageEntryContent);

    expectEntryImports(buildStructure, 'es/style/index.css', [
      '@scope/theme/style.css',
      '@scope/ui/style.css',
      './themes/light.css',
      './themes/dark.css',
      './module.css',
    ]);
    expectEntryImports(buildStructure, 'es/style/external.css', [
      '@scope/theme/external.css',
      '@scope/ui/external.css',
    ]);
    expectEntryImports(buildStructure, 'es/themes/light.css', [
      '@scope/theme/themes/light.css',
      '../style/themes/light.css',
    ]);
    expectComponentStyleImports(buildStructure, 'components/Card', [
      '../../Button/style/index.css',
      '@scope/ui/components/Button.css',
      '../index.css',
    ]);
    expectComponentStyleImports(buildStructure, 'components/Button', [
      '../index.css',
    ]);

    expectEntryImports(graphStructure, 'external.css', [
      nodeModuleStyleSpecifier(fixture, '@scope/theme/style.css'),
      nodeModuleStyleSpecifier(fixture, '@scope/ui/style.css'),
    ]);
    expectEntryImports(graphStructure, 'themes/light.css', [
      nodeModuleStyleSpecifier(fixture, '@scope/theme/themes/light.css'),
    ]);
    expectEntryContent(graphStructure, 'style.css', [
      '.button { color: green; }',
      '.card { color: red; }',
    ]);
    expectEntryImports(graphStructure, 'components/Card.css', [
      nodeModuleStyleSpecifier(fixture, '@scope/ui/components/Button.css'),
    ]);
    expectEntryContent(graphStructure, 'components/Card.css', [
      '.button { color: green; }',
      '.card { color: red; }',
    ]);

    expectStyleKeys(buildStructure);
    expectStyleKeys(graphStructure);
  });
});
