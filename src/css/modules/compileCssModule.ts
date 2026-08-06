import path from 'node:path';
import postcss from 'postcss';
import postcssModules from 'postcss-modules';
import { compileLess } from '#auklet/css/core/lessCompiler';
import {
  hasLessImportOption,
  mapPreservedLessImportToCssSpecifier,
  rewriteLessImportAsReference,
} from '#auklet/css/core/lessImportGraph';
import { assertLessCompileImportsWithinSourceRoot } from '#auklet/css/modules/resolveCssModuleStyleImport';
import {
  createCssModulePartialImportGraph,
  getCssModulePartialImportGraphNode,
  type CssModulePartialImportGraph,
} from '#auklet/css/modules/cssModulePartialImportGraph';
import { createImportCode } from '#auklet/css/core/style/specifier';
import { generateScopedName } from '#auklet/css/modules/generateScopedName';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import { normalizeFileKey } from '#auklet/utils';

export type CssModuleRequest = {
  file: string;
  code?: string;
  sourceRoot?: string;
};

export type CssModuleStyleAsset = {
  file: string;
  css: string;
  dependencies: Array<string>;
};

export type CssModuleResult = {
  css: string;
  scopedCss: string;
  locals: Record<string, string>;
  watchFiles: Array<string>;
  styleAssets: Array<CssModuleStyleAsset>;
};

type PreservedStyleImport = {
  importedPath: string;
  cssSpecifier: string;
  raw: boolean;
};

const collectCssModuleStyleAssets = (
  entryFiles: Array<string>,
  graph: CssModulePartialImportGraph,
  collectDependencies: (file: string) => Array<string>,
  collected = new Set<string>(),
) => {
  const styleAssetsByFile = new Map<string, CssModuleStyleAsset>();

  const visit = (cssFile: string) => {
    const normalized = path.resolve(cssFile);
    if (collected.has(normalized)) return;

    collected.add(normalized);
    const node = getCssModulePartialImportGraphNode(graph, normalized);
    for (const edge of node.imports) {
      visit(edge.importedFile);
    }

    styleAssetsByFile.set(normalized, {
      file: normalized,
      css: node.source,
      dependencies: collectDependencies(normalized),
    });
  };

  for (const entryFile of entryFiles) {
    visit(entryFile);
  }

  return {
    styleAssets: Array.from(styleAssetsByFile.values()),
  };
};

const createStyleAssetDependencyCollector = (
  graph: CssModulePartialImportGraph,
) => {
  const cache = new Map<string, Array<string>>();

  const collect = (file: string) => {
    const node = getCssModulePartialImportGraphNode(graph, file);
    const key = normalizeFileKey(node.file);
    const cached = cache.get(key);
    if (cached) return cached;

    const dependencies = new Set([node.file]);
    for (const edge of node.imports) {
      for (const dependency of collect(edge.importedFile)) {
        dependencies.add(dependency);
      }
    }
    const result = Array.from(dependencies);
    cache.set(key, result);
    return result;
  };

  return collect;
};

const appendUniqueStyleAssets = (
  target: Array<CssModuleStyleAsset>,
  additions: Array<CssModuleStyleAsset>,
) => {
  const files = new Set(target.map((asset) => normalizeFileKey(asset.file)));
  for (const asset of additions) {
    const key = normalizeFileKey(asset.file);
    if (files.has(key)) continue;
    files.add(key);
    target.push(asset);
  }
};

const compileModuleCss = (
  file: string,
  graph: CssModulePartialImportGraph,
  collectDependencies: (file: string) => Array<string>,
) => {
  const node = getCssModulePartialImportGraphNode(graph, file);
  const preservedImports: Array<PreservedStyleImport> = [];
  let compileCode = node.source;

  for (const edge of [...node.imports].reverse()) {
    preservedImports.unshift({
      importedPath: edge.importedFile,
      cssSpecifier: mapPreservedLessImportToCssSpecifier(
        edge.importedFile,
        file,
      ),
      raw: true,
    });
    compileCode =
      compileCode.slice(0, edge.import.start) +
      compileCode.slice(edge.import.end);
  }

  const assets = collectCssModuleStyleAssets(
    preservedImports.map((item) => item.importedPath),
    graph,
    collectDependencies,
  );

  return {
    css: compileCode,
    preservedImportSpecifiers: preservedImports.map(
      (item) => item.cssSpecifier,
    ),
    ...assets,
  };
};

