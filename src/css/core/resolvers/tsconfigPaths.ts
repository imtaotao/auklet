import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { POSIX_SEPARATOR, toPosixPath } from '#auklet/utils';

type TsconfigPathsMatch = {
  path: string;
  score: number;
};

const sourceExtensions = /\.(?:[cm]?[jt]s|[jt]sx)$/;

const findTsconfig = (packageRoot: string) => {
  let current = packageRoot;

  while (true) {
    const tsconfig = path.join(current, 'tsconfig.json');
    if (fs.existsSync(tsconfig)) return tsconfig;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

const readTsconfigPaths = (packageRoot: string) => {
  const tsconfig = findTsconfig(packageRoot);
  if (!tsconfig) return null;

  const loaded = ts.readConfigFile(tsconfig, ts.sys.readFile);
  if (loaded.error) return null;

  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    path.dirname(tsconfig),
    {},
    tsconfig,
  );
  return {
    baseUrl: parsed.options.baseUrl ?? path.dirname(tsconfig),
    paths: parsed.options.paths ?? {},
  };
};

const resolvePattern = (
  pattern: string,
  target: string,
  importPath: string,
) => {
  const wildcardIndex = pattern.indexOf('*');
  if (wildcardIndex < 0) return pattern === importPath ? target : null;

  const prefix = pattern.slice(0, wildcardIndex);
  const suffix = pattern.slice(wildcardIndex + 1);
  if (!importPath.startsWith(prefix) || !importPath.endsWith(suffix)) {
    return null;
  }

  const value = importPath.slice(
    prefix.length,
    importPath.length - suffix.length,
  );
  return target.replace(/\*/g, value);
};

const getPatternScore = (pattern: string) => {
  const wildcardIndex = pattern.indexOf('*');
  if (wildcardIndex < 0) return Number.MAX_SAFE_INTEGER;
  return pattern.slice(0, wildcardIndex).length;
};

const trimSourceExtension = (value: string) => {
  return value.replace(sourceExtensions, '');
};

const toSourceRelativePath = (sourceRoot: string, file: string) => {
  const relative = path.relative(sourceRoot, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return trimSourceExtension(toPosixPath(relative));
};

export function resolveTsconfigPathsSourceImport(
  packageRoot: string,
  sourceRoot: string,
  importPath: string,
) {
  const config = readTsconfigPaths(packageRoot);
  if (!config) return [];

  const matches: Array<TsconfigPathsMatch> = [];

  for (const [pattern, targets] of Object.entries(config.paths)) {
    for (const target of targets) {
      const resolved = resolvePattern(pattern, target, importPath);
      if (!resolved) continue;

      const sourceRelativePath = toSourceRelativePath(
        sourceRoot,
        path.resolve(config.baseUrl, resolved),
      );
      if (sourceRelativePath) {
        matches.push({
          path: sourceRelativePath.split(POSIX_SEPARATOR).join(path.sep),
          score: getPatternScore(pattern),
        });
      }
    }
  }
  return matches.sort((a, b) => b.score - a.score).map((match) => match.path);
}
