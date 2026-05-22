import fs from 'node:fs';
import path from 'node:path';
import postcss, { type AtRule, type Root } from 'postcss';
import type { ModuleStyleBuildConfig } from '#auklet/types';
import type { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';

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

  readStyleFile(stylePath: string, seen = new Set<string>()) {
    if (!fs.existsSync(stylePath)) {
      return '';
    }
    const normalizedPath = path.resolve(stylePath);
    if (seen.has(normalizedPath)) return '';
    seen.add(normalizedPath);

    const css = fs.readFileSync(stylePath, 'utf8');
    const root = this.parse(css, stylePath);
    const imports: Array<{ rule: AtRule; specifier: string }> = [];

    root.walkAtRules('import', (rule) => {
      const specifier = this.parseImportSpecifier(rule.params);
      if (specifier) imports.push({ rule, specifier });
    });

    for (const { rule, specifier } of imports) {
      const importedPath = this.resolver.resolveStyleDependency(
        specifier,
        path.dirname(stylePath),
      );
      if (!importedPath) continue;
      const content = this.readStyleFile(importedPath, seen);
      if (!content.trim()) {
        rule.remove();
        continue;
      }
      rule.replaceWith(...(this.parse(content, importedPath).nodes ?? []));
    }
    return root.toString();
  }

  collectImportedStyleFiles(styleFiles: Array<string>) {
    const imported = new Set<string>();
    for (const styleFile of styleFiles) {
      const css = fs.readFileSync(styleFile, 'utf8');
      const root = this.parse(css, styleFile);

      root.walkAtRules('import', (rule) => {
        const specifier = this.parseImportSpecifier(rule.params);
        if (
          !specifier?.startsWith('.') ||
          !this.config.styleExtensions.includes(path.extname(specifier))
        ) {
          return;
        }
        imported.add(path.resolve(path.dirname(styleFile), specifier));
      });
    }
    return imported;
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

  private parse(code: string, from: string) {
    // Keep parsing behind one method so future style languages can transform
    // to CSS before PostCSS reads the final stylesheet.
    return postcss.parse(code, { from });
  }

  private parseImportSpecifier(params: string) {
    const value = params.trim();
    const first = value[0];

    if (first === '"' || first === "'") {
      const end = value.indexOf(first, 1);
      return end > 0 ? value.slice(1, end) : null;
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
      return quoteEnd > 0 ? url.slice(1, quoteEnd) : null;
    }
    return url || null;
  }
}
