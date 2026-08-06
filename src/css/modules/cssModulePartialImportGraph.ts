import fs from 'node:fs';
import path from 'node:path';
import {
  assertCssModulePlainImport,
  hasLessImportOption,
  parseLessSourceImports,
  type LessSourceImport,
} from '#auklet/css/core/lessImportGraph';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import { resolveCssModuleStyleImport } from '#auklet/css/modules/resolveCssModuleStyleImport';
import { normalizeFileKey } from '#auklet/utils';

export type CssModulePartialImportGraphOptions = {
  sourceRoot?: string;
  sources?: Map<string, string>;
};

export type CssModulePartialImportGraphEdge = {
  import: LessSourceImport;
  importedFile: string;
};

export type CssModulePartialImportGraphNode = {
  file: string;
  source: string;
  extension: '.css' | '.less';
  imports: Array<CssModulePartialImportGraphEdge>;
};

export type CssModulePartialImportGraph = {
  entryFile: string;
  nodes: ReadonlyMap<string, CssModulePartialImportGraphNode>;
};

const readCssModuleSource = (file: string, sources?: Map<string, string>) => {
  const normalized = path.resolve(file);
  const override = sources?.get(normalizeFileKey(normalized));
  if (override !== undefined) return override;
  if (!fs.existsSync(normalized)) {
    throw new Error(`[css] CSS Modules file not found: ${normalized}`);
  }
  return fs.readFileSync(normalized, 'utf8');
};

export function getCssModulePartialImportGraphNode(
  graph: CssModulePartialImportGraph,
  file: string,
) {
  const normalized = path.resolve(file);
  const node = graph.nodes.get(normalizeFileKey(normalized));
  if (!node) {
    throw new Error(
      `[css] CSS Modules file not found in import graph: ${normalized}`,
    );
  }
  return node;
}

export function createCssModulePartialImportGraph(
  entryFile: string,
  options: CssModulePartialImportGraphOptions = {},
) {
  const nodes = new Map<string, CssModulePartialImportGraphNode>();
  const visiting = new Set<string>();
  const stack: Array<string> = [];

  const visit = (file: string) => {
    const normalized = path.resolve(file);
    const key = normalizeFileKey(normalized);
    if (nodes.has(key)) return;

    if (visiting.has(key)) {
      const cycleStart = stack.indexOf(normalized);
      const cycle =
        cycleStart >= 0
          ? [...stack.slice(cycleStart), normalized]
          : [normalized, normalized];
      throw new Error(
        `[css] circular CSS import detected: ${cycle.join(' -> ')}`,
      );
    }

    visiting.add(key);
    stack.push(normalized);

    const source = readCssModuleSource(normalized, options.sources);
    const extension = path.extname(normalized).toLowerCase();
    const imports = parseLessSourceImports(source).flatMap((parsed) => {
      assertCssModulePlainImport(parsed, normalized);
      if (extension === '.css' && parsed.options !== null) {
        throw new Error(
          `[css] CSS imports must not use Less options (${parsed.options}): ${parsed.specifier} from ${normalized}`,
        );
      }
      const importedFile = resolveCssModuleStyleImport(
        parsed.specifier,
        normalized,
        {
          sourceRoot: options.sourceRoot,
          allowMissing: hasLessImportOption(parsed.options, 'optional'),
        },
      );
      if (!importedFile) return [];

      if (isCssModuleFile(importedFile)) {
        throw new Error(
          `[css] CSS Modules files must not import other CSS Modules files: ${parsed.specifier} from ${normalized}`,
        );
      }

      const importedExtension = path.extname(importedFile).toLowerCase();

      if (extension === '.css' && importedExtension !== '.css') {
        throw new Error(
          `[css] CSS Modules partial imports must be local .css files: ${parsed.specifier} from ${normalized}`,
        );
      }
      if (importedExtension !== '.css' && importedExtension !== '.less') {
        throw new Error(
          `[css] CSS Modules partial imports must be local .css or .less files: ${parsed.specifier} from ${normalized}`,
        );
      }

      return [
        {
          import: parsed,
          importedFile,
        },
      ];
    });

    for (const edge of imports) {
      visit(edge.importedFile);
    }

    stack.pop();
    visiting.delete(key);
    nodes.set(key, {
      file: normalized,
      source,
      extension: extension as '.css' | '.less',
      imports,
    });
  };

  const normalizedEntry = path.resolve(entryFile);
  visit(normalizedEntry);
  return {
    entryFile: normalizedEntry,
    nodes,
  } satisfies CssModulePartialImportGraph;
}
