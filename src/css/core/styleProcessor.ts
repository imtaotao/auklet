import fs from 'node:fs';
import path from 'node:path';
import postcss, { type AtRule, type Root } from 'postcss';
import type { ModuleStyleBuildConfig } from '#auklet/types';
import type { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';

export type StyleFileImportReference = {
  importer: string;
  imported: string;
  specifier: string;
};

export type StyleFileImportExpandOptions = {
  mapImportSpecifier?: (reference: StyleFileImportReference) => string;
  shouldExpandImport?: (reference: StyleFileImportReference) => boolean;
};

export class StyleProcessor {
  constructor(
    private readonly config: ModuleStyleBuildConfig,
    private readonly resolver: WorkspaceStyleResolver,
  ) {}

  createRoot() {
    return postcss.root();
  }

  appendImportRule(root: Root, specifier: string) {
    const rule = postcss.atRule({
      name: 'import',
      params: `"${specifier}"`,
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
    const root = this.parse(content, from);
    if (target.nodes?.length && root.nodes?.[0]) {
      root.nodes[0].raws.before = '\n';
    }
    target.append(...(root.nodes ?? []));
  }

  readStyleFile(
    stylePath: string,
    seen = new Set<string>(),
    options: StyleFileImportExpandOptions = {},
  ) {
    if (!fs.existsSync(stylePath)) {
      return '';
    }
    const normalizedPath = path.resolve(stylePath);
    if (seen.has(normalizedPath)) return '';
    seen.add(normalizedPath);

    const css = fs.readFileSync(stylePath, 'utf8');
    const root = this.parse(css, stylePath);
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

    for (const { rule, specifier, specifierStart, specifierEnd } of imports) {
      const { reference, isLocalStyleImport } =
        this.resolveStyleImportReference(specifier, stylePath);
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
      const content = this.readStyleFile(reference.imported, seen, options);
      if (!content.trim()) {
        rule.remove();
        continue;
      }
      rule.replaceWith(
        ...(this.parse(content, reference.imported).nodes ?? []),
      );
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

  collectImportedStyleFiles(styleFiles: Array<string>) {
    return new Set(
      this.collectImportedStyleFileReferences(styleFiles).map(
        (item) => item.imported,
      ),
    );
  }

  collectImportedStyleFileReferences(styleFiles: Array<string>) {
    const imports: Array<StyleFileImportReference> = [];

    for (const styleFile of styleFiles) {
      const css = fs.readFileSync(styleFile, 'utf8');
      const root = this.parse(css, styleFile);

      root.walkAtRules('import', (rule) => {
        const specifier = this.parseImportSpecifier(rule.params);
        if (!specifier) return;
        const { reference, isLocalStyleImport } =
          this.resolveStyleImportReference(specifier, styleFile);
        if (!isLocalStyleImport) {
          return;
        }
        imports.push(reference);
      });
    }
    return imports;
  }

  collectStyleImportSpecifiers(styleFiles: Array<string>) {
    const specifiers = new Set<string>();

    for (const styleFile of styleFiles) {
      const css = fs.readFileSync(styleFile, 'utf8');
      const root = this.parse(css, styleFile);

      root.walkAtRules('import', (rule) => {
        const specifier = this.parseImportSpecifier(rule.params);
        if (specifier) specifiers.add(specifier);
      });
    }
    return specifiers;
  }

  assertNoLocalStyleImportCycles(styleFiles: Array<string>) {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const stack: Array<string> = [];

    const visit = (styleFile: string) => {
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

      for (const reference of this.collectLocalStyleImportReferences(
        normalizedPath,
      )) {
        visit(reference.imported);
      }

      stack.pop();
      visiting.delete(normalizedPath);
      visited.add(normalizedPath);
    };

    for (const styleFile of styleFiles) {
      visit(styleFile);
    }
  }

  assertNoSourceRootEscapingLocalStyleImports(styleFiles: Array<string>) {
    for (const styleFile of styleFiles) {
      if (!fs.existsSync(styleFile)) continue;
      for (const reference of this.collectLocalStyleImportReferences(
        path.resolve(styleFile),
      )) {
        this.assertSourceRootLocalStyleImport(reference, true);
      }
    }
  }

  private parse(code: string, from: string) {
    // Keep parsing behind one method so future style languages can transform
    // to CSS before PostCSS reads the final stylesheet.
    return postcss.parse(code, { from });
  }

  private parseImportSpecifier(params: string) {
    return this.parseImportSpecifierReference(params)?.specifier ?? null;
  }

  private resolveStyleImportReference(specifier: string, stylePath: string) {
    const fromDir = path.dirname(stylePath);
    const sourceStylePath = this.resolver.resolveSourceStyleDependency(
      specifier,
      fromDir,
    );
    const isSourceStyleSpecifier = this.isSourceStyleImportSpecifier(
      specifier,
      sourceStylePath,
    );

    if (isSourceStyleSpecifier) {
      if (!sourceStylePath || !fs.existsSync(sourceStylePath)) {
        this.throwMissingLocalStyleImport(specifier, stylePath);
      }
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

  private collectLocalStyleImportReferences(styleFile: string) {
    const imports: Array<StyleFileImportReference> = [];
    const css = fs.readFileSync(styleFile, 'utf8');
    const root = this.parse(css, styleFile);

    root.walkAtRules('import', (rule) => {
      const specifier = this.parseImportSpecifier(rule.params);
      if (!specifier) return;
      const { reference, isLocalStyleImport } =
        this.resolveStyleImportReference(specifier, styleFile);
      if (!isLocalStyleImport) {
        return;
      }
      imports.push(reference);
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
