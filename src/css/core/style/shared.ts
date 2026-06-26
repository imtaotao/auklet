import path from 'node:path';
import { normalizeFileKey, toPosixPath } from '#auklet/utils';

export type SharedStyleFileOptions = {
  packageRoot: string;
  sourceRoot: string;
  styleFiles: Array<string>;
  patterns: Array<string>;
};

export function createSharedStyleFileKeySet(options: SharedStyleFileOptions) {
  const patterns = options.patterns.map((pattern) =>
    createSharedStyleMatcher(options, pattern),
  );

  if (!patterns.length) return new Set<string>();

  return new Set(
    options.styleFiles
      .filter((styleFile) => patterns.some((matcher) => matcher(styleFile)))
      .map((styleFile) => normalizeFileKey(styleFile)),
  );
}

const createSharedStyleMatcher = (
  options: SharedStyleFileOptions,
  pattern: string,
) => {
  const absolutePattern = normalizePatternPath(
    path.resolve(options.packageRoot, pattern),
  );

  if (!isInsideSourceRoot(absolutePattern, options.sourceRoot)) {
    throw new Error(
      `[css] styles.shared pattern must resolve under source root: ${pattern}`,
    );
  }

  const matcher = globToRegExp(absolutePattern);
  return (file: string) => matcher.test(normalizeFileKey(file));
};

const normalizePatternPath = (value: string) => {
  return toPosixPath(path.normalize(value));
};

const isInsideSourceRoot = (file: string, sourceRoot: string) => {
  const relative = path.relative(sourceRoot, file);
  return (
    Boolean(relative) &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  );
};

const globToRegExp = (pattern: string) => {
  let source = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const nextChar = pattern[index + 1];

    if (char === '*' && nextChar === '*') {
      const afterGlob = pattern[index + 2];
      if (afterGlob === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
      continue;
    }

    if (char === '*') {
      source += '[^/]*';
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`${source}$`);
};

const escapeRegExp = (value: string) => {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
};
