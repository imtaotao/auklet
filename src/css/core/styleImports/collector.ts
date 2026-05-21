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

const GLOBSTAR_TOKEN = '**';

type AutoImportRule = {
  packageName: string;
  outputPattern: string;
};

type SourceImportAliasRule = {
  prefix: string;
};

export class ModuleStyleImportCollector {
  private readonly sourceImportAliasRules: Array<SourceImportAliasRule>;

  constructor(
    private readonly srcRoot: string,
    private readonly packageRoot: string,
    private readonly resolver: WorkspaceStyleResolver,
    private readonly styleExtensions: Array<string> = ['.css'],
  ) {
    this.sourceImportAliasRules = this.createSourceImportAliasRules();
  }

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
    const sourceRelativePath = this.resolveSourceImportPath(
      sourceDir,
      importPath,
    );
    if (!sourceRelativePath) return null;

    const sourceBase = path.join(this.srcRoot, sourceRelativePath);
    const directoryStyleEntry = path.join(sourceBase, 'style', 'index.css');

    for (const extension of this.styleExtensions) {
      const directorySourceStyle = path.join(sourceBase, `index${extension}`);
      if (fs.existsSync(directorySourceStyle)) return directoryStyleEntry;
    }

    const hasFileSourceStyle = this.styleExtensions.some((extension) =>
      fs.existsSync(`${sourceBase}${extension}`),
    );
    if (!hasFileSourceStyle) return null;
    return path.join(sourceBase, 'style', 'index.css');
  }

  private resolveSourceImportPath(sourceDir: string, importPath: string) {
    if (importPath.startsWith('.')) {
      return path.normalize(path.join(sourceDir, importPath));
    }
    for (const rule of this.sourceImportAliasRules) {
      if (!importPath.startsWith(rule.prefix)) continue;
      return importPath.slice(rule.prefix.length);
    }
    return null;
  }

  private createSourceImportAliasRules() {
    const packageJsonPath = path.join(this.packageRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return [];

    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf8'),
    ) as {
      imports?: Record<string, string | unknown>;
    };
    const rules: Array<SourceImportAliasRule> = [];

    for (const [name, target] of Object.entries(packageJson.imports ?? {})) {
      if (
        !name.endsWith(`${POSIX_SEPARATOR}*`) ||
        typeof target !== 'string' ||
        !target.includes('*')
      ) {
        continue;
      }
      rules.push({
        prefix: name.slice(0, -1),
      });
    }
    return rules;
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
