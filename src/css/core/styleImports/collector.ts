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

const SOURCE_EXTENSION_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SOURCE_INDEX_RE = new RegExp(`[/\\\\]index${SOURCE_EXTENSION_RE.source}`);

export class ModuleStyleImportCollector {
  constructor(
    private readonly srcRoot: string,
    private readonly packageRoot: string,
    private readonly resolver: WorkspaceStyleResolver,
    private readonly styleExtensions: Array<string> = ['.css'],
  ) {}

  collect(files: Array<string>, config: NormalizedAukletConfig) {
    const entries = new Map<string, Array<string>>();
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
    return entries;
  }

  private collectSourceImportStyle(
    entries: Map<string, Array<string>>,
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
    appendUniqueMapValue(
      entries,
      sourceModuleDir,
      this.toRelativeSpecifier(sourceStyleDir, importedStyleEntry),
    );
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

      for (const extension of this.styleExtensions) {
        const directorySourceStyle = path.join(sourceBase, `index${extension}`);
        if (fs.existsSync(directorySourceStyle)) return directoryStyleEntry;
      }

      const hasFileSourceStyle = this.styleExtensions.some((extension) =>
        fs.existsSync(`${sourceBase}${extension}`),
      );
      if (hasFileSourceStyle)
        return path.join(sourceBase, 'style', 'index.css');
    }
    return null;
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
