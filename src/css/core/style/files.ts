import path from 'node:path';
import { getSourceModuleDir, normalizeFileKey } from '#auklet/utils';

export function groupStyleFilesByDir(
  sourceRoot: string,
  styleFiles: Array<string>,
) {
  const styleFilesByDir = new Map<string, Array<string>>();
  for (const styleFile of styleFiles) {
    const sourceRelative = path.relative(sourceRoot, styleFile);
    const sourceDir = getSourceModuleDir(sourceRelative);
    const values = styleFilesByDir.get(sourceDir) ?? [];
    values.push(styleFile);
    styleFilesByDir.set(sourceDir, values);
  }
  return styleFilesByDir;
}

export function createStyleFileKeySet(styleFiles: Iterable<string>) {
  return new Set(Array.from(styleFiles, normalizeFileKey));
}

export function createStyleFileKey(styleFile: string) {
  return normalizeFileKey(styleFile);
}
