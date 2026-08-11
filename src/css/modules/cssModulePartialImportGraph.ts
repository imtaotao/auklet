import fs from 'node:fs';
import path from 'node:path';
import {
  assertCssModulePlainImport,
  hasLessImportOption,
  parseLessSourceImports,
  type LessSourceImport,
} from '#auklet/css/core/lessImportGraph';
import {
  createExternalLessDependencyGraph,
  resolveExternalLessImportAcrossGraphs,
  type ExternalLessDependencyGraph,
} from '#auklet/css/core/externalLessGraph';
import {
  ExternalLessResolutionError,
  isExternalPackageSpecifier,
  resolveImporterPackageRoot,
} from '#auklet/css/core/resolvers/externalLess';
import { resolveExternalPackageStyleImport } from '#auklet/css/core/resolvers/externalPackageStyle';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import { resolveCssModuleStyleImport } from '#auklet/css/modules/resolveCssModuleStyleImport';
import { normalizeFileKey } from '#auklet/utils';

export type CssModulePartialImportGraphOptions = {
  packageRoot?: string;
  sourceRoot?: string;
  sources?: Map<string, string>;
};

export type CssModulePartialImportGraphEdge = {
  import: LessSourceImport;
  importedFile: string;
  external: boolean;
  packageRoot: string;
};

export type CssModulePartialImportGraphNode = {
  file: string;
  source: string;
  extension: '.css' | '.less';
  imports: Array<CssModulePartialImportGraphEdge>;
  packageRoot: string;
  externalReferenceContext: boolean;
};

export type CssModulePartialImportGraph = {
  entryFile: string;
  consumerPackageRoot: string;
  hasExternalPackageImports: boolean;
  nodes: ReadonlyMap<string, CssModulePartialImportGraphNode>;
  packageJsonFiles: ReadonlySet<string>;
  absentDependencyFiles: ReadonlySet<string>;
  resolveExternalImport: (
    specifier: string,
    importerFile: string,
  ) => string | null;
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
  let hasExternalPackageImports = false;
  const nodes = new Map<string, CssModulePartialImportGraphNode>();
  const packageJsonFiles = new Set<string>();
  const absentDependencyFiles = new Set<string>();
  const externalGraphs: Array<ExternalLessDependencyGraph> = [];
  const visiting = new Set<string>();
  const stack: Array<string> = [];
  const consumerPackageRoot =
    resolveImporterPackageRoot({
      packageRoot: options.packageRoot,
      sourceRoot: options.sourceRoot,
      file: entryFile,
    }) ?? path.resolve(path.dirname(entryFile));

  const visit = (
    file: string,
    packageRoot: string,
    externalReferenceContext: boolean,
  ) => {
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
      const external = isExternalPackageSpecifier(parsed.specifier);
      if (external) {
        hasExternalPackageImports = true;
        const isReference = hasLessImportOption(parsed.options, 'reference');
        if (isReference) {
          if (extension !== '.less') {
            throw new Error(
              `[css] CSS files must not import external Less: ${parsed.specifier} from ${normalized}`,
            );
          }
          const graph = createExternalLessDependencyGraph({
            import: parsed,
            importerFile: normalized,
            importerPackageRoot: packageRoot,
          });
          externalGraphs.push(graph);
          for (const packageJsonFile of graph.packageJsonFiles) {
            packageJsonFiles.add(packageJsonFile);
          }
          for (const absentFile of graph.absentDependencyFiles) {
            absentDependencyFiles.add(absentFile);
          }
          for (const externalNode of graph.nodes.values()) {
            const externalKey = normalizeFileKey(externalNode.file);
            if (nodes.has(externalKey)) continue;
            nodes.set(externalKey, {
              file: externalNode.file,
              source: externalNode.source,
              extension: '.less',
              imports: externalNode.imports,
              packageRoot: externalNode.packageRoot,
              externalReferenceContext: true,
            });
          }
          if (!graph.entryFile) return [];
          return [
            {
              import: parsed,
              importedFile: graph.entryFile,
              external: true,
              packageRoot:
                graph.nodes.get(normalizeFileKey(graph.entryFile))
                  ?.packageRoot ?? packageRoot,
            },
          ];
        }

        // Non-reference package imports may only become plain CSS sibling
        // assets. Cross-package .less must use @import (reference) (same as
        // global styles); cross-package CSS Modules stay on the JS import path.
        try {
          const resolved = resolveExternalPackageStyleImport(
            parsed.specifier,
            packageRoot,
            {
              extensions: ['.css'],
            },
          );
          packageJsonFiles.add(resolved.packageJsonFile);
          if (isCssModuleFile(resolved.file)) {
            throw new Error(
              `[css] CSS Modules files must not import other CSS Modules files: ${parsed.specifier} from ${normalized}`,
            );
          }
          if (path.extname(resolved.file).toLowerCase() !== '.css') {
            throw new Error(
              `[css] CSS Modules partial imports must be .css files: ${parsed.specifier} from ${normalized}`,
            );
          }
          return [
            {
              import: parsed,
              importedFile: resolved.file,
              external: false,
              packageRoot: resolved.packageRoot,
            },
          ];
        } catch (error) {
          if (
            error instanceof ExternalLessResolutionError &&
            extension === '.less'
          ) {
            throw new Error(
              `[css] external Less imports must use (reference): ${parsed.specifier} from ${normalized}. Use @import (reference) for tokens/mixins, import plain package CSS as a sibling, or import CSS Modules from JS.`,
            );
          }
          throw error;
        }
      }

      const importedFile = resolveCssModuleStyleImport(
        parsed.specifier,
        normalized,
        {
          sourceRoot: externalReferenceContext
            ? packageRoot
            : options.sourceRoot,
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
          external: false,
          packageRoot,
        },
      ];
    });

    for (const edge of imports) {
      if (edge.external) continue;
      visit(
        edge.importedFile,
        edge.packageRoot,
        externalReferenceContext || edge.packageRoot !== consumerPackageRoot,
      );
    }

    stack.pop();
    visiting.delete(key);
    nodes.set(key, {
      file: normalized,
      source,
      extension: extension as '.css' | '.less',
      imports,
      packageRoot,
      externalReferenceContext,
    });
  };

  const normalizedEntry = path.resolve(entryFile);
  visit(normalizedEntry, consumerPackageRoot, false);
  return {
    entryFile: normalizedEntry,
    consumerPackageRoot,
    hasExternalPackageImports,
    nodes,
    packageJsonFiles,
    absentDependencyFiles,
    resolveExternalImport(specifier: string, importerFile: string) {
      return resolveExternalLessImportAcrossGraphs(
        externalGraphs,
        specifier,
        importerFile,
      );
    },
  } satisfies CssModulePartialImportGraph;
}
