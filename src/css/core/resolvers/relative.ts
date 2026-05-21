import path from 'node:path';

export function resolveRelativeSourceImport(
  sourceDir: string,
  importPath: string,
) {
  if (!importPath.startsWith('.')) return [];
  return [path.normalize(path.join(sourceDir, importPath))];
}
