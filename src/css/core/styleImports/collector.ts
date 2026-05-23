import fs from 'node:fs';
import path from 'node:path';
import { isArray } from 'aidly';
import type { NormalizedAukletConfig } from '#auklet/types';
import { SOURCE_COMPONENT_MODULE_RE } from '#auklet/css/constants';
import type { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';
import { joinDependencySpecifier } from '#auklet/css/core/style/specifier';
import {
  appendUniqueMapValue,
  getSourceModuleDir,
  POSIX_SEPARATOR,
} from '#auklet/utils';
import {
  collectModuleStyleSourceReferences,
  getSourceReferenceImportedNames,
  isTypeOnlySourceReference,
  type ModuleStyleSourceReference,
} from '#auklet/css/core/styleImports/sourceReference';
import { resolveRelativeSourceImport } from '#auklet/css/core/resolvers/relative';
import { resolvePackageImportsSourceImport } from '#auklet/css/core/resolvers/packageImports';
import { resolveTsconfigPathsSourceImport } from '#auklet/css/core/resolvers/tsconfigPaths';

const GLOBSTAR_TOKEN = '**';
const SOURCE_EXTENSION_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SOURCE_INDEX_RE = new RegExp(`[/\\\\]index${SOURCE_EXTENSION_RE.source}`);

type AutoImportRule = {
  packageName: string;
  outputPattern: string;
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
    const rules = this.createAutoImportRules(config);

    for (const file of files) {
      if (!SOURCE_COMPONENT_MODULE_RE.test(file)) {
        continue;
      }
      const sourceRelative = path.relative(this.srcRoot, file);
      const sourceDir = path.dirname(sourceRelative);
      const sourceModuleDir = getSourceModuleDir(sourceRelative);
      const code = fs.readFileSync(file, 'utf8');
      const imports = collectModuleStyleSourceReferences(file, code);

      for (const item of imports) {
        this.collectSourceImportStyle(
          entries,
          sourceDir,
          sourceModuleDir,
          item,
        );

        if (isTypeOnlySourceReference(item)) continue;

        const importPath = item.importPath;
        const ruleMatches = this.matchAutoImportRules(rules, importPath);
        if (!ruleMatches.length) continue;

        const directSpecifiers = ruleMatches.flatMap((ruleMatch) => {
          const specifier = this.createDirectStyleSpecifier(
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
          const importedNames = getSourceReferenceImportedNames(file, item);

          for (const importedName of importedNames) {
            const specifier = this.createStyleSpecifier(
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
    item: ModuleStyleSourceReference,
  ) {
    if (isTypeOnlySourceReference(item)) return;

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

  private createAutoImportRules(config: NormalizedAukletConfig) {
    const rules: Array<AutoImportRule> = [];
    for (const [packageName, dependency] of Object.entries(
      config.styles.dependencies,
    )) {
      const dependencyPaths = isArray(dependency.components)
        ? dependency.components
        : dependency.components
          ? [dependency.components]
          : [];

      for (const dependencyPath of dependencyPaths) {
        rules.push({
          packageName,
          outputPattern: joinDependencySpecifier(packageName, dependencyPath),
        });
      }
    }
    return rules;
  }

  private matchAutoImportRules(
    rules: Array<AutoImportRule>,
    importPath: string,
  ) {
    const matches: Array<{
      rule: AutoImportRule;
      values: Array<string>;
    }> = [];

    for (const rule of rules) {
      if (
        importPath !== rule.packageName &&
        !importPath.startsWith(`${rule.packageName}${POSIX_SEPARATOR}`)
      ) {
        continue;
      }
      matches.push({
        rule,
        values: this.getImportPathValues(rule.packageName, importPath),
      });
    }
    return matches;
  }

  private getImportPathValues(packageName: string, importPath: string) {
    return importPath
      .slice(packageName.length)
      .replace(new RegExp(`^${POSIX_SEPARATOR}`), '')
      .split(POSIX_SEPARATOR)
      .filter(Boolean);
  }

  private createStyleSpecifier(
    rule: AutoImportRule,
    values: Array<string>,
    importedName: string,
  ) {
    const pathValues = [...values];
    return rule.outputPattern.replace(/\*\*|\*/g, (token) => {
      const matchedValue = pathValues.shift();
      if (matchedValue) return matchedValue;
      if (token === GLOBSTAR_TOKEN) return importedName;
      return matchedValue ?? importedName;
    });
  }

  private createDirectStyleSpecifier(rule: AutoImportRule, importPath: string) {
    const wildcardIndex = rule.outputPattern.indexOf('*');
    if (wildcardIndex < 0) {
      return null;
    }
    const wildcardLength = rule.outputPattern.startsWith(
      GLOBSTAR_TOKEN,
      wildcardIndex,
    )
      ? GLOBSTAR_TOKEN.length
      : 1;
    const prefix = rule.outputPattern.slice(0, wildcardIndex);
    const suffix = rule.outputPattern.slice(wildcardIndex + wildcardLength);

    if (!importPath.startsWith(prefix)) {
      return null;
    }
    return `${importPath}${suffix}`;
  }
}