const compileModuleLess = async (
  file: string,
  graph: CssModulePartialImportGraph,
  watchFiles: Set<string>,
  collectDependencies: (file: string) => Array<string>,
  sourceRoot?: string,
) => {
  const node = getCssModulePartialImportGraphNode(graph, file);
  const preservedImports: Array<PreservedStyleImport> = [];
  let compileCode = node.source;

  for (const edge of [...node.imports].reverse()) {
    const importedNode = getCssModulePartialImportGraphNode(
      graph,
      edge.importedFile,
    );
    const preserveAsCss = hasLessImportOption(edge.import.options, 'css');
    if (edge.import.options !== null && !preserveAsCss) continue;

    if (importedNode.extension === '.less' && !preserveAsCss) {
      preservedImports.unshift({
        importedPath: importedNode.file,
        cssSpecifier: mapPreservedLessImportToCssSpecifier(
          importedNode.file,
          file,
        ),
        raw: false,
      });
      const rewritten = rewriteLessImportAsReference(edge.import);
      if (rewritten) {
        compileCode =
          compileCode.slice(0, edge.import.start) +
          rewritten +
          compileCode.slice(edge.import.end);
      }
      continue;
    }

    if (importedNode.extension === '.css' || preserveAsCss) {
      preservedImports.unshift({
        importedPath: importedNode.file,
        cssSpecifier: mapPreservedLessImportToCssSpecifier(
          importedNode.file,
          file,
        ),
        raw: true,
      });
      compileCode =
        compileCode.slice(0, edge.import.start) +
        compileCode.slice(edge.import.end);
    }
  }

  const lessResult = await compileLess(file, compileCode);
  assertLessCompileImportsWithinSourceRoot(
    lessResult.imports,
    file,
    sourceRoot,
  );
  for (const imported of lessResult.imports) {
    watchFiles.add(path.resolve(imported));
  }

  const styleAssets: Array<CssModuleStyleAsset> = [];
  const collectedCssFiles = new Set<string>();
  for (const { importedPath, raw } of preservedImports) {
    const importedNode = getCssModulePartialImportGraphNode(
      graph,
      importedPath,
    );
    if (raw) {
      const assets = collectCssModuleStyleAssets(
        [importedPath],
        graph,
        collectDependencies,
        collectedCssFiles,
      );
      appendUniqueStyleAssets(styleAssets, assets.styleAssets);
      continue;
    }

    const cssDependencies = collectDependencies(importedPath).filter(
      (dependency) =>
        getCssModulePartialImportGraphNode(graph, dependency).extension ===
        '.css',
    );
    const dependencyAssets = collectCssModuleStyleAssets(
      cssDependencies,
      graph,
      collectDependencies,
      collectedCssFiles,
    );
    appendUniqueStyleAssets(styleAssets, dependencyAssets.styleAssets);

    const partialResult = await compileLess(importedPath, importedNode.source);
    assertLessCompileImportsWithinSourceRoot(
      partialResult.imports,
      importedPath,
      sourceRoot,
    );
    for (const imported of partialResult.imports) {
      watchFiles.add(path.resolve(imported));
    }
    appendUniqueStyleAssets(styleAssets, [
      {
        file: importedPath,
        css: partialResult.css,
        dependencies: collectDependencies(importedPath),
      },
    ]);
  }

  return {
    css: lessResult.css,
    preservedImportSpecifiers: preservedImports.map(
      (item) => item.cssSpecifier,
    ),
    styleAssets,
  };
};

export const createCssModuleLocalsViteLoadCode = (
  result: CssModuleResult,
  styleModuleId: string,
) =>
  `import ${JSON.stringify(styleModuleId)};\n` +
  `export default ${JSON.stringify(result.locals)};\n`;

export async function compileCssModule(
  request: CssModuleRequest,
): Promise<CssModuleResult> {
  const file = path.resolve(request.file);
  if (!isCssModuleFile(file)) {
    throw new Error(
      `[css] expected a CSS Modules file (*.module.css|*.module.less), got ${file}`,
    );
  }
  const sourceRoot = request.sourceRoot
    ? path.resolve(request.sourceRoot)
    : undefined;
  const sources =
    request.code === undefined
      ? undefined
      : new Map([[normalizeFileKey(file), request.code]]);
  const graph = createCssModulePartialImportGraph(file, {
    sourceRoot,
    sources,
  });
  const watchFiles = new Set(
    Array.from(graph.nodes.values(), (node) => node.file),
  );
  const collectDependencies = createStyleAssetDependencyCollector(graph);
  const { css, styleAssets, preservedImportSpecifiers } =
    path.extname(file).toLowerCase() === '.less'
      ? await compileModuleLess(
          file,
          graph,
          watchFiles,
          collectDependencies,
          sourceRoot,
        )
      : compileModuleCss(file, graph, collectDependencies);

  let locals: Record<string, string> = {};
  const result = await postcss([
    postcssModules({
      generateScopedName,
      getJSON(_cssFileName, json) {
        locals = json;
      },
    }),
  ]).process(css, { from: file });

  const scopedCss = result.css;
  const moduleCss = preservedImportSpecifiers.length
    ? `${createImportCode(preservedImportSpecifiers)}\n${scopedCss}`
    : scopedCss;

  return {
    css: moduleCss,
    scopedCss,
    locals,
    watchFiles: Array.from(watchFiles),
    styleAssets,
  };
}
