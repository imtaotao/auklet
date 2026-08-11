import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { isInsideRoot, normalizeFileKey, toPosixPath } from '#auklet/utils';

export type SharedStylePatternOptions = {
  packageRoot: string;
  sourceRoot: string;
  patterns: Array<string>;
};

export type SharedStyleFileOptions = SharedStylePatternOptions & {
  styleFiles: Array<string>;
};

export function resolveSharedStylePatterns(options: SharedStylePatternOptions) {
  if (!options.patterns.length) return [];

  const packageRoot = path.resolve(options.packageRoot);
  const sourceRoot = path.resolve(options.sourceRoot);
  const matched = new Map<string, string>();

  for (const pattern of options.patterns) {
    assertSharedPatternUnderSourceRoot(pattern, packageRoot, sourceRoot);
    const files = fg.sync(pattern, {
      cwd: packageRoot,
      absolute: true,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
    });
    for (const file of files) {
      const resolved = path.resolve(file);
      if (!isInsideRoot(resolved, sourceRoot)) {
        throw new Error(
          `[css] styles.shared pattern matched a file outside source root: ${pattern} -> ${resolved}`,
        );
      }
      matched.set(normalizeFileKey(resolved), resolved);
    }
  }

  return Array.from(matched.values()).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function createSharedStyleFileKeySet(options: SharedStyleFileOptions) {
  if (!options.patterns.length) return new Set<string>();

  const matched = new Set(
    resolveSharedStylePatterns(options).map((file) => normalizeFileKey(file)),
  );
  return new Set(
    options.styleFiles
      .map((file) => normalizeFileKey(file))
      .filter((file) => matched.has(file)),
  );
}

const assertSharedPatternUnderSourceRoot = (
  pattern: string,
  packageRoot: string,
  sourceRoot: string,
) => {
  const absolutePattern = toPosixPath(path.resolve(packageRoot, pattern));
  const absoluteSourceRoot = toPosixPath(path.resolve(sourceRoot));
  if (
    absolutePattern === absoluteSourceRoot ||
    absolutePattern.startsWith(`${absoluteSourceRoot}/`)
  ) {
    return;
  }
  throw new Error(
    `[css] styles.shared pattern must resolve under source root: ${pattern}`,
  );
};

// Prefix before the first glob meta (`*`, `?`, `{`) — used to keep output trees
// out of the global style entry graph.
export function resolveSharedOutputExcludeRoots(options: {
  packageRoot: string;
  sourceRoot: string;
  patterns: Array<string>;
}) {
  const roots = new Set<string>();
  for (const pattern of options.patterns) {
    assertSharedPatternUnderSourceRoot(
      pattern,
      options.packageRoot,
      options.sourceRoot,
    );
    const metaIndex = pattern.search(/[*?{]/);
    const prefix = metaIndex === -1 ? pattern : pattern.slice(0, metaIndex);
    const absolutePrefix = path.resolve(options.packageRoot, prefix);
    const root =
      fs.existsSync(absolutePrefix) && fs.statSync(absolutePrefix).isDirectory()
        ? absolutePrefix
        : path.dirname(absolutePrefix);
    const resolvedRoot = path.resolve(root);
    const resolvedSourceRoot = path.resolve(options.sourceRoot);
    if (resolvedRoot === resolvedSourceRoot) {
      throw new Error(
        `[css] styles.shared.output glob is too wide (exclude root is the source root): ${pattern}. Narrow the pattern (e.g. ./src/shared/**/*.module.{less,css}).`,
      );
    }
    if (!isInsideRoot(resolvedRoot, options.sourceRoot)) {
      continue;
    }
    roots.add(resolvedRoot);
  }
  return Array.from(roots);
}
