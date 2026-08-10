import fs from 'node:fs';
import path from 'node:path';
import postcss, { type AtRule, type Root } from 'postcss';
import {
  compileLess,
  type LessCompileResult,
} from '#auklet/css/core/lessCompiler';
import { prefixSelectors } from '#auklet/css/core/prefixSelectors';
import { toOutputStylePath } from '#auklet/css/core/style/specifier';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import { toPosixPath } from '#auklet/utils';
import type { ModuleStyleBuildConfig } from '#auklet/types';
import {
  isInlineLessImport,
  parseLessSourceImports,
  rewriteLessImportAsReference,
} from '#auklet/css/core/lessImportGraph';
import type { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';
import {
  isExternalPackageSpecifier,
  resolveImporterPackageRoot,
} from '#auklet/css/core/resolvers/externalLess';
import { createLessExternalImportPlan } from '#auklet/css/core/externalLessGraph';

export type StyleFileImportReference = {
  importer: string;
  imported: string;
  specifier: string;
};

export type StyleFileImportExpandOptions = {
  mapImportSpecifier?: (reference: StyleFileImportReference) => string;
  shouldExpandImport?: (reference: StyleFileImportReference) => boolean;
  /**
   * Apply `styles.prefix` to this read's result. Use only for own-package
   * style/theme top-level reads — never for dependency CSS. Nested import
   * expansion always forces this off so prefix runs once per top-level read.
   * Defaults to false; callers must opt in explicitly.
   */
  applyPrefix?: boolean;
  /**
   * When copying global `.less` entries, compile partials to `.css` and keep
   * `@import` edges instead of inlining Less imports into the entry copy.
   */
  preserveLessImportGraph?: boolean;
};

export type StyleProcessorOptions = {
  prefix?: string;
};

type StyleLessResult = LessCompileResult & {
  externalDependencyFiles: Array<string>;
  externalDependencyPackages: Array<string>;
  externalAbsentDependencyFiles: Array<string>;
  hasExternalPackageImports: boolean;
};

export class StyleProcessor {
  private readonly lessCache = new Map<string, StyleLessResult>();
  private readonly prefix?: string;

  constructor(
    private readonly config: ModuleStyleBuildConfig,
    private readonly resolver: WorkspaceStyleResolver,
    options: StyleProcessorOptions = {},
  ) {
    this.prefix = options.prefix;
  }

  async warmLessCache(styleFiles: Iterable<string>) {
    for (const styleFile of styleFiles) {
      if (path.extname(styleFile) !== '.less') continue;
      if (!fs.existsSync(styleFile)) continue;
      await this.getLessResult(styleFile);
    }
  }

  clearLessCache() {
    this.lessCache.clear();
  }

  async collectLessImportFiles(styleFile: string) {
    return (await this.collectLessDependencyFiles(styleFile)).filter(
      (imported) =>
        this.config.styleExtensions.includes(path.extname(imported)),
    );
  }

  async collectLessDependencyFiles(styleFile: string) {
    if (path.extname(styleFile) !== '.less' || !fs.existsSync(styleFile)) {
      return [] as Array<string>;
    }
    const result = await this.getLessResult(styleFile);
    return result.imports;
  }

  async collectLessDependencyPackages(styleFile: string) {
    if (path.extname(styleFile) !== '.less' || !fs.existsSync(styleFile)) {
      return [] as Array<string>;
    }
    const result = await this.getLessResult(styleFile);
    return result.externalDependencyPackages;
  }

  async collectLessAbsentDependencyFiles(styleFile: string) {
    if (path.extname(styleFile) !== '.less' || !fs.existsSync(styleFile)) {
      return [] as Array<string>;
    }
    const result = await this.getLessResult(styleFile);
    return result.externalAbsentDependencyFiles;
  }

  async hasExternalLessPackageImports(styleFile: string) {
    if (path.extname(styleFile) !== '.less' || !fs.existsSync(styleFile)) {
      return false;
    }
    const result = await this.getLessResult(styleFile);
    return result.hasExternalPackageImports;
  }

  createRoot() {
    return postcss.root();
  }

  appendImportRule(root: Root, specifier: string, tail?: string | null) {
    const rule = postcss.atRule({
      name: 'import',
      params: `"${specifier}"${tail ? ` ${tail}` : ''}`,
    });
    if (root.nodes?.length) rule.raws.before = '\n';
    root.append(rule);
    root.raws.semicolon = true;
  }

  stringify(root: Root) {
    root.raws.semicolon = true;
    return `${root}\n`;
  }

  appendStyleContent(target: Root, content: string, from: string) {
    // content is already CSS (possibly from a .less source). Never re-run Less
    // or prefix based on the source path extension.
    const root = this.parseCss(content, from);
    if (target.nodes?.length && root.nodes?.[0]) {
      root.nodes[0].raws.before = '\n';
    }
    target.append(...(root.nodes ?? []));
  }

  async readStyleFile(
    stylePath: string,
    seen = new Set<string>(),
    options: StyleFileImportExpandOptions = {},
  ) {
    if (!fs.existsSync(stylePath)) {
      return '';
    }
    const applyPrefix = options.applyPrefix === true;
    const normalizedPath = path.resolve(stylePath);
    this.assertNotCssModuleFile(normalizedPath);
    if (seen.has(normalizedPath)) return '';
    seen.add(normalizedPath);

    const root =
      path.extname(stylePath) === '.less' && options.preserveLessImportGraph
        ? await this.loadPreservedLessStyleRoot(stylePath, options)
        : await this.loadStyleRootFromDisk(stylePath);
    const imports: Array<{
      rule: AtRule;
      specifier: string;
      specifierStart: number;
      specifierEnd: number;
    }> = [];

    root.walkAtRules('import', (rule) => {
      const reference = this.parseImportSpecifierReference(rule.params);
      if (reference) imports.push({ rule, ...reference });
    });

    const nestedOptions: StyleFileImportExpandOptions = {
      ...options,
      applyPrefix: false,
    };

    for (const { rule, specifier, specifierStart, specifierEnd } of imports) {
      const { reference, isLocalStyleImport } =
        this.resolveStyleImportReference(specifier, stylePath);
      this.assertNotCssModuleFile(reference.imported, {
        specifier,
        importer: stylePath,
      });
      this.assertSourceRootLocalStyleImport(reference, isLocalStyleImport);
      const mappedSpecifier = options.mapImportSpecifier?.(reference);
      if (mappedSpecifier) {
        rule.params = `${rule.params.slice(
          0,
          specifierStart,
        )}${mappedSpecifier}${rule.params.slice(specifierEnd)}`;
      }
      if (options.shouldExpandImport?.(reference) === false) {
        continue;
      }
      const content = await this.readStyleFile(
        reference.imported,
        seen,
        nestedOptions,
      );
      if (!content.trim()) {
        rule.remove();
        continue;
      }
      rule.replaceWith(
        ...(this.parseCss(content, reference.imported).nodes ?? []),
      );
    }

    if (applyPrefix && this.prefix) {
      prefixSelectors(root, this.prefix);
    }
    return root.toString();
  }

  private isSourceStyleImportSpecifier(
    specifier: string,
    importedPath: string | null,
  ) {
    if (specifier.startsWith('#')) return true;

    return (
      this.config.styleExtensions.includes(
        path.extname(importedPath ?? specifier),
      ) &&
      (specifier.startsWith('.') ||
        (importedPath ? this.resolver.isInsideSourceRoot(importedPath) : false))
    );
  }

  private throwMissingLocalStyleImport(
    specifier: string,
    stylePath: string,
  ): never {
    throw new Error(
      `[css] local CSS import not found: ${specifier} from ${stylePath}`,
    );
  }

  async collectImportedStyleFiles(styleFiles: Array<string>) {
    return new Set(
      (await this.collectImportedStyleFileReferences(styleFiles)).map(
        (item) => item.imported,
      ),
    );
  }

  async collectImportedStyleFileReferences(styleFiles: Array<string>) {
    const imports: Array<StyleFileImportReference> = [];

    for (const styleFile of styleFiles) {
      imports.push(
        ...(await this.collectLocalStyleImportReferences(styleFile)),
      );
      if (path.extname(styleFile) === '.less') {
        const result = await this.getLessResult(styleFile);
        const externalDependencies = new Set(
          result.externalDependencyFiles.map((file) => path.resolve(file)),
        );
        for (const imported of result.imports) {
          if (!this.config.styleExtensions.includes(path.extname(imported))) {
            continue;
          }
          if (externalDependencies.has(path.resolve(imported))) continue;
          imports.push({
            importer: path.resolve(styleFile),
            imported: path.resolve(imported),
            specifier: imported,
          });
        }
      }
    }
    return imports;
  }

  async collectStyleImportReferences(styleFiles: Array<string>) {
    const imports: Array<StyleFileImportReference> = [];

    for (const styleFile of styleFiles) {
      const root = await this.loadStyleRootFromDisk(styleFile);

      root.walkAtRules('import', (rule) => {
        const specifier = this.parseImportSpecifier(rule.params);
        if (!specifier) return;
        const { reference } = this.resolveStyleImportReference(
          specifier,
          styleFile,
        );
        imports.push(reference);
      });
    }
    return imports;
  }

  async collectStyleImportSpecifiers(styleFiles: Array<string>) {
    const specifiers = new Set<string>();

    for (const styleFile of styleFiles) {
      const root = await this.loadStyleRootFromDisk(styleFile);

      root.walkAtRules('import', (rule) => {
        const specifier = this.parseImportSpecifier(rule.params);
        if (specifier) specifiers.add(specifier);
      });
    }
    return specifiers;
  }

  async assertNoLocalStyleImportCycles(styleFiles: Array<string>) {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const stack: Array<string> = [];

    const visit = async (styleFile: string) => {
      const normalizedPath = path.resolve(styleFile);
      if (visited.has(normalizedPath)) return;

      if (visiting.has(normalizedPath)) {
        const cycleStart = stack.indexOf(normalizedPath);
        const cycle =
          cycleStart >= 0
            ? [...stack.slice(cycleStart), normalizedPath]
            : [normalizedPath, normalizedPath];
        throw new Error(
          `[css] circular CSS import detected: ${cycle.join(' -> ')}`,
        );
      }

      if (!fs.existsSync(normalizedPath)) return;

      visiting.add(normalizedPath);
      stack.push(normalizedPath);

      for (const reference of await this.collectLocalStyleImportReferences(
        normalizedPath,
      )) {
        await visit(reference.imported);
      }

      stack.pop();
      visiting.delete(normalizedPath);
      visited.add(normalizedPath);
    };

    for (const styleFile of styleFiles) {
      await visit(styleFile);
    }
  }

  async assertNoSourceRootEscapingLocalStyleImports(styleFiles: Array<string>) {
    for (const styleFile of styleFiles) {
      if (!fs.existsSync(styleFile)) continue;
      const normalized = path.resolve(styleFile);
      for (const reference of await this.collectLocalStyleImportReferences(
        normalized,
      )) {
        this.assertSourceRootLocalStyleImport(reference, true);
      }
      // Less inlines partials before CSS @import remains; still guard the
      // Less import closure (including modules: false package builds).
      if (path.extname(normalized) !== '.less') continue;
      const lessResult = await this.getLessResult(normalized);
      const externalDependencies = new Set(
        lessResult.externalDependencyFiles.map((file) => path.resolve(file)),
      );
      for (const imported of lessResult.imports.filter((file) =>
        this.config.styleExtensions.includes(path.extname(file)),
      )) {
        if (externalDependencies.has(path.resolve(imported))) continue;
        this.assertSourceRootLocalStyleImport(
          {
            importer: normalized,
            imported: path.resolve(imported),
            specifier: imported,
          },
          true,
        );
      }
    }
  }

  private mapPreservedLessImportSpecifier(
    reference: StyleFileImportReference,
    stylePath: string,
    options: StyleFileImportExpandOptions,
  ) {
    if (options.mapImportSpecifier) {
      return options.mapImportSpecifier(reference);
    }

    const relative = toPosixPath(
      path.relative(path.dirname(stylePath), reference.imported),
    );
    const normalized = relative.startsWith('.') ? relative : `./${relative}`;
    return toPosixPath(toOutputStylePath(normalized));
  }

  private async loadPreservedLessStyleRoot(
    stylePath: string,
    options: StyleFileImportExpandOptions,
  ) {
    const sourceCode = fs.readFileSync(stylePath, 'utf8');
    const parsedImports = parseLessSourceImports(sourceCode);
    const externalPlan = this.createExternalLessPlan(stylePath, sourceCode);
    const preservedImports: Array<{
      specifier: string;
      tail: string | null;
    }> = [];
    let compileCode = sourceCode;

    for (const parsed of [...parsedImports].reverse()) {
      if (isExternalPackageSpecifier(parsed.specifier)) {
        continue;
      }
      const { reference, isLocalStyleImport } =
        this.resolveStyleImportReference(parsed.specifier, stylePath);
      this.assertNotCssModuleFile(reference.imported, {
        specifier: parsed.specifier,
        importer: stylePath,
      });
      this.assertSourceRootLocalStyleImport(reference, isLocalStyleImport);

      const importedExtension = path.extname(reference.imported);
      if (
        importedExtension === '.less' &&
        !isInlineLessImport(parsed.options)
      ) {
        const rewritten = rewriteLessImportAsReference(parsed);
        if (!rewritten) continue;

        preservedImports.unshift({
          specifier: this.mapPreservedLessImportSpecifier(
            reference,
            stylePath,
            options,
          ),
          tail: parsed.tail,
        });
        compileCode =
          compileCode.slice(0, parsed.start) +
          rewritten +
          compileCode.slice(parsed.end);
      }
    }

    const result = await compileLess(stylePath, compileCode, {
      resolveExternalImport: externalPlan.resolveImport,
    });
    const root = this.parseCss(result.css, stylePath);

    if (preservedImports.length) {
      const importRoot = postcss.root();
      for (const preserved of preservedImports) {
        this.appendImportRule(importRoot, preserved.specifier, preserved.tail);
      }
      root.prepend(...(importRoot.nodes ?? []));
    }

    return root;
  }

  private async loadStyleRootFromDisk(stylePath: string) {
    if (!fs.existsSync(stylePath)) {
      return postcss.root();
    }
    this.assertNotCssModuleFile(stylePath);
    if (path.extname(stylePath) === '.less') {
      const result = await this.getLessResult(stylePath);
      return this.parseCss(result.css, stylePath);
    }
    const code = fs.readFileSync(stylePath, 'utf8');
    return this.parseCss(code, stylePath);
  }

  private assertNotCssModuleFile(
    stylePath: string,
    options?: { specifier?: string; importer?: string },
  ) {
    if (!isCssModuleFile(stylePath)) return;
    if (options?.specifier && options.importer) {
      throw new Error(
        `[css] CSS Modules files cannot be imported from global style entries: ${options.specifier} from ${options.importer}. Use import styles from '${options.specifier}' in JS/TSX instead.`,
      );
    }
    throw new Error(
      `[css] CSS Modules files are handled by the css/modules protocol, not the global style pipeline: ${stylePath}`,
    );
  }

  private async getLessResult(stylePath: string) {
    const key = path.resolve(stylePath);
    const cached = this.lessCache.get(key);
    if (cached) return cached;

    const source = fs.readFileSync(stylePath, 'utf8');
    const externalPlan = this.createExternalLessPlan(stylePath, source);
    const compiled = await compileLess(stylePath, source, {
      resolveExternalImport: externalPlan.resolveImport,
    });
    const result = {
      ...compiled,
      externalDependencyFiles: externalPlan.dependencyFiles,
      externalDependencyPackages: externalPlan.packageNames,
      externalAbsentDependencyFiles: externalPlan.absentDependencyFiles,
      hasExternalPackageImports: externalPlan.hasExternalPackageImports,
      imports: Array.from(
        new Set([...compiled.imports, ...externalPlan.dependencyFiles]),
      ),
    };
    for (const imported of result.imports) {
      this.assertNotCssModuleFile(path.resolve(imported), {
        specifier: imported,
        importer: stylePath,
      });
    }
    this.lessCache.set(key, result);
    return result;
  }

  private createExternalLessPlan(stylePath: string, source: string) {
    const packageRoot =
      resolveImporterPackageRoot({
        packageRoot: this.resolver.packageRoot,
        sourceRoot: this.resolver.sourceRoot,
        file: stylePath,
      }) ?? path.dirname(stylePath);
    return createLessExternalImportPlan({
      entryFile: stylePath,
      packageRoot,
      source,
      sourceRoot: this.resolver.sourceRoot,
    });
  }

  private parseCss(code: string, from: string) {
    return postcss.parse(code, { from });
  }

  private parseImportSpecifier(params: string) {
    return this.parseImportSpecifierReference(params)?.specifier ?? null;
  }

  private resolveStyleImportReference(specifier: string, stylePath: string) {
    const fromDir = path.dirname(stylePath);
    const resolvedSource = this.resolver.resolveSourceStyleDependency(
      specifier,
      fromDir,
    );
    const sourceStylePath =
      (resolvedSource && fs.existsSync(resolvedSource)
        ? resolvedSource
        : null) ??
      this.resolveLessRewrittenStyleDependency(specifier, fromDir) ??
      this.resolveLessOutputStyleDependency(specifier, fromDir, stylePath);
    const isSourceStyleSpecifier = this.isSourceStyleImportSpecifier(
      specifier,
      sourceStylePath,
    );

    if (isSourceStyleSpecifier) {
      if (!sourceStylePath || !fs.existsSync(sourceStylePath)) {
        this.throwMissingLocalStyleImport(specifier, stylePath);
      }
      this.assertCssDoesNotImportLess(stylePath, sourceStylePath, specifier);
      return {
        reference: {
          importer: path.resolve(stylePath),
          imported: path.resolve(sourceStylePath),
          specifier,
        },
        isLocalStyleImport: true,
      };
    }

    const importedPath = this.resolver.resolveStyleDependency(
      specifier,
      fromDir,
    );
    return {
      reference: {
        importer: path.resolve(stylePath),
        imported: path.resolve(importedPath),
        specifier,
      },
      isLocalStyleImport: false,
    };
  }

  // Less may rewrite `@import "./file.css"` to `@import "file.css"`.
  private resolveLessRewrittenStyleDependency(
    specifier: string,
    fromDir: string,
  ) {
    if (
      specifier.startsWith('.') ||
      specifier.startsWith('#') ||
      specifier.startsWith('@') ||
      specifier.includes('/') ||
      specifier.includes('\\')
    ) {
      return null;
    }
    if (!this.config.styleExtensions.includes(path.extname(specifier))) {
      return null;
    }
    const candidate = path.resolve(fromDir, specifier);
    return fs.existsSync(candidate) ? candidate : null;
  }

  private resolveLessOutputStyleDependency(
    specifier: string,
    fromDir: string,
    stylePath: string,
  ) {
    if (
      path.extname(stylePath) !== '.less' ||
      path.extname(specifier) !== '.css'
    ) {
      return null;
    }

    const cssPath = path.resolve(fromDir, specifier);
    if (fs.existsSync(cssPath)) return cssPath;

    const lessPath = `${cssPath.slice(0, -'.css'.length)}.less`;
    return fs.existsSync(lessPath) ? lessPath : null;
  }

  private assertCssDoesNotImportLess(
    importer: string,
    imported: string,
    specifier: string,
  ) {
    if (
      path.extname(importer) === '.css' &&
      path.extname(imported) === '.less'
    ) {
      throw new Error(
        `[css] CSS must not import Less: ${specifier} from ${importer}`,
      );
    }
  }

  private assertSourceRootLocalStyleImport(
    reference: StyleFileImportReference,
    isLocalStyleImport: boolean,
  ) {
    if (
      !isLocalStyleImport ||
      !this.resolver.isInsideSourceRoot(reference.importer) ||
      this.resolver.isInsideSourceRoot(reference.imported)
    ) {
      return;
    }

    throw new Error(
      `[css] local CSS import escapes source root: ${reference.specifier} from ${reference.importer}`,
    );
  }

  private async collectLocalStyleImportReferences(styleFile: string) {
    const imports: Array<StyleFileImportReference> = [];
    if (!fs.existsSync(styleFile)) return imports;
    const importedFiles = new Set<string>();
    const appendLocalReference = (specifier: string) => {
      const { reference, isLocalStyleImport } =
        this.resolveStyleImportReference(specifier, styleFile);
      if (!isLocalStyleImport) return;
      const key = path.resolve(reference.imported);
      if (importedFiles.has(key)) return;
      importedFiles.add(key);
      imports.push(reference);
    };

    if (path.extname(styleFile) === '.less') {
      const sourceCode = fs.readFileSync(styleFile, 'utf8');
      for (const parsed of parseLessSourceImports(sourceCode)) {
        appendLocalReference(parsed.specifier);
      }
    }

    const root = await this.loadStyleRootFromDisk(styleFile);

    root.walkAtRules('import', (rule) => {
      const specifier = this.parseImportSpecifier(rule.params);
      if (!specifier) return;
      appendLocalReference(specifier);
    });

    return imports;
  }

  private parseImportSpecifierReference(params: string) {
    const value = params.trim();
    const valueOffset = params.indexOf(value);
    const first = value[0];

    if (first === '"' || first === "'") {
      const end = value.indexOf(first, 1);
      return end > 0
        ? {
            specifier: value.slice(1, end),
            specifierStart: valueOffset + 1,
            specifierEnd: valueOffset + end,
          }
        : null;
    }

    if (!value.startsWith('url(')) {
      return null;
    }

    const end = value.indexOf(')', 4);
    if (end < 0) return null;

    const url = value.slice(4, end).trim();
    const quote = url[0];
    if (quote === '"' || quote === "'") {
      const quoteEnd = url.indexOf(quote, 1);
      const quotedValueStart = value.indexOf(quote, 4);
      return quoteEnd > 0
        ? {
            specifier: url.slice(1, quoteEnd),
            specifierStart: valueOffset + quotedValueStart + 1,
            specifierEnd: valueOffset + quotedValueStart + quoteEnd,
          }
        : null;
    }
    if (!url) return null;

    const rawUrl = value.slice(4, end);
    const leadingSpaces = rawUrl.length - rawUrl.trimStart().length;
    const trailingSpaces = rawUrl.length - rawUrl.trimEnd().length;
    return {
      specifier: url,
      specifierStart: valueOffset + 4 + leadingSpaces,
      specifierEnd: valueOffset + end - trailingSpaces,
    };
  }
}
