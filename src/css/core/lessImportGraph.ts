import fs from 'node:fs';
import path from 'node:path';
import lessSyntax from 'postcss-less';
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

// Parse PostCSS at-rule params only. postcss-less walks the tree and skips
// comments; its import-specific filename/options fields are unreliable with
// media/layer tails, so params are normalized here.
const IMPORT_PARAMS_RE =
  /^(?:\(([^)]*)\)\s*)?(?:url\(\s*(['"])([^'"]+)\2\s*\)|url\(\s*([^)'"\s]+)\s*\)|(['"])([^'"]+)\5)\s*([\s\S]*)$/;

const parseLessImportParams = (params: string) => {
  const match = params.match(IMPORT_PARAMS_RE);
  if (!match) return null;

  const options = match[1]?.trim() || null;
  const urlQuote = match[2] as '"' | "'" | undefined;
  const urlQuoted = match[3];
  const urlUnquoted = match[4];
  const directQuote = match[5] as '"' | "'" | undefined;
  const directSpecifier = match[6];
  const specifier = urlQuoted ?? urlUnquoted ?? directSpecifier;
  if (!specifier || /[\r\n]/.test(specifier)) return null;

  const tail = match[7]?.trim() || null;
  if (tail?.includes('{')) return null;

  return {
    options,
    quote: (directQuote ?? urlQuote ?? '"') as '"' | "'",
    specifier,
    tail,
  };
};

export function parseLessSourceImports(sourceCode: string) {
  const root = lessSyntax.parse(sourceCode);
  const imports: Array<LessSourceImport> = [];

  root.walkAtRules('import', (rule) => {
    const start = rule.source?.start?.offset;
    const sourceEnd = rule.source?.end?.offset;
    if (start == null || sourceEnd == null) return;

    const parsed = parseLessImportParams(rule.params.trim());
    if (!parsed) return;

    let end = sourceEnd;
    if (sourceCode[end] === ';') end += 1;

    const statement = sourceCode.slice(start, end);
    // Guard against postcss-less recovering broken no-semicolon imports by
    // swallowing the following rule block.
    if (!/;\s*$/.test(statement) || statement.includes('{')) return;

    imports.push({
      start,
      end,
      options: parsed.options,
      quote: parsed.quote,
      specifier: parsed.specifier,
      tail: parsed.tail,
    });
  });

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

export const rewriteLessImportSpecifier = (
  parsed: LessSourceImport,
  specifier: string,
) => {
  const options = parsed.options ? ` (${parsed.options})` : '';
  const tail = parsed.tail ? ` ${parsed.tail}` : '';
  return `@import${options} ${parsed.quote}${toPosixPath(specifier)}${parsed.quote}${tail};`;
};

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
