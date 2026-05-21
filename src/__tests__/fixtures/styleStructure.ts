import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import type { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import type { PackageStyleLoadResult } from '#auklet/css/vite/moduleGraph/types';

export type StyleStructure = {
  packageEntry: StyleEntry | null;
  entries: Record<string, StyleEntry>;
  themes: Record<string, StyleEntry>;
  components: Record<string, ComponentStyleStructure>;
};

export type ComponentStyleStructure = {
  sourceStyle: StyleEntry | null;
  styleEntry: StyleEntry | null;
};

export type StyleEntry = {
  id: string;
  path?: string;
  imports: Array<string>;
  content?: string;
  watchFiles?: Array<string>;
};

export function toPosixTestPath(file: string) {
  return file.split(path.sep).join('/');
}

export function collectStyleImports(code: string) {
  const imports: Array<string> = [];
  const root = postcss.parse(code);

  root.walkAtRules('import', (rule) => {
    const match = rule.params.match(/^["']([^"']+)["']/);
    if (match) imports.push(match[1]);
  });

  return imports;
}

const createStyleEntry = (
  id: string,
  code: string,
  options: {
    path?: string;
    watchFiles?: Array<string>;
  } = {},
) => {
  return {
    id,
    path: options.path,
    imports: collectStyleImports(code),
    content: code,
    watchFiles: options.watchFiles?.map(toPosixTestPath).sort(),
  } satisfies StyleEntry;
};

const createEmptyStyleStructure = () => {
  const structure: StyleStructure = {
    packageEntry: null,
    entries: {},
    themes: {},
    components: {},
  };

  return structure;
};

const ensureComponent = (structure: StyleStructure, componentId: string) => {
  structure.components[componentId] ??= {
    sourceStyle: null,
    styleEntry: null,
  };
  return structure.components[componentId];
};

const readEntry = (root: string, relativePath: string, id = relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return null;

  return createStyleEntry(id, fs.readFileSync(file, 'utf8'), {
    path: toPosixTestPath(relativePath),
  });
};

export function normalizeBuildStyleStructure(
  packageRoot: string,
  outputDir: string,
) {
  const outputRoot = path.join(packageRoot, outputDir);
  const structure = createEmptyStyleStructure();
  const packageEntry = readEntry(outputRoot, 'index.css');

  structure.packageEntry = packageEntry;
  if (packageEntry) structure.entries[packageEntry.id] = packageEntry;

  if (!fs.existsSync(outputRoot)) return structure;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      if (!file.endsWith('.css')) continue;

      const relativePath = toPosixTestPath(path.relative(outputRoot, file));
      const styleEntry = readEntry(outputRoot, relativePath);
      if (!styleEntry) continue;

      structure.entries[relativePath] = styleEntry;

      const themeMatch = relativePath.match(
        /^(?:[^/]+\/)?themes\/([^/]+)\.css$/,
      );
      if (themeMatch) {
        structure.themes[themeMatch[1]] = styleEntry;
      }

      const componentStyleMatch = relativePath.match(
        /^[^/]+\/(components\/[^/]+)\/style\/index\.css$/,
      );
      if (componentStyleMatch) {
        const component = ensureComponent(structure, componentStyleMatch[1]);
        component.styleEntry = styleEntry;
      }

      const componentSourceMatch = relativePath.match(
        /^[^/]+\/(components\/[^/]+)\/index\.css$/,
      );
      if (componentSourceMatch) {
        const component = ensureComponent(structure, componentSourceMatch[1]);
        component.sourceStyle = styleEntry;
      }
    }
  };

  walk(outputRoot);
  return structure;
}

const normalizeGraphEntry = (
  stylePath: string,
  result: PackageStyleLoadResult,
  packageRoot: string,
) => {
  return createStyleEntry(stylePath, result.code, {
    watchFiles: result.watchFiles.map((file) =>
      toPosixTestPath(path.relative(packageRoot, file)),
    ),
  });
};

export async function normalizeGraphStyleStructure(
  graph: ModuleStyleGraph,
  packageName: string,
  packageRoot: string,
  stylePaths: Array<string>,
) {
  const structure = createEmptyStyleStructure();

  for (const stylePath of stylePaths) {
    const result = await graph.createPackageStyleCode({
      packageName,
      stylePath,
    });
    const entry = normalizeGraphEntry(stylePath, result, packageRoot);

    structure.entries[stylePath] = entry;
    if (stylePath === 'style.css') {
      structure.packageEntry = entry;
    }

    const themeMatch = stylePath.match(/^themes\/([^/]+)\.css$/);
    if (themeMatch) {
      structure.themes[themeMatch[1]] = entry;
    }

    const componentMatch = stylePath.match(/^(.+)\.css$/);
    if (
      componentMatch &&
      !['style.css', 'external.css', 'module.css'].includes(stylePath) &&
      !stylePath.startsWith('themes/')
    ) {
      ensureComponent(structure, componentMatch[1]).styleEntry = entry;
    }
  }

  return structure;
}
