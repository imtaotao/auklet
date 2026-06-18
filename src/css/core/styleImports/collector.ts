import fs from 'node:fs';
import path from 'node:path';
import type { NormalizedAukletConfig } from '#auklet/types';
import type { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';
import { SOURCE_MODULE_RE } from '#auklet/css/constants';
import { appendUniqueMapValue, getSourceModuleDir } from '#auklet/utils';
import {
  type ModuleImportReference,
  isTypeOnlyModuleReference,
  collectModuleImportReferences,
  getModuleReferenceImportedNames,
} from '#auklet/css/core/styleImports/sourceImportExportAnalyzer';
import { resolveRelativeSourceImport } from '#auklet/css/core/resolvers/relative';
import { resolvePackageImportsSourceImport } from '#auklet/css/core/resolvers/packageImports';
import { resolveTsconfigPathsSourceImport } from '#auklet/css/core/resolvers/tsconfigPaths';
import {
  matchStyleAutoImportRules,
  createStyleAutoImportRules,
  createStyleAutoImportSpecifier,
  createDirectStyleAutoImportSpecifier,
} from '#auklet/css/core/styleImports/autoImportRules';

const SOURCE_MODULE_EXTENSION = '.tsx';
const SOURCE_EXTENSION_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SOURCE_INDEX_RE = new RegExp(`[/\\\\]index${SOURCE_EXTENSION_RE.source}`);

type SourceImportStyleReference = {
  sourceDir: string;
  styleEntry: string;
  hasOwnStyle: boolean;
};

type SourceImportStyleEdge = SourceImportStyleReference & {
  specifier: string;
};

export class ModuleStyleImportCollector {
  constructor(
    private readonly srcRoot: string,
    private readonly packageRoot: string,
    private readonly resolver: WorkspaceStyleResolver,
    private readonly styleExtensions: Array<string> = ['.css'],
  ) {}

  collect(files: Array<string>, config: NormalizedAukletConfig) {
    const entries = new Map<string, Array<string>>();
    const sourceImportEdges = new Map<string, Array<SourceImportStyleEdge>>();
    const acceptedSourceImportEdges = new Map<string, Set<string>>();
    const rules = createStyleAutoImportRules(config);

    for (const file of files) {
      if (!SOURCE_MODULE_RE.test(file)) {
        continue;
      }
      const sourceRelative = path.relative(this.srcRoot, file);
      const sourceDir = path.dirname(sourceRelative);
      const sourceModuleDir = getSourceModuleDir(sourceRelative);
      const code = fs.readFileSync(file, 'utf8');
      const imports = collectModuleImportReferences(file, code);

      for (const item of imports) {
        this.collectSourceImportStyle(
          entries,
          sourceImportEdges,
          acceptedSourceImportEdges,
          sourceDir,
          sourceModuleDir,
          item,
        );

        if (isTypeOnlyModuleReference(item)) continue;

        const importPath = item.importPath;
        const ruleMatches = matchStyleAutoImportRules(rules, importPath);
        if (!ruleMatches.length) continue;

        const directSpecifiers = ruleMatches.flatMap((ruleMatch) => {
          const specifier = createDirectStyleAutoImportSpecifier(
            ruleMatch.rule,
            importPath,
          );
          return specifier ? [specifier] : [];
        });

        if (directSpecifiers.length) {
          for (const specifier of directSpecifiers) {
            const cssFile = this.resolver.resolveStyleDependency(specifier);
            if (fs.existsSync(cssFile)) {
              appendUniqueMapValue(entries, sourceModuleDir, specifier);
            }
          }
          continue;
        }

        for (const ruleMatch of ruleMatches) {
          const importedNames = getModuleReferenceImportedNames(file, item);

          for (const importedName of importedNames) {
            const specifier = createStyleAutoImportSpecifier(
              ruleMatch.rule,
              ruleMatch.values,
              importedName,
            );
            const cssFile = this.resolver.resolveStyleDependency(specifier);

            if (!fs.existsSync(cssFile)) {
              continue;
            }
            appendUniqueMapValue(entries, sourceModuleDir, specifier);
          }
        }
      }
    }
    this.appendResolvedSourceImportStyles(
      entries,
      sourceImportEdges,
      acceptedSourceImportEdges,
    );
    return entries;
  }

  private collectSourceImportStyle(
    entries: Map<string, Array<string>>,
    sourceImportEdges: Map<string, Array<SourceImportStyleEdge>>,
    acceptedSourceImportEdges: Map<string, Set<string>>,
    sourceDir: string,
    sourceModuleDir: string,
    item: ModuleImportReference,
  ) {
    if (isTypeOnlyModuleReference(item)) return;

    const importedStyleEntry = this.resolveSourceImportStyleEntry(
      sourceDir,
      item.importPath,
    );
    if (!importedStyleEntry) return;

    const sourceStyleDir = path.join(this.srcRoot, sourceModuleDir, 'style');
    const edge = {
      ...importedStyleEntry,
      specifier: this.toRelativeSpecifier(
        sourceStyleDir,
        importedStyleEntry.styleEntry,
      ),
    };

    if (importedStyleEntry.hasOwnStyle) {
      if (
        !this.addAcceptedSourceImportEdge(
          acceptedSourceImportEdges,
          sourceModuleDir,
          edge.sourceDir,
        )
      ) {
        return;
      }
      appendUniqueMapValue(entries, sourceModuleDir, edge.specifier);
      return;
    }
    appendUniqueMapValue(sourceImportEdges, sourceModuleDir, edge);
  }

  private resolveSourceImportStyleEntry(sourceDir: string, importPath: string) {
    const sourceRelativePaths = this.resolveSourceImportPaths(
      sourceDir,
      importPath,
    );

    for (const sourceRelativePath of sourceRelativePaths) {
      const sourceBase = this.toSourceBase(sourceRelativePath);
      if (!this.isInsideSourceRoot(sourceBase)) continue;

      const directoryStyleEntry = path.join(sourceBase, 'style', 'index.css');
      const directorySourceStyle = this.styleExtensions.some((extension) =>
        fs.existsSync(path.join(sourceBase, `index${extension}`)),
      );
      const directorySourceModule = this.hasSourceModule(
        path.join(sourceBase, 'index'),
      );
      if (directorySourceStyle || directorySourceModule) {
        return {
          sourceDir: path.relative(this.srcRoot, sourceBase),
          styleEntry: directoryStyleEntry,
          hasOwnStyle: directorySourceStyle,
        } satisfies SourceImportStyleReference;
      }

      const hasFileSourceStyle = this.styleExtensions.some((extension) =>
        fs.existsSync(`${sourceBase}${extension}`),
      );
      const hasFileSourceModule = this.hasSourceModule(sourceBase);
      if (hasFileSourceStyle || hasFileSourceModule)
        return {
          sourceDir: path.relative(this.srcRoot, sourceBase),
          styleEntry: path.join(sourceBase, 'style', 'index.css'),
          hasOwnStyle: hasFileSourceStyle,
        } satisfies SourceImportStyleReference;
    }
    return null;
  }

  private appendResolvedSourceImportStyles(
    entries: Map<string, Array<string>>,
    sourceImportEdges: Map<string, Array<SourceImportStyleEdge>>,
    acceptedSourceImportEdges: Map<string, Set<string>>,
  ) {
    const styledSourceDirs = new Set(entries.keys());
    let changed = true;

    while (changed) {
      changed = false;
      for (const [sourceModuleDir, edges] of sourceImportEdges) {
        for (const edge of edges) {
          if (!edge.hasOwnStyle && !styledSourceDirs.has(edge.sourceDir)) {
            continue;
          }
          if (
            !this.addAcceptedSourceImportEdge(
              acceptedSourceImportEdges,
              sourceModuleDir,
              edge.sourceDir,
            )
          ) {
            continue;
          }
          const before = entries.get(sourceModuleDir)?.length ?? 0;
          appendUniqueMapValue(entries, sourceModuleDir, edge.specifier);
          const after = entries.get(sourceModuleDir)?.length ?? 0;
          if (after === before) continue;
          styledSourceDirs.add(sourceModuleDir);
          changed = true;
        }
      }
    }
  }

  private addAcceptedSourceImportEdge(
    edges: Map<string, Set<string>>,
    sourceDir: string,
    targetDir: string,
  ) {
    if (sourceDir === targetDir) return false;
    if (this.hasSourceImportPath(edges, targetDir, sourceDir)) return false;

    const targets = edges.get(sourceDir) ?? new Set<string>();
    targets.add(targetDir);
    edges.set(sourceDir, targets);
    return true;
  }

  private hasSourceImportPath(
    edges: Map<string, Set<string>>,
    fromDir: string,
    toDir: string,
    seen = new Set<string>(),
  ) {
    if (fromDir === toDir) return true;
    if (seen.has(fromDir)) return false;
    seen.add(fromDir);

    for (const nextDir of edges.get(fromDir) ?? []) {
      if (this.hasSourceImportPath(edges, nextDir, toDir, seen)) return true;
    }
    return false;
  }

  private hasSourceModule(sourceBase: string) {
    return fs.existsSync(`${sourceBase}${SOURCE_MODULE_EXTENSION}`);
  }

  private isInsideSourceRoot(file: string) {
    const relative = path.relative(this.srcRoot, file);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  private resolveSourceImportPaths(sourceDir: string, importPath: string) {
    return [
      ...resolveRelativeSourceImport(sourceDir, importPath),
      ...resolvePackageImportsSourceImport(
        this.packageRoot,
        this.srcRoot,
        importPath,
      ),
      ...resolveTsconfigPathsSourceImport(
        this.packageRoot,
        this.srcRoot,
        importPath,
      ),
    ];
  }

  private toSourceBase(sourceRelativePath: string) {
    const sourceBase = path.join(this.srcRoot, sourceRelativePath);
    if (SOURCE_INDEX_RE.test(sourceBase)) {
      return path.dirname(sourceBase);
    }
    return sourceBase.replace(SOURCE_EXTENSION_RE, '');
  }

  private toRelativeSpecifier(fromDir: string, file: string) {
    const relative = path.relative(fromDir, file).split(path.sep).join('/');
    return relative.startsWith('.') ? relative : `./${relative}`;
  }
}
