import fs from 'node:fs';
import path from 'node:path';
import { toOutputStylePath } from '#auklet/css/core/style/specifier';
import { toPosixPath } from '#auklet/utils';

export type LessSourceImport = {
  start: number;
  end: number;
  options: string | null;
  quote: '"' | "'";
  specifier: string;
  tail: string | null;
};

const LESS_IMPORT_RE =
  /@import\s+(?:\(([^)]*)\)\s*)?(?:url\s*\(\s*(?:['"]([^'"]+)['"]|([^)'"\s]+))\s*\)|(['"])([^'"]+)\4)((?:\s+[^;]+)*)\s*;/g;

export function parseLessSourceImports(sourceCode: string) {
  const imports: Array<LessSourceImport> = [];

  for (const match of sourceCode.matchAll(LESS_IMPORT_RE)) {
    const fullMatch = match[0];
    const start = match.index;
    if (start === undefined) continue;

    const urlQuoted = match[2];
    const urlUnquoted = match[3];
    const directQuote = match[4] as '"' | "'" | undefined;
    const directSpecifier = match[5];
    const specifier = urlQuoted ?? urlUnquoted ?? directSpecifier;
    if (!specifier) continue;

    const quote: '"' | "'" =
      directQuote ??
      (urlQuoted && fullMatch.includes(`'${urlQuoted}'`) ? "'" : '"');
    const tail = match[6]?.trim() || null;

    imports.push({
      start,
      end: start + fullMatch.length,
      options: match[1]?.trim() || null,
      quote,
      specifier,
      tail,
    });
  }

  return imports;
}

export function assertCssModulePlainImport(
  parsed: LessSourceImport,
  importerFile: string,
) {
  if (!parsed.tail) return;

  throw new Error(
    `[css] CSS Modules partial imports do not support conditional @import (${parsed.tail}): ${parsed.specifier} from ${importerFile}`,
  );
}

export function hasLessImportOption(options: string | null, expected: string) {
  return options?.split(',').some((part) => part.trim() === expected) ?? false;
}

export function isInlineLessImport(options: string | null) {
  return hasLessImportOption(options, 'inline');
}

export function rewriteLessImportAsReference(parsed: LessSourceImport) {
  if (isInlineLessImport(parsed.options)) return null;
  if (hasLessImportOption(parsed.options, 'reference')) {
    return null;
  }

  const optionParts = parsed.options
    ? parsed.options
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
  optionParts.unshift('reference');
  const options = `(${Array.from(new Set(optionParts)).join(', ')})`;
  const tail = parsed.tail ? ` ${parsed.tail}` : '';
  return `@import ${options} ${parsed.quote}${parsed.specifier}${parsed.quote}${tail};`;
}

export function resolveLocalStyleImport(specifier: string, fromDir: string) {
  // Low-level relative-path lookup only. CSS Modules partial imports must go
  // through resolveCssModuleStyleImport for source-root and diagnostics.
  if (!specifier.startsWith('.')) return null;

  const candidate = path.resolve(fromDir, specifier);
  if (fs.existsSync(candidate)) return candidate;

  if (path.extname(specifier)) return null;

  for (const extension of ['.less', '.css']) {
    const withExtension = `${candidate}${extension}`;
    if (fs.existsSync(withExtension)) return withExtension;
  }

  return null;
}

export function mapPreservedLessImportToCssSpecifier(
  importedPath: string,
  importerPath: string,
) {
  const relative = toPosixPath(
    path.relative(path.dirname(importerPath), importedPath),
  );
  const normalized = relative.startsWith('.') ? relative : `./${relative}`;
  return toPosixPath(toOutputStylePath(normalized));
}
